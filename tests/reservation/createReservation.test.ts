import { beforeEach, describe, it, expect, vi } from "vitest";
import { Weekday, Prisma } from "@prisma/client";

/**
 * US-003 予約確定ロジック(createReservation.ts)のデータ整合性テスト。
 *
 * architect.md が必須とする「予約重複・データ整合性」の中核テスト。
 * 実 DB の `INSERT ... ON CONFLICT ... WHERE count < limit` は単体テストで直接検証できないため、
 * その境界(何回呼ばれるか / 影響行数0=満枠の扱い / トランザクションのロールバック)を
 * インメモリで**アトミックに**シミュレートして検証する(タスク指示6の方針)。
 *
 * シミュレーション方針:
 * - `$executeRaw(Prisma.sql\`...\`)` の values = [placeId, subStart(Date), reservationLimit]。
 * - スロットごとの占有数を Map で保持し、`count < limit` のときだけ +1 して affected=1 を返す。
 *   満枠なら affected=0(実 DB の WHERE 句と同じ挙動)。この check→set は同期実行のため不可分。
 * - トランザクションの callback が throw した場合、そのトランザクションが行った increment のみを
 *   巻き戻す(部分的な枠確保が残らないこと=ロールバックを表現)。
 */

// --- テストが設定するモック状態(vi.mock はホイストされるため module スコープで保持) ---
type SlotState = {
  reservationLimit: number;
  businessHourIsOpen: boolean;
  holiday: { date: Date } | null;
  closures: unknown[];
  slotCounts: Map<number, number>; // subStart.getTime() -> 占有数
  createdReservations: Array<Record<string, unknown>>;
  nextReservationId: number;
  placeExists: boolean;
};

const state: SlotState = {
  reservationLimit: 4,
  businessHourIsOpen: true,
  holiday: null,
  closures: [],
  slotCounts: new Map(),
  createdReservations: [],
  nextReservationId: 1,
  placeExists: true,
};

function timeCol(hh: number, mm = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hh, mm, 0, 0));
}

function businessHours() {
  return Object.values(Weekday).map((w, i) => ({
    id: i + 1,
    placeId: 1,
    weekday: w,
    isOpen: state.businessHourIsOpen,
    openTime: timeCol(9, 0),
    closeTime: timeCol(18, 30),
    breakStart: null,
    breakEnd: null,
    reservationLimit: state.reservationLimit,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

const transactionImpl = async (
  cb: (tx: {
    $executeRaw: (sql: Prisma.Sql) => Promise<number>;
    reservation: { create: (a: { data: Record<string, unknown> }) => Promise<Record<string, unknown>> };
  }) => Promise<unknown>,
) => {
  const myIncrements: number[] = [];
  const tx = {
    // 実 DB の ON CONFLICT ... WHERE count < limit を模した不可分 check→set。
    $executeRaw: (sql: Prisma.Sql): Promise<number> => {
      const key = (sql.values[1] as Date).getTime();
      const limit = sql.values[2] as number;
      const cur = state.slotCounts.get(key) ?? 0;
      if (cur < limit) {
        state.slotCounts.set(key, cur + 1);
        myIncrements.push(key);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    },
    reservation: {
      create: (a: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        const r = { id: state.nextReservationId++, ...a.data };
        state.createdReservations.push(r);
        return Promise.resolve(r);
      },
    },
  };
  try {
    return await cb(tx);
  } catch (e) {
    // このトランザクションが行った increment のみを巻き戻す(=ロールバック)。
    for (const key of myIncrements) {
      state.slotCounts.set(key, (state.slotCounts.get(key) ?? 1) - 1);
    }
    throw e;
  }
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    place: {
      findUnique: vi.fn(async () => (state.placeExists ? { id: 1, code: "NOBEOKA" } : null)),
    },
    businessHour: { findMany: vi.fn(async () => businessHours()) },
    publicHoliday: { findUnique: vi.fn(async () => state.holiday) },
    closure: { findMany: vi.fn(async () => state.closures) },
    $transaction: vi.fn((cb: Parameters<typeof transactionImpl>[0]) => transactionImpl(cb)),
  },
}));

import { createReservation } from "@/lib/reservation/createReservation";
import type { CreateReservationInput } from "@/lib/reservation/schemas";
import { SlotUnavailableError, ValidationError } from "@/lib/api/errors";
import { jstDateStrToInstant, timeStrToMinutes } from "@/lib/reservation/time";
import { prisma } from "@/lib/prisma";

// 十分に未来の日付(ラストオーダー・当日以降の制約を確実にクリアする)。
const DATE = "2030-06-03";
const TIME = "10:00";

function baseInput(overrides: Partial<CreateReservationInput> = {}): CreateReservationInput {
  return {
    place: "NOBEOKA",
    typeId: 2, // 30分 = 1枠
    date: DATE,
    time: TIME,
    name: "尾崎 太郎",
    kana: "オザキタロウ",
    tel: "09012345678",
    email: "taro@example.com",
    privacyAgreed: true,
    hpField: "",
    ...overrides,
  };
}

/** typeId・time から占有サブ枠のキー(getTime())配列を計算する。 */
function subSlotKeys(time: string, durationMinutes: number): number[] {
  const startMin = timeStrToMinutes(time);
  const keys: number[] = [];
  for (let m = startMin; m < startMin + durationMinutes; m += 30) {
    keys.push(jstDateStrToInstant(DATE, m).getTime());
  }
  return keys;
}

beforeEach(() => {
  state.reservationLimit = 4;
  state.businessHourIsOpen = true;
  state.holiday = null;
  state.closures = [];
  state.slotCounts = new Map();
  state.createdReservations = [];
  state.nextReservationId = 1;
  state.placeExists = true;
  vi.clearAllMocks();
});

describe("createReservation — 正常系(枠確保と count 加算)", () => {
  it("30分予約(単一枠): 予約が1件作成され、対象枠の count が +1 される", async () => {
    const result = await createReservation(baseInput({ typeId: 2 }));

    expect(result.reservationId).toBe(1);
    expect(result.durationMinutes).toBe(30);
    expect(state.createdReservations).toHaveLength(1);

    const keys = subSlotKeys(TIME, 30);
    expect(keys).toHaveLength(1);
    expect(state.slotCounts.get(keys[0])).toBe(1);
  });

  it("90分予約(複数枠またぎ): 連続する3つの30分枠すべての count が +1 される", async () => {
    const result = await createReservation(baseInput({ typeId: 0 }));

    expect(result.durationMinutes).toBe(90);
    expect(state.createdReservations).toHaveLength(1);

    const keys = subSlotKeys(TIME, 90);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(state.slotCounts.get(key)).toBe(1);
    }
    // 枠確保のアトミック SQL は3枠ぶん(3回)呼ばれる。
    // ($transaction は1回、内部の $executeRaw が3回)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("2件目の予約は同一枠の count をさらに +1 する(上限未満)", async () => {
    await createReservation(baseInput());
    await createReservation(baseInput());
    const keys = subSlotKeys(TIME, 30);
    expect(state.slotCounts.get(keys[0])).toBe(2);
    expect(state.createdReservations).toHaveLength(2);
  });
});

describe("createReservation — 満枠・ロールバック(データ整合性)", () => {
  it("上限に達した枠への予約は SLOT_UNAVAILABLE でロールバックされ、Reservation が作成されない", async () => {
    state.reservationLimit = 1;
    const keys = subSlotKeys(TIME, 30);
    state.slotCounts.set(keys[0], 1); // すでに満枠

    await expect(createReservation(baseInput())).rejects.toBeInstanceOf(SlotUnavailableError);

    expect(state.createdReservations).toHaveLength(0);
    // 満枠枠の count は加算されない(据え置き)。
    expect(state.slotCounts.get(keys[0])).toBe(1);
  });

  it("90分予約で途中の枠だけ満枠のとき、全体がロールバックされ部分的な枠確保が残らない", async () => {
    state.reservationLimit = 4;
    const keys = subSlotKeys(TIME, 90); // 3枠
    state.slotCounts.set(keys[1], 4); // 2枠目だけ満枠

    await expect(createReservation(baseInput({ typeId: 0 }))).rejects.toBeInstanceOf(
      SlotUnavailableError,
    );

    expect(state.createdReservations).toHaveLength(0);
    // 1枠目は一旦 +1 されるが、ロールバックで 0 に戻る(部分確保が残らない)。
    expect(state.slotCounts.get(keys[0]) ?? 0).toBe(0);
    // 2枠目は満枠のまま据え置き。3枠目は一切触れられない。
    expect(state.slotCounts.get(keys[1])).toBe(4);
    expect(state.slotCounts.get(keys[2]) ?? 0).toBe(0);
  });
});

describe("createReservation — 同時実行(アトミック条件更新で二重予約されない)", () => {
  it("上限1の枠に5件同時申込 → 成功は1件のみ、残り4件は SLOT_UNAVAILABLE", async () => {
    state.reservationLimit = 1;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createReservation(baseInput())),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SlotUnavailableError);
    }
    // 上限を超える count は発生しない。
    const keys = subSlotKeys(TIME, 30);
    expect(state.slotCounts.get(keys[0])).toBe(1);
    expect(state.createdReservations).toHaveLength(1);
  });

  it("上限3の枠に10件同時申込 → 成功はちょうど3件、count は上限で頭打ち", async () => {
    state.reservationLimit = 3;

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createReservation(baseInput())),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(3);
    const keys = subSlotKeys(TIME, 30);
    expect(state.slotCounts.get(keys[0])).toBe(3);
    expect(state.createdReservations).toHaveLength(3);
  });
});

describe("createReservation — 再検証(TOCTOU)と入力チェック", () => {
  it("取得後に休診化(isOpen=false)した枠は、トランザクション前に SLOT_UNAVAILABLE で弾かれる", async () => {
    state.businessHourIsOpen = false;

    await expect(createReservation(baseInput())).rejects.toBeInstanceOf(SlotUnavailableError);
    // 枠確保トランザクションには入らない。
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(state.createdReservations).toHaveLength(0);
  });

  it("30分刻みでない時刻は ValidationError となり、DB へ触れない", async () => {
    await expect(createReservation(baseInput({ time: "10:15" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(state.createdReservations).toHaveLength(0);
  });

  it("存在しない拠点は NOT_FOUND(枠確保しない)", async () => {
    state.placeExists = false;
    await expect(createReservation(baseInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
