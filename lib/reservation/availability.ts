import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api/errors";
import { AVAILABILITY_DAYS, TYPE_DURATION_MINUTES } from "./constants";
import type { PlaceCode } from "./constants";
import {
  addDaysToDateStr,
  dateColToStr,
  dateStrToDateCol,
  jstPartsOfInstant,
  minutesToTimeStr,
  weekdayOfDateStr,
} from "./time";
import {
  candidateStartMinutes,
  judgeCandidate,
  type PreloadedJudgeData,
  type SlotStatus,
} from "./judge";

/** GET /api/public/availability のレスポンス型(api-design.md 2.2 節)。 */
export type AvailabilityResponse = {
  place: PlaceCode;
  typeId: number;
  durationMinutes: number;
  generatedAt: string; // ISO。ラストオーダー判定の基準時刻を明示
  days: Array<{
    date: string; // "2026-07-15"
    weekday: number; // 0(日)〜6(土)
    isPublicHoliday: boolean;
    slots: Array<{ time: string; status: SlotStatus }>;
  }>;
};

/**
 * 指定拠点・種別の空き状況(当日〜21日先、30分刻み)を計算して返す。
 * 判定に必要なマスタ・実績を一括ロードし(N+1 回避)、以降は純粋計算で判定する(api-design.md 3章)。
 */
export async function getAvailability(input: {
  place: PlaceCode;
  typeId: number;
  from?: string;
}): Promise<AvailabilityResponse> {
  const place = await prisma.place.findUnique({ where: { code: input.place } });
  if (!place) {
    throw new NotFoundError("指定された拠点が見つかりません。");
  }

  const now = new Date();
  const durationMinutes = TYPE_DURATION_MINUTES[input.typeId];

  // 生成対象の日付リスト(当日 or from から 21日分)
  const startDateStr = input.from ?? jstPartsOfInstant(now).dateStr;
  const dateStrs: string[] = [];
  for (let i = 0; i < AVAILABILITY_DAYS; i++) {
    dateStrs.push(addDaysToDateStr(startDateStr, i));
  }
  const endExclusiveDateStr = addDaysToDateStr(startDateStr, AVAILABILITY_DAYS);

  // 一括ロード範囲
  const rangeStartInstant = dateStrToDateCol(startDateStr); // JST 当日 0時 = UTC。厳密には後述のとおり十分広く取る
  const rangeEndInstant = dateStrToDateCol(endExclusiveDateStr);
  const rangeStartDateCol = dateStrToDateCol(startDateStr);
  const rangeEndDateCol = dateStrToDateCol(endExclusiveDateStr);

  const [businessHours, holidays, closures, slots] = await Promise.all([
    prisma.businessHour.findMany({ where: { placeId: place.id } }),
    prisma.publicHoliday.findMany({
      where: { date: { gte: rangeStartDateCol, lt: rangeEndDateCol } },
    }),
    prisma.closure.findMany({
      where: { placeId: place.id, date: { gte: rangeStartDateCol, lt: rangeEndDateCol } },
    }),
    prisma.reservationSlot.findMany({
      // JST の日付範囲を UTC 絶対時刻に読み替えると最大 9時間ぶんずれるため、
      // 前後1日ぶん広めに取得して取りこぼしを防ぐ(絞り込みは判定時の getTime() 一致で行う)。
      where: {
        placeId: place.id,
        startAt: {
          gte: new Date(rangeStartInstant.getTime() - 24 * 60 * 60 * 1000),
          lt: new Date(rangeEndInstant.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  const pre: PreloadedJudgeData = {
    now,
    businessHoursByWeekday: new Map(businessHours.map((bh) => [bh.weekday, bh])),
    holidayDates: new Set(holidays.map((h) => dateColToStr(h.date))),
    closuresByDate: groupClosuresByDate(closures),
    slotCounts: new Map(slots.map((s) => [s.startAt.getTime(), s.count])),
  };

  const startMinutesList = candidateStartMinutes(input.typeId);

  const days = dateStrs.map((dateStr) => ({
    date: dateStr,
    weekday: weekdayOfDateStr(dateStr),
    isPublicHoliday: pre.holidayDates.has(dateStr),
    slots: startMinutesList.map((startMinutes) => {
      const result = judgeCandidate(input.place, dateStr, startMinutes, input.typeId, pre);
      return { time: minutesToTimeStr(startMinutes), status: result.status };
    }),
  }));

  return {
    place: input.place,
    typeId: input.typeId,
    durationMinutes,
    generatedAt: now.toISOString(),
    days,
  };
}

function groupClosuresByDate<T extends { date: Date }>(closures: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const c of closures) {
    const key = dateColToStr(c.date);
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  return map;
}
