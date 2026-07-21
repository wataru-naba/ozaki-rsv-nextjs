import { describe, it, expect } from "vitest";
import { Weekday } from "@prisma/client";
import type { BusinessHour, Closure } from "@prisma/client";
import {
  judgeCandidate,
  candidateStartMinutes,
  resolveBusinessHour,
  type PreloadedJudgeData,
} from "@/lib/reservation/judge";
import { jstDateStrToInstant } from "@/lib/reservation/time";
import { LAST_ORDER_HOURS } from "@/lib/reservation/constants";

/**
 * US-002 空き状況判定(judge.ts)の純粋関数テスト。
 * DB モック不要。データ整合性隣接領域として ADR 0001 で必須指定されたケースを網羅する。
 *
 * 判定順序: 0.外枠 → 1.ラストオーダー → 2.祝日/休診 → 3.不定休/営業時間/休憩 → 4.枠使用状況。
 */

/** @db.Time カラム相当の Date(UTC の時刻として読まれる)。 */
function timeCol(hh: number, mm = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hh, mm, 0, 0));
}

/** テスト用 BusinessHour(既定: 9:00-18:30 営業、休憩 13:00-14:00、上限 4)。 */
function bh(overrides: Partial<BusinessHour> = {}): BusinessHour {
  return {
    id: 1,
    placeId: 1,
    weekday: Weekday.MONDAY,
    isOpen: true,
    openTime: timeCol(9, 0),
    closeTime: timeCol(18, 30),
    breakStart: timeCol(13, 0),
    breakEnd: timeCol(14, 0),
    reservationLimit: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** 全曜日区分(PUBLIC_HOLIDAY 含む)を同一設定で埋めた Map を作る。 */
function allWeekdayHours(base: BusinessHour): Map<Weekday, BusinessHour> {
  const map = new Map<Weekday, BusinessHour>();
  for (const w of Object.values(Weekday)) {
    map.set(w, { ...base, weekday: w });
  }
  return map;
}

function closure(overrides: Partial<Closure> = {}): Closure {
  return {
    id: 1,
    placeId: 1,
    date: new Date("2026-08-03T00:00:00.000Z"),
    isAllDay: false,
    startTime: null,
    endTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** 既定の判定データ(now は十分過去=ラストオーダーで弾かれない)。 */
function pre(overrides: Partial<PreloadedJudgeData> = {}): PreloadedJudgeData {
  return {
    now: new Date("2026-01-01T00:00:00.000Z"),
    businessHoursByWeekday: allWeekdayHours(bh()),
    holidayDates: new Set<string>(),
    closuresByDate: new Map<string, Closure[]>(),
    slotCounts: new Map<number, number>(),
    ...overrides,
  };
}

const DATE = "2026-08-03"; // 通常営業日(月曜)
const START_10 = 10 * 60; // 10:00

describe("judgeCandidate: 3段階しきい値(残数)", () => {
  it("残数0(count==limit)は予約不可 CAPACITY_FULL", () => {
    const key = jstDateStrToInstant(DATE, START_10).getTime();
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      slotCounts: new Map([[key, 4]]), // limit 4
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "CAPACITY_FULL" });
  });

  it("残数1〜3は残りわずか FEW", () => {
    const key = jstDateStrToInstant(DATE, START_10).getTime();
    for (const [count, remaining] of [[3, 1], [2, 2], [1, 3]]) {
      const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
        slotCounts: new Map([[key, count]]),
      }));
      expect(r, `count=${count} (remaining=${remaining})`).toEqual({ status: "FEW" });
    }
  });

  it("残数4以上は予約可能 AVAILABLE", () => {
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre()); // count 0, limit 4 → 残4
    expect(r).toEqual({ status: "AVAILABLE" });
  });

  it("しきい値境界: 残数3はFEW / 残数4はAVAILABLE(limit=5)", () => {
    const key = jstDateStrToInstant(DATE, START_10).getTime();
    const few = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      businessHoursByWeekday: allWeekdayHours(bh({ reservationLimit: 5 })),
      slotCounts: new Map([[key, 2]]), // 残3
    }));
    expect(few).toEqual({ status: "FEW" });
    const ok = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      businessHoursByWeekday: allWeekdayHours(bh({ reservationLimit: 5 })),
      slotCounts: new Map([[key, 1]]), // 残4
    }));
    expect(ok).toEqual({ status: "AVAILABLE" });
  });
});

describe("judgeCandidate: 複数枠またぎ(90分=連続3枠)", () => {
  const START_90 = 10 * 60; // 10:00-11:30(サブ枠 10:00 / 10:30 / 11:00)

  it("連続3枠すべて空きなら予約可能", () => {
    const r = judgeCandidate("HYUGA", DATE, START_90, 0, pre());
    expect(r).toEqual({ status: "AVAILABLE" });
  });

  it("区間内最小残数で3段階化される(中間枠が残1なら全体FEW)", () => {
    const mid = jstDateStrToInstant(DATE, START_90 + 30).getTime();
    const r = judgeCandidate("HYUGA", DATE, START_90, 0, pre({
      slotCounts: new Map([[mid, 3]]), // 中間だけ残1
    }));
    expect(r).toEqual({ status: "FEW" });
  });

  it("1枠でも満枠なら予約不可 CAPACITY_FULL", () => {
    const last = jstDateStrToInstant(DATE, START_90 + 60).getTime();
    const r = judgeCandidate("HYUGA", DATE, START_90, 0, pre({
      slotCounts: new Map([[last, 4]]), // 末尾サブ枠が満枠
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "CAPACITY_FULL" });
  });

  it("90分枠が休憩時間(13:00-14:00)に掛かると不可 OUTSIDE_BUSINESS_HOURS", () => {
    const r = judgeCandidate("HYUGA", DATE, 12 * 60 + 30, 0, pre()); // 12:30-14:00 が休憩に重なる
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" });
  });

  it("90分枠の終了が営業終了(18:30)を超えると不可", () => {
    // 17:30-19:00 は closeTime 18:30 を超える
    const r = judgeCandidate("HYUGA", DATE, 17 * 60 + 30, 0, pre());
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" });
  });
});

describe("judgeCandidate: ラストオーダー境界(日向5h/延岡1.5h)", () => {
  // startAt < now + lastOrderMs のとき締切(境界ちょうどは締め切らない=可)。
  const startAt = jstDateStrToInstant(DATE, START_10);

  it("日向: ちょうど5時間前(境界)は締め切らない=予約可能", () => {
    const now = new Date(startAt.getTime() - LAST_ORDER_HOURS.HYUGA * 3600_000);
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({ now }));
    expect(r).toEqual({ status: "AVAILABLE" });
  });

  it("日向: 5時間前を1msでも過ぎたら不可 LAST_ORDER_PASSED", () => {
    const now = new Date(startAt.getTime() - LAST_ORDER_HOURS.HYUGA * 3600_000 + 1);
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({ now }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "LAST_ORDER_PASSED" });
  });

  it("延岡: ちょうど1.5時間前(境界)は締め切らない=予約可能", () => {
    const now = new Date(startAt.getTime() - LAST_ORDER_HOURS.NOBEOKA * 3600_000);
    const r = judgeCandidate("NOBEOKA", DATE, START_10, 2, pre({ now }));
    expect(r).toEqual({ status: "AVAILABLE" });
  });

  it("延岡: 1.5時間前を過ぎたら不可 LAST_ORDER_PASSED", () => {
    const now = new Date(startAt.getTime() - LAST_ORDER_HOURS.NOBEOKA * 3600_000 + 1);
    const r = judgeCandidate("NOBEOKA", DATE, START_10, 2, pre({ now }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "LAST_ORDER_PASSED" });
  });

  it("拠点でラストオーダーが異なる(同時刻でも日向は不可・延岡は可)", () => {
    // now を「3時間前」に置く: 日向(5h)は締切、延岡(1.5h)は締切外。
    const now = new Date(startAt.getTime() - 3 * 3600_000);
    expect(judgeCandidate("HYUGA", DATE, START_10, 2, pre({ now })).status).toBe("UNAVAILABLE");
    expect(judgeCandidate("NOBEOKA", DATE, START_10, 2, pre({ now })).status).toBe("AVAILABLE");
  });
});

describe("judgeCandidate: 祝日・休診・不定休", () => {
  it("祝日(PUBLIC_HOLIDAY 区分が休診)なら不可 HOLIDAY_CLOSED", () => {
    const hours = allWeekdayHours(bh());
    hours.set(Weekday.PUBLIC_HOLIDAY, bh({ weekday: Weekday.PUBLIC_HOLIDAY, isOpen: false }));
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      businessHoursByWeekday: hours,
      holidayDates: new Set([DATE]),
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "HOLIDAY_CLOSED" });
  });

  it("終日休診(isOpen=false)なら不可 HOLIDAY_CLOSED", () => {
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      businessHoursByWeekday: allWeekdayHours(bh({ isOpen: false })),
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "HOLIDAY_CLOSED" });
  });

  it("終日不定休なら不可 CLOSURE", () => {
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      closuresByDate: new Map([[DATE, [closure({ isAllDay: true })]]]),
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "CLOSURE" });
  });

  it("時間帯不定休に重なる枠は不可 CLOSURE", () => {
    const c = closure({ isAllDay: false, startTime: timeCol(10, 0), endTime: timeCol(11, 0) });
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      closuresByDate: new Map([[DATE, [c]]]),
    }));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "CLOSURE" });
  });

  it("時間帯不定休の範囲外の枠は影響を受けない", () => {
    const c = closure({ isAllDay: false, startTime: timeCol(15, 0), endTime: timeCol(16, 0) });
    const r = judgeCandidate("HYUGA", DATE, START_10, 2, pre({
      closuresByDate: new Map([[DATE, [c]]]),
    }));
    expect(r).toEqual({ status: "AVAILABLE" });
  });
});

describe("resolveBusinessHour: 祝日は PUBLIC_HOLIDAY 区分を優先", () => {
  it("祝日登録日は PUBLIC_HOLIDAY の設定が使われる", () => {
    const hours = allWeekdayHours(bh({ reservationLimit: 4 }));
    hours.set(Weekday.PUBLIC_HOLIDAY, bh({ weekday: Weekday.PUBLIC_HOLIDAY, reservationLimit: 99 }));
    const resolved = resolveBusinessHour(DATE, pre({
      businessHoursByWeekday: hours,
      holidayDates: new Set([DATE]),
    }));
    expect(resolved?.weekday).toBe(Weekday.PUBLIC_HOLIDAY);
    expect(resolved?.reservationLimit).toBe(99);
  });

  it("非祝日は曜日区分が使われる", () => {
    const resolved = resolveBusinessHour(DATE, pre()); // 2026-08-03 は月曜
    expect(resolved?.weekday).toBe(Weekday.MONDAY);
  });
});

describe("candidateStartMinutes: 所要時間ごとの候補開始枠", () => {
  it("30分(typeId2)は 9:00〜18:00 の 30分刻み(19本)", () => {
    const list = candidateStartMinutes(2);
    expect(list[0]).toBe(9 * 60);
    expect(list[list.length - 1]).toBe(18 * 60); // 18:00-18:30 が最後
    expect(list.length).toBe(19);
  });

  it("90分(typeId0)は終了が18:30を超えない範囲まで(最後は17:00)", () => {
    const list = candidateStartMinutes(0);
    expect(list[0]).toBe(9 * 60);
    expect(list[list.length - 1]).toBe(17 * 60); // 17:00-18:30 が最後
  });
});
