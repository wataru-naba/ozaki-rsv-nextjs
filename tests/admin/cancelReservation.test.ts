import { beforeEach, describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * US-007 予約キャンセル(Server Action)のデータ整合性・認可テスト。
 *
 * architect.md が必須とする「データ整合性・認可」の中核テスト。
 * 実 DB の `UPDATE ... SET count = count - 1 WHERE count > 0` は単体テストで直接
 * 検証できないため、その境界(startAt 昇順で全枠が処理されるか / 影響行数0=count が
 * 既に0の理論上不整合でも中断せず継続するか / 他予約ぶんの占有が誤解除されないか /
 * 認可・NOT_FOUND・DB エラーの扱い)をインメモリでシミュレートして検証する。
 *
 * シミュレーション方針(旧 `fix` 無条件解除バグの再発防止設計を検証):
 * - `$executeRaw(Prisma.sql\`...\`)` の values = [placeId, subStart(Date)]。
 * - スロット占有数を Map で保持し、`count > 0` のときだけ -1 して affected=1 を返す。
 *   count が既に 0 の枠は affected=0(実 DB の WHERE count > 0 と同じ挙動)。
 */

type CancelState = {
  slotCounts: Map<number, number>; // subStart.getTime() -> 占有数
  reservation: Record<string, unknown> | null;
  deletedIds: number[];
  txShouldThrow: boolean;
  decrementOrder: number[]; // $executeRaw が呼ばれた start_at の順(getTime())
};

const state: CancelState = {
  slotCounts: new Map(),
  reservation: null,
  deletedIds: [],
  txShouldThrow: false,
  decrementOrder: [],
};

// --- 認可(requireAdminSession)のモック ---
const requireAdminSession = vi.fn();
// vi.mock ファクトリは巻き上げられるため、クラス参照は vi.hoisted 経由で共有する。
const { UnauthorizedErrorMock } = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {
    constructor(message = "認証が必要です。") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }
  return { UnauthorizedErrorMock };
});
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: UnauthorizedErrorMock,
}));

// --- revalidatePath のモック(呼び出しを記録するだけ) ---
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// --- Prisma のモック(トランザクション + アトミック条件付き減算をシミュレート) ---
const transactionImpl = async (
  cb: (tx: {
    $executeRaw: (sql: Prisma.Sql) => Promise<number>;
    reservation: { delete: (a: { where: { id: number } }) => Promise<unknown> };
  }) => Promise<unknown>,
) => {
  const tx = {
    // 実 DB の UPDATE ... WHERE count > 0 を模した不可分 check→set。
    $executeRaw: (sql: Prisma.Sql): Promise<number> => {
      const key = (sql.values[1] as Date).getTime();
      state.decrementOrder.push(key);
      const cur = state.slotCounts.get(key) ?? 0;
      if (cur > 0) {
        state.slotCounts.set(key, cur - 1);
        return Promise.resolve(1);
      }
      return Promise.resolve(0); // count が既に 0(理論上の不整合)
    },
    reservation: {
      delete: (a: { where: { id: number } }): Promise<unknown> => {
        if (state.txShouldThrow) {
          return Promise.reject(new Error("DB error on delete"));
        }
        state.deletedIds.push(a.where.id);
        return Promise.resolve({ id: a.where.id });
      },
    },
  };
  return cb(tx);
};

// 呼び出しシグネチャを可変長引数で明示する。
// vitest の型では実装のアリティがそのままモックの呼び出し型に反映されるため、
// 引数無し実装のままだと呼び出し側の `reservationFindUnique(...a)` のスプレッドが型エラーになる。
const reservationFindUnique = vi.fn<(...a: unknown[]) => Promise<typeof state.reservation>>(
  async () => state.reservation,
);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reservation: { findUnique: (...a: unknown[]) => reservationFindUnique(...a) },
    $transaction: vi.fn((cb: Parameters<typeof transactionImpl>[0]) => transactionImpl(cb)),
  },
}));

import { cancelReservation } from "@/app/admin/_actions/reservations";
import { prisma } from "@/lib/prisma";
import { jstDateStrToInstant } from "@/lib/reservation/time";

const DATE = "2026-07-15";

/** 予約行を組み立てる(startAt/endAt の分は JST の分オフセット)。 */
function reservationRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    placeId: 2,
    typeId: 0,
    durationMinutes: 90,
    startAt: jstDateStrToInstant(DATE, 10 * 60), // 10:00
    endAt: jstDateStrToInstant(DATE, 11 * 60 + 30), // 11:30(90分=3枠)
    name: "尾崎 太郎",
    kana: "オザキ タロウ",
    tel: "09012345678",
    email: "taro@example.com",
    createdAt: new Date(),
    ...over,
  };
}

function slotKey(minutesOfDay: number): number {
  return jstDateStrToInstant(DATE, minutesOfDay).getTime();
}

beforeEach(() => {
  state.slotCounts = new Map();
  state.reservation = null;
  state.deletedIds = [];
  state.txShouldThrow = false;
  state.decrementOrder = [];
  vi.clearAllMocks();
  requireAdminSession.mockResolvedValue({ id: "u1", username: "staff" });
  reservationFindUnique.mockImplementation(async () => state.reservation);
});

describe("cancelReservation — 正常系(count 条件付き減算 + 予約削除)", () => {
  it("30分予約(単一枠): 対象枠の count を -1 し、予約を削除して成功を返す", async () => {
    state.reservation = reservationRow({
      id: 5,
      typeId: 2,
      durationMinutes: 30,
      startAt: jstDateStrToInstant(DATE, 10 * 60),
      endAt: jstDateStrToInstant(DATE, 10 * 60 + 30),
    });
    state.slotCounts.set(slotKey(10 * 60), 1);

    const result = await cancelReservation({ reservationId: 5 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reservationId).toBe(5);
    expect(state.slotCounts.get(slotKey(10 * 60))).toBe(0);
    expect(state.deletedIds).toEqual([5]);
  });

  it("90分予約(複数枠): 3枠すべての count が -1 され、予約が削除される", async () => {
    state.reservation = reservationRow();
    state.slotCounts.set(slotKey(10 * 60), 2);
    state.slotCounts.set(slotKey(10 * 60 + 30), 2);
    state.slotCounts.set(slotKey(11 * 60), 2);

    const result = await cancelReservation({ reservationId: 10 });

    expect(result.ok).toBe(true);
    expect(state.slotCounts.get(slotKey(10 * 60))).toBe(1);
    expect(state.slotCounts.get(slotKey(10 * 60 + 30))).toBe(1);
    expect(state.slotCounts.get(slotKey(11 * 60))).toBe(1);
    expect(state.deletedIds).toEqual([10]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("90分予約の3枠は startAt 昇順で処理される(デッドロック回避 4.4節)", async () => {
    state.reservation = reservationRow();
    state.slotCounts.set(slotKey(10 * 60), 1);
    state.slotCounts.set(slotKey(10 * 60 + 30), 1);
    state.slotCounts.set(slotKey(11 * 60), 1);

    await cancelReservation({ reservationId: 10 });

    expect(state.decrementOrder).toEqual([
      slotKey(10 * 60),
      slotKey(10 * 60 + 30),
      slotKey(11 * 60),
    ]);
  });

  it("成功後、一覧と詳細ページを revalidate する(一覧へ戻れる)", async () => {
    state.reservation = reservationRow({ id: 7 });
    state.slotCounts.set(slotKey(10 * 60), 1);
    state.slotCounts.set(slotKey(10 * 60 + 30), 1);
    state.slotCounts.set(slotKey(11 * 60), 1);

    await cancelReservation({ reservationId: 7 });

    expect(revalidatePath).toHaveBeenCalledWith("/admin/reservations");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reservations/7");
  });
});

describe("cancelReservation — データ整合性(旧 fix 無条件解除バグの再発防止)", () => {
  it("同一枠を複数予約が使用中: 1件キャンセルしても他予約ぶんの占有(count)は残る", async () => {
    // 同じ枠を2予約が使用中(count=2)。1件キャンセルで count=1 に減るのみで、満枠解除されない。
    state.reservation = reservationRow({
      id: 8,
      typeId: 2,
      durationMinutes: 30,
      startAt: jstDateStrToInstant(DATE, 10 * 60),
      endAt: jstDateStrToInstant(DATE, 10 * 60 + 30),
    });
    state.slotCounts.set(slotKey(10 * 60), 2);

    const result = await cancelReservation({ reservationId: 8 });

    expect(result.ok).toBe(true);
    // count は 2 → 1。他予約ぶんの占有が誤って 0 に解除されない(旧 fix バグの再発防止)。
    expect(state.slotCounts.get(slotKey(10 * 60))).toBe(1);
  });

  it("count が既に0(理論上の不整合)でも中断せず、警告ログを出して処理を継続し予約を削除する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 全枠 count=0(理論上あり得ない不整合)。UPDATE ... WHERE count > 0 は affected=0。
    state.reservation = reservationRow({ id: 9 });
    // slotCounts は空(=0)。

    const result = await cancelReservation({ reservationId: 9 });

    // 処理は中断されず成功する(スタッフの目的=キャンセルを優先)。
    expect(result.ok).toBe(true);
    expect(state.deletedIds).toEqual([9]);
    // 3枠すべてで警告ログが出る(異常を可観測にする)。
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls[0][0]).toContain("slot count already 0");

    warnSpy.mockRestore();
  });

  it("一部の枠だけ count=0 でも、count>0 の枠は正しく減算され、全体は継続する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.reservation = reservationRow({ id: 11 });
    // 1枠目=0(不整合), 2枠目=2, 3枠目=1
    state.slotCounts.set(slotKey(10 * 60), 0);
    state.slotCounts.set(slotKey(10 * 60 + 30), 2);
    state.slotCounts.set(slotKey(11 * 60), 1);

    const result = await cancelReservation({ reservationId: 11 });

    expect(result.ok).toBe(true);
    expect(state.slotCounts.get(slotKey(10 * 60))).toBe(0); // 据え置き
    expect(state.slotCounts.get(slotKey(10 * 60 + 30))).toBe(1); // -1
    expect(state.slotCounts.get(slotKey(11 * 60))).toBe(0); // -1
    expect(warnSpy).toHaveBeenCalledTimes(1); // 1枠目のみ警告
    expect(state.deletedIds).toEqual([11]);

    warnSpy.mockRestore();
  });
});

describe("cancelReservation — 認可・存在チェック・エラー", () => {
  it("未認証(UnauthorizedError)なら UNAUTHORIZED を返し、DB へ触れない(ページ保護に依存しない)", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());
    state.reservation = reservationRow();

    const result = await cancelReservation({ reservationId: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(reservationFindUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("存在しない予約IDは NOT_FOUND を返し、トランザクションに入らない", async () => {
    state.reservation = null;

    const result = await cancelReservation({ reservationId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("不正な予約ID(0以下・非整数)は VALIDATION_ERROR を返す", async () => {
    const zero = await cancelReservation({ reservationId: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe("VALIDATION_ERROR");

    const frac = await cancelReservation({ reservationId: 1.5 });
    expect(frac.ok).toBe(false);
    if (!frac.ok) expect(frac.error.code).toBe("VALIDATION_ERROR");

    expect(reservationFindUnique).not.toHaveBeenCalled();
  });

  it("キャンセル処理中に DB エラーが発生したら INTERNAL_ERROR を返し、revalidate しない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.reservation = reservationRow({ id: 12 });
    state.slotCounts.set(slotKey(10 * 60), 1);
    state.slotCounts.set(slotKey(10 * 60 + 30), 1);
    state.slotCounts.set(slotKey(11 * 60), 1);
    state.txShouldThrow = true; // delete で例外

    const result = await cancelReservation({ reservationId: 12 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(revalidatePath).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
