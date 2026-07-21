import { beforeEach, describe, it, expect, vi } from "vitest";

/**
 * US-008 曜日別営業設定編集(Server Action)の認可・整合性テスト(api-design.md 5.3 節)。
 *
 * 検証対象:
 * - 正しい入力で businessHour.upsert が @@unique([placeId, weekday]) をキーに呼ばれ、
 *   revalidatePath("/admin/slots") される(重複行が生まれない=一意性を保った更新)。
 * - 休診(isOpen=false)に変更すると時刻系(open/close/break)が null に正規化される。
 * - 外枠 9:00-18:30 違反・営業日の時刻未入力・不正な範囲・不正な予約上限は
 *   VALIDATION_ERROR となり DB を触らない。
 * - 未認証で Server Action を直接呼ぶと UNAUTHORIZED(ページ保護に依存しない)。
 *
 * @db.Time カラムは 1970-01-01 UTC の時刻として保存されるため、
 * upsert に渡る Date の UTC 時分で入力時刻を検証する。
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
const businessHourUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessHour: { upsert: (...a: unknown[]) => businessHourUpsert(...a) },
  },
}));

import { updateBusinessHour } from "@/app/admin/_actions/settings";

type UpsertArg = {
  where: { placeId_weekday: { placeId: number; weekday: string } };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
};

function validInput(over: Partial<Record<string, unknown>> = {}) {
  return {
    placeId: 1,
    weekday: "MONDAY" as const,
    isOpen: true,
    openTime: "09:00",
    closeTime: "18:30",
    breakStart: "12:00",
    breakEnd: "13:00",
    reservationLimit: 2,
    ...over,
  };
}

/** @db.Time 用 Date から "HH:MM"(UTC)を得る。 */
function timeColToHHMM(v: unknown): string | null {
  if (v == null) return null;
  const d = v as Date;
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminSession.mockResolvedValue({ id: "u1", username: "staff" });
  businessHourUpsert.mockResolvedValue({ id: 42 });
});

describe("updateBusinessHour — 正常系(upsert + revalidate)", () => {
  it("正しい入力で upsert が呼ばれ、成功を返して revalidatePath される", async () => {
    const result = await updateBusinessHour(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(42);
    expect(businessHourUpsert).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/slots");
  });

  it("upsert は @@unique([placeId, weekday]) 複合キーを where に使う(重複行を作らない)", async () => {
    await updateBusinessHour(validInput({ placeId: 2, weekday: "SATURDAY" }));

    const arg = businessHourUpsert.mock.calls[0][0] as UpsertArg;
    expect(arg.where.placeId_weekday).toEqual({ placeId: 2, weekday: "SATURDAY" });
  });

  it("営業日の時刻・予約上限が update/create 双方へ渡る", async () => {
    await updateBusinessHour(validInput({ reservationLimit: 4 }));

    const arg = businessHourUpsert.mock.calls[0][0] as UpsertArg;
    expect(timeColToHHMM(arg.update.openTime)).toBe("09:00");
    expect(timeColToHHMM(arg.update.closeTime)).toBe("18:30");
    expect(timeColToHHMM(arg.update.breakStart)).toBe("12:00");
    expect(timeColToHHMM(arg.update.breakEnd)).toBe("13:00");
    expect(arg.update.reservationLimit).toBe(4);
    expect(arg.update.isOpen).toBe(true);
    // create 側も同じ値(行が無い場合の復旧用)。
    expect(timeColToHHMM(arg.create.openTime)).toBe("09:00");
    expect(arg.create.reservationLimit).toBe(4);
  });
});

describe("updateBusinessHour — 休診日の時刻 null 正規化", () => {
  it("isOpen=false なら時刻系(open/close/break)は null に正規化される", async () => {
    const result = await updateBusinessHour(
      validInput({ isOpen: false, openTime: undefined, closeTime: undefined, breakStart: undefined, breakEnd: undefined }),
    );

    expect(result.ok).toBe(true);
    const arg = businessHourUpsert.mock.calls[0][0] as UpsertArg;
    expect(arg.update.openTime).toBeNull();
    expect(arg.update.closeTime).toBeNull();
    expect(arg.update.breakStart).toBeNull();
    expect(arg.update.breakEnd).toBeNull();
    expect(arg.update.isOpen).toBe(false);
  });

  it("isOpen=false のときは時刻が入力されていても null に正規化する", async () => {
    // フォームで営業→休診に切り替えた際、入力欄に古い時刻が残っていても休診として保存する。
    await updateBusinessHour(validInput({ isOpen: false }));

    const arg = businessHourUpsert.mock.calls[0][0] as UpsertArg;
    expect(arg.update.openTime).toBeNull();
    expect(arg.update.closeTime).toBeNull();
    expect(arg.update.breakStart).toBeNull();
    expect(arg.update.breakEnd).toBeNull();
  });
});

describe("updateBusinessHour — バリデーションエラー(DB を触らない)", () => {
  it("営業日で開始時刻未入力は VALIDATION_ERROR で upsert しない", async () => {
    const result = await updateBusinessHour(validInput({ openTime: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("開始 08:59(外枠違反)は VALIDATION_ERROR", async () => {
    const result = await updateBusinessHour(validInput({ openTime: "08:59" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
  });

  it("終了 18:31(外枠違反)は VALIDATION_ERROR", async () => {
    const result = await updateBusinessHour(validInput({ closeTime: "18:31" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
  });

  it("終了が開始より前は VALIDATION_ERROR", async () => {
    const result = await updateBusinessHour(
      validInput({ openTime: "13:00", closeTime: "12:00", breakStart: undefined, breakEnd: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
  });

  it("予約上限が負数は VALIDATION_ERROR", async () => {
    const result = await updateBusinessHour(validInput({ reservationLimit: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
  });

  it("予約上限が非整数は VALIDATION_ERROR", async () => {
    const result = await updateBusinessHour(validInput({ reservationLimit: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(businessHourUpsert).not.toHaveBeenCalled();
  });

  it("VALIDATION_ERROR は fieldErrors を返す", async () => {
    const result = await updateBusinessHour(validInput({ openTime: "08:00" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors).toBeTruthy();
  });
});

describe("updateBusinessHour — 認可", () => {
  it("未認証(UnauthorizedError)なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const result = await updateBusinessHour(validInput());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(businessHourUpsert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateBusinessHour — DB エラー", () => {
  it("upsert が失敗したら INTERNAL_ERROR を返し revalidate しない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    businessHourUpsert.mockRejectedValue(new Error("DB down"));

    const result = await updateBusinessHour(validInput());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(revalidatePath).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
