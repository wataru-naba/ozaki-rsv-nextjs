import { beforeEach, describe, it, expect, vi } from "vitest";
import { Weekday } from "@prisma/client";

/**
 * US-002 空き状況取得(availability.ts)の統合テスト。
 * Prisma をモックし、判定ロジックとの結線・JST↔UTC の「広め取り込み」範囲を検証する。
 *
 * 検証観点(ADR 0001 / user-stories US-002):
 * - 当日(from)〜21日先までの 30分刻みの枠が生成される。
 * - reservationSlot 取得範囲が JST↔UTC のずれを吸収する形で前後1日ぶん広く取られ、
 *   端の枠(初日09:00・最終日の最終枠)を取りこぼさない。
 * - DB の占有数(count)が getTime() キー一致で正しく各枠へ反映される。
 */

const placeFindUnique = vi.fn();
const businessHourFindMany = vi.fn();
const publicHolidayFindMany = vi.fn();
const closureFindMany = vi.fn();
const reservationSlotFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    businessHour: { findMany: (...a: unknown[]) => businessHourFindMany(...a) },
    publicHoliday: { findMany: (...a: unknown[]) => publicHolidayFindMany(...a) },
    closure: { findMany: (...a: unknown[]) => closureFindMany(...a) },
    reservationSlot: { findMany: (...a: unknown[]) => reservationSlotFindMany(...a) },
  },
}));

import { getAvailability } from "@/lib/reservation/availability";
import {
  jstDateStrToInstant,
  dateStrToDateCol,
  addDaysToDateStr,
  jstPartsOfInstant,
} from "@/lib/reservation/time";
import { candidateStartMinutes } from "@/lib/reservation/judge";

function timeCol(hh: number, mm = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hh, mm, 0, 0));
}

function openHoursForAllWeekdays() {
  return Object.values(Weekday).map((w, i) => ({
    id: i + 1,
    placeId: 1,
    weekday: w,
    isOpen: true,
    openTime: timeCol(9, 0),
    closeTime: timeCol(18, 30),
    breakStart: null,
    breakEnd: null,
    reservationLimit: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

// getAvailability は内部で new Date() を基準にラストオーダー判定するため、
// 実行時刻に依存しないよう「JST の当日 + 2日」を起点にする(09:00 枠が確実に
// 最長ラストオーダー(日向5h)より先=締切外になる)。範囲・キー検証はこの from に対して決定的。
const FROM = addDaysToDateStr(jstPartsOfInstant(new Date()).dateStr, 2);
const LAST_DATE = addDaysToDateStr(FROM, 20);

beforeEach(() => {
  vi.clearAllMocks();
  placeFindUnique.mockResolvedValue({ id: 1, code: "HYUGA", name: "日向" });
  businessHourFindMany.mockResolvedValue(openHoursForAllWeekdays());
  publicHolidayFindMany.mockResolvedValue([]);
  closureFindMany.mockResolvedValue([]);
  reservationSlotFindMany.mockResolvedValue([]);
});

describe("getAvailability: 範囲と粒度", () => {
  it("from から21日ぶん、各日は30分刻みの枠を返す", async () => {
    const res = await getAvailability({ place: "HYUGA", typeId: 2, from: FROM });
    expect(res.days).toHaveLength(21);
    expect(res.days[0].date).toBe(FROM);
    expect(res.days[20].date).toBe(LAST_DATE);
    expect(res.durationMinutes).toBe(30);
    // 各日のスロット数 = 候補開始枠数(30分は19本)
    expect(res.days[0].slots).toHaveLength(candidateStartMinutes(2).length);
    expect(res.days[0].slots[0].time).toBe("09:00");
    expect(res.days[0].slots[res.days[0].slots.length - 1].time).toBe("18:00");
  });
});

describe("getAvailability: JST↔UTC 広め取り込み範囲", () => {
  it("reservationSlot 取得範囲が前後1日ぶん広く、端の枠を含む", async () => {
    await getAvailability({ place: "HYUGA", typeId: 2, from: FROM });

    const where = reservationSlotFindMany.mock.calls[0][0].where;
    const gte: Date = where.startAt.gte;
    const lt: Date = where.startAt.lt;

    // 「広め取り込み」= 範囲の前後を24時間ずつ拡張していること。
    const rangeStart = dateStrToDateCol(FROM);
    const rangeEnd = dateStrToDateCol(addDaysToDateStr(FROM, 21));
    expect(gte.getTime()).toBe(rangeStart.getTime() - 24 * 3600_000);
    expect(lt.getTime()).toBe(rangeEnd.getTime() + 24 * 3600_000);

    // 端の実枠(初日09:00・最終日18:00)が取得範囲 [gte, lt) に確実に収まる。
    const firstSlot = jstDateStrToInstant(FROM, 9 * 60).getTime();
    const lastSlot = jstDateStrToInstant(LAST_DATE, 18 * 60).getTime();
    expect(gte.getTime()).toBeLessThanOrEqual(firstSlot);
    expect(lt.getTime()).toBeGreaterThan(lastSlot);
  });

  it("DB の占有数が getTime() キー一致で正しい枠へ反映される", async () => {
    // 初日09:00 の枠を満枠(count=limit=4)にする。
    const fullKey = jstDateStrToInstant(FROM, 9 * 60);
    reservationSlotFindMany.mockResolvedValue([{ startAt: fullKey, count: 4 }]);

    const res = await getAvailability({ place: "HYUGA", typeId: 2, from: FROM });
    const day0 = res.days[0];
    expect(day0.slots.find((s) => s.time === "09:00")?.status).toBe("UNAVAILABLE");
    // 他の枠は空いている(count 0, limit 4 → 残4 = AVAILABLE)。
    expect(day0.slots.find((s) => s.time === "09:30")?.status).toBe("AVAILABLE");
  });
});
