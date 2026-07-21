import { beforeEach, describe, it, expect, vi } from "vitest";

/**
 * US-009 不定休(Closure)登録・削除(Server Action)の認可・整合性テスト(api-design.md 5.4 節)。
 *
 * 検証対象:
 * - createClosure: 終日休診の登録(時刻は null)、時間帯休診の登録(開始・終了が @db.Time で保存)、
 *   登録後に revalidatePath("/admin/slots") される。
 * - createClosure のバリデーション: 時間帯休診で開始・終了時刻未入力は VALIDATION_ERROR で
 *   DB を触らない。終了が開始より前も VALIDATION_ERROR。
 * - deleteClosure: 存在する不定休を削除し revalidatePath される。存在しない ID は NOT_FOUND。
 * - 未認証で各 Action を直接呼ぶと UNAUTHORIZED(ページ保護に依存しない)。
 *
 * @db.Date は UTC 0時、@db.Time は 1970-01-01 UTC の時刻として保存されるため、
 * create に渡る Date の UTC 値で検証する。
 */

// --- 認可(requireAdminSession)のモック ---
const requireAdminSession = vi.fn();
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

// --- revalidatePath のモック ---
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// --- Prisma のモック ---
const closureCreate = vi.fn();
const closureFindUnique = vi.fn();
const closureDelete = vi.fn();
const businessHourUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessHour: { upsert: (...a: unknown[]) => businessHourUpsert(...a) },
    closure: {
      create: (...a: unknown[]) => closureCreate(...a),
      findUnique: (...a: unknown[]) => closureFindUnique(...a),
      delete: (...a: unknown[]) => closureDelete(...a),
    },
  },
}));

import { createClosure, deleteClosure } from "@/app/admin/_actions/settings";

type CreateArg = { data: Record<string, unknown> };

/** @db.Time 用 Date から "HH:MM"(UTC)を得る。 */
function timeColToHHMM(v: unknown): string | null {
  if (v == null) return null;
  const d = v as Date;
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** @db.Date 用 Date から "YYYY-MM-DD"(UTC)を得る。 */
function dateColToYMD(v: unknown): string {
  const d = v as Date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminSession.mockResolvedValue({ id: "u1", username: "staff" });
  closureCreate.mockResolvedValue({ id: 100 });
  closureFindUnique.mockResolvedValue({ id: 5, placeId: 1 });
  closureDelete.mockResolvedValue({ id: 5 });
});

describe("createClosure — 終日休診の登録", () => {
  it("終日休診を登録すると時刻は null で保存され、成功して revalidatePath される", async () => {
    const result = await createClosure({
      placeId: 1,
      date: "2026-08-01",
      isAllDay: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(100);
    expect(closureCreate).toHaveBeenCalledTimes(1);
    const arg = closureCreate.mock.calls[0][0] as CreateArg;
    expect(arg.data.placeId).toBe(1);
    expect(dateColToYMD(arg.data.date)).toBe("2026-08-01");
    expect(arg.data.isAllDay).toBe(true);
    expect(arg.data.startTime).toBeNull();
    expect(arg.data.endTime).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/slots");
  });

  it("終日休診では時刻が渡っても null に正規化される", async () => {
    await createClosure({
      placeId: 2,
      date: "2026-08-02",
      isAllDay: true,
      startTime: "10:00",
      endTime: "12:00",
    });

    const arg = closureCreate.mock.calls[0][0] as CreateArg;
    expect(arg.data.startTime).toBeNull();
    expect(arg.data.endTime).toBeNull();
  });
});

describe("createClosure — 時間帯休診の登録", () => {
  it("時間帯休診を登録すると開始・終了が @db.Time で保存される", async () => {
    const result = await createClosure({
      placeId: 1,
      date: "2026-08-03",
      isAllDay: false,
      startTime: "10:00",
      endTime: "12:30",
    });

    expect(result.ok).toBe(true);
    const arg = closureCreate.mock.calls[0][0] as CreateArg;
    expect(arg.data.isAllDay).toBe(false);
    expect(timeColToHHMM(arg.data.startTime)).toBe("10:00");
    expect(timeColToHHMM(arg.data.endTime)).toBe("12:30");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/slots");
  });
});

describe("createClosure — バリデーション(DB を触らない)", () => {
  it("時間帯休診で開始・終了時刻が未入力なら VALIDATION_ERROR で create しない", async () => {
    const result = await createClosure({
      placeId: 1,
      date: "2026-08-04",
      isAllDay: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(closureCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("時間帯休診で終了が開始より前なら VALIDATION_ERROR", async () => {
    const result = await createClosure({
      placeId: 1,
      date: "2026-08-04",
      isAllDay: false,
      startTime: "12:00",
      endTime: "10:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(closureCreate).not.toHaveBeenCalled();
  });

  it("VALIDATION_ERROR は fieldErrors を返す", async () => {
    const result = await createClosure({ placeId: 1, date: "2026-08-04", isAllDay: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors).toBeTruthy();
  });
});

describe("createClosure — 認可", () => {
  it("未認証なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const result = await createClosure({ placeId: 1, date: "2026-08-01", isAllDay: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(closureCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createClosure — DB エラー", () => {
  it("create が失敗したら INTERNAL_ERROR を返し revalidate しない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    closureCreate.mockRejectedValue(new Error("DB down"));

    const result = await createClosure({ placeId: 1, date: "2026-08-01", isAllDay: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(revalidatePath).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("deleteClosure — 正常系", () => {
  it("指定した不定休を削除し、成功を返して revalidatePath される", async () => {
    const result = await deleteClosure({ closureId: 5 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.closureId).toBe(5);
    expect(closureFindUnique).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(closureDelete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/slots");
  });
});

describe("deleteClosure — NOT_FOUND", () => {
  it("存在しない不定休 ID は NOT_FOUND を返し delete しない", async () => {
    closureFindUnique.mockResolvedValue(null);

    const result = await deleteClosure({ closureId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(closureDelete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("不正な ID(0 以下・非整数)は VALIDATION_ERROR で DB を触らない", async () => {
    const result = await deleteClosure({ closureId: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(closureFindUnique).not.toHaveBeenCalled();
    expect(closureDelete).not.toHaveBeenCalled();
  });
});

describe("deleteClosure — 認可", () => {
  it("未認証なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const result = await deleteClosure({ closureId: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(closureFindUnique).not.toHaveBeenCalled();
    expect(closureDelete).not.toHaveBeenCalled();
  });
});
