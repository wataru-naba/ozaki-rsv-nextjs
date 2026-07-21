import { describe, it, expect } from "vitest";
import { UpdateBusinessHourSchema, CreateClosureSchema } from "@/lib/admin/settingsSchemas";

/**
 * US-008 曜日別営業設定の入力バリデーション(api-design.md 5.3 節)。
 *
 * BusinessHour 編集スキーマ(UpdateBusinessHourSchema)の受け入れ条件を検証する:
 * - 営業日は開始・終了時刻が必須(休診日は時刻未入力でも可)。
 * - 外枠 9:00-18:30(開始 9:00 未満・終了 18:30 超は拒否。境界値はちょうど許可)。
 * - 終了時刻が開始時刻より前の不正な範囲は拒否。
 * - 予約上限は 0 以上の整数(負数・非整数は拒否)。
 *
 * 不定休(Closure)関連は US-009 の範囲のため本 US では対象外(スキーマも本 US には含めない)。
 */

/** 妥当な基準入力(営業日)。各テストで差分だけ上書きする。 */
function base(over: Partial<Record<string, unknown>> = {}) {
  return {
    placeId: 1,
    weekday: "MONDAY" as const,
    isOpen: true,
    openTime: "09:00",
    closeTime: "18:30",
    reservationLimit: 2,
    ...over,
  };
}

describe("UpdateBusinessHourSchema: 営業日の開始・終了時刻の必須", () => {
  it("営業日で開始・終了時刻がそろっていれば通る", () => {
    expect(UpdateBusinessHourSchema.safeParse(base()).success).toBe(true);
  });

  it("営業日で開始時刻が未入力なら拒否される", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ openTime: undefined }));
    expect(r.success).toBe(false);
  });

  it("営業日で終了時刻が未入力なら拒否される", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ closeTime: undefined }));
    expect(r.success).toBe(false);
  });

  it("休診日(isOpen=false)は時刻未入力でも通る", () => {
    const r = UpdateBusinessHourSchema.safeParse(
      base({ isOpen: false, openTime: undefined, closeTime: undefined }),
    );
    expect(r.success).toBe(true);
  });
});

describe("UpdateBusinessHourSchema: 外枠 9:00-18:30 の強制", () => {
  it("開始 09:00 ちょうどは許可(下限境界)", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ openTime: "09:00" })).success).toBe(true);
  });

  it("開始 08:59(9:00 の1分前)は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ openTime: "08:59" })).success).toBe(false);
  });

  it("開始 08:00 は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ openTime: "08:00" })).success).toBe(false);
  });

  it("終了 18:30 ちょうどは許可(上限境界)", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ closeTime: "18:30" })).success).toBe(true);
  });

  it("終了 18:31(18:30 の1分後)は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ closeTime: "18:31" })).success).toBe(false);
  });

  it("終了 19:00 は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ closeTime: "19:00" })).success).toBe(false);
  });

  it("外枠違反のエラーは開始/終了フィールドに紐づく", () => {
    const early = UpdateBusinessHourSchema.safeParse(base({ openTime: "08:00" }));
    expect(early.success).toBe(false);
    if (!early.success) {
      const paths = early.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("openTime");
    }
    const late = UpdateBusinessHourSchema.safeParse(base({ closeTime: "19:00" }));
    expect(late.success).toBe(false);
    if (!late.success) {
      const paths = late.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("closeTime");
    }
  });
});

describe("UpdateBusinessHourSchema: 開始・終了の範囲整合", () => {
  it("終了時刻が開始時刻より前は拒否", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ openTime: "13:00", closeTime: "12:00" }));
    expect(r.success).toBe(false);
  });

  it("開始 == 終了(0分営業)は拒否", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ openTime: "10:00", closeTime: "10:00" }));
    expect(r.success).toBe(false);
  });

  it("開始 < 終了(正常)は通る", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ openTime: "09:00", closeTime: "17:00" }));
    expect(r.success).toBe(true);
  });
});

describe("UpdateBusinessHourSchema: 休憩時間の整合", () => {
  it("休憩を入れない(両方未入力)場合は通る", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ breakStart: undefined, breakEnd: undefined }));
    expect(r.success).toBe(true);
  });

  it("休憩開始・終了が営業時間内で開始<終了なら通る", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ breakStart: "12:00", breakEnd: "13:00" }));
    expect(r.success).toBe(true);
  });

  it("休憩の片方だけ入力は拒否", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ breakStart: "12:00", breakEnd: undefined }));
    expect(r.success).toBe(false);
  });

  it("休憩開始 >= 休憩終了は拒否", () => {
    const r = UpdateBusinessHourSchema.safeParse(base({ breakStart: "13:00", breakEnd: "12:00" }));
    expect(r.success).toBe(false);
  });

  it("休憩が営業時間外(開始が営業開始より前)は拒否", () => {
    const r = UpdateBusinessHourSchema.safeParse(
      base({ openTime: "10:00", breakStart: "09:30", breakEnd: "10:30" }),
    );
    expect(r.success).toBe(false);
  });
});

describe("UpdateBusinessHourSchema: 予約上限のバリデーション", () => {
  it("0 は許可(上限0=実質受付停止も設定可能)", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ reservationLimit: 0 })).success).toBe(true);
  });

  it("正の整数は許可", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ reservationLimit: 5 })).success).toBe(true);
  });

  it("負数は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ reservationLimit: -1 })).success).toBe(false);
  });

  it("非整数(小数)は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ reservationLimit: 1.5 })).success).toBe(false);
  });
});

describe("UpdateBusinessHourSchema: 時刻フォーマット", () => {
  it("HH:MM 以外の開始時刻は拒否", () => {
    expect(UpdateBusinessHourSchema.safeParse(base({ openTime: "9:00" })).success).toBe(false);
  });
});

/**
 * US-009 不定休(Closure)登録の入力バリデーション(api-design.md 5.4 節)。
 *
 * - 終日休診(isAllDay=true)は時刻未入力でも通る。
 * - 時間帯休診(isAllDay=false)は開始・終了時刻が必須。
 * - 終了時刻が開始時刻より前(または同一)は拒否。
 * - 日付・時刻フォーマット不正は拒否。
 */
function closureBase(over: Partial<Record<string, unknown>> = {}) {
  return {
    placeId: 1,
    date: "2026-08-01",
    isAllDay: true,
    ...over,
  };
}

describe("CreateClosureSchema: 終日休診", () => {
  it("終日休診(isAllDay=true)は時刻未入力でも通る", () => {
    expect(CreateClosureSchema.safeParse(closureBase()).success).toBe(true);
  });

  it("終日休診なら時刻が入力されていても通る(時刻は無視される想定)", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: true, startTime: "10:00", endTime: "12:00" }),
    );
    expect(r.success).toBe(true);
  });
});

describe("CreateClosureSchema: 時間帯休診の開始・終了必須", () => {
  it("時間帯休診で開始・終了がそろっていれば通る", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "10:00", endTime: "12:00" }),
    );
    expect(r.success).toBe(true);
  });

  it("時間帯休診で開始時刻が未入力なら拒否", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: undefined, endTime: "12:00" }),
    );
    expect(r.success).toBe(false);
  });

  it("時間帯休診で終了時刻が未入力なら拒否", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "10:00", endTime: undefined }),
    );
    expect(r.success).toBe(false);
  });

  it("時間帯休診で開始・終了とも未入力なら拒否", () => {
    const r = CreateClosureSchema.safeParse(closureBase({ isAllDay: false }));
    expect(r.success).toBe(false);
  });

  it("開始・終了必須違反のエラーは startTime に紐づく", () => {
    const r = CreateClosureSchema.safeParse(closureBase({ isAllDay: false }));
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("startTime");
    }
  });
});

describe("CreateClosureSchema: 開始・終了の範囲整合", () => {
  it("終了時刻が開始時刻より前は拒否", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "12:00", endTime: "10:00" }),
    );
    expect(r.success).toBe(false);
  });

  it("開始 == 終了は拒否", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "10:00", endTime: "10:00" }),
    );
    expect(r.success).toBe(false);
  });

  it("開始 < 終了(正常)は通る", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "10:00", endTime: "10:30" }),
    );
    expect(r.success).toBe(true);
  });
});

describe("CreateClosureSchema: 日付・時刻フォーマット", () => {
  it("YYYY-MM-DD 以外の日付は拒否", () => {
    expect(CreateClosureSchema.safeParse(closureBase({ date: "2026/08/01" })).success).toBe(false);
  });

  it("HH:MM 以外の時刻は拒否", () => {
    const r = CreateClosureSchema.safeParse(
      closureBase({ isAllDay: false, startTime: "9:00", endTime: "12:00" }),
    );
    expect(r.success).toBe(false);
  });
});
