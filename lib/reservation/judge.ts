import { Weekday } from "@prisma/client";
import type { BusinessHour, Closure } from "@prisma/client";
import {
  FEW_THRESHOLD,
  LAST_ORDER_HOURS,
  OUTER_CLOSE_MINUTES,
  OUTER_OPEN_MINUTES,
  SLOT_STEP_MINUTES,
  TYPE_DURATION_MINUTES,
  type PlaceCode,
} from "./constants";
import {
  jstDateStrToInstant,
  overlaps,
  timeColToMinutes,
  weekdayOfDateStr,
} from "./time";

/**
 * 空き状況の3段階(要件 3-1)。
 * AVAILABLE = 予約可能(○) / FEW = 残りわずか(△) / UNAVAILABLE = 予約不可
 */
export type SlotStatus = "AVAILABLE" | "FEW" | "UNAVAILABLE";

/** UNAVAILABLE の内部理由(api-design.md 2.1 節。ログ/デバッグ用途)。 */
export type UnavailableReason =
  | "CAPACITY_FULL"
  | "LAST_ORDER_PASSED"
  | "HOLIDAY_CLOSED"
  | "CLOSURE"
  | "OUTSIDE_BUSINESS_HOURS";

export type JudgeResult =
  | { status: "AVAILABLE" }
  | { status: "FEW" }
  | { status: "UNAVAILABLE"; reason: UnavailableReason };

/**
 * リクエスト単位で一括ロードした判定用データ(api-design.md 3.1 節)。
 * これ以降は DB アクセスせず純粋計算のみで判定する(N+1 回避)。
 */
export type PreloadedJudgeData = {
  /** 判定基準となる現在時刻(ラストオーダー判定用)。 */
  now: Date;
  /** 曜日区分 → 営業設定。 */
  businessHoursByWeekday: Map<Weekday, BusinessHour>;
  /** 祝日として登録されている日付("YYYY-MM-DD")の集合(拠点非依存)。 */
  holidayDates: Set<string>;
  /** 日付("YYYY-MM-DD")→ その日の不定休一覧。 */
  closuresByDate: Map<string, Closure[]>;
  /** スロット開始時刻(getTime())→ 占有数。行が無い = 0。 */
  slotCounts: Map<number, number>;
};

/** JS の getUTCDay(0=日)順に並べた Weekday enum。 */
const WEEKDAY_ENUM: Weekday[] = [
  Weekday.SUNDAY,
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
];

/**
 * 指定日("YYYY-MM-DD")に適用される BusinessHour を返す。
 * 祝日マスタに載っていれば PUBLIC_HOLIDAY 区分を、そうでなければ曜日区分を使う(要件 3-8)。
 */
export function resolveBusinessHour(
  dateStr: string,
  pre: PreloadedJudgeData,
): BusinessHour | undefined {
  const isHoliday = pre.holidayDates.has(dateStr);
  const weekday = isHoliday
    ? Weekday.PUBLIC_HOLIDAY
    : WEEKDAY_ENUM[weekdayOfDateStr(dateStr)];
  return pre.businessHoursByWeekday.get(weekday);
}

/**
 * 1候補枠を判定する純粋関数(api-design.md 3.2 節)。
 * 判定順序: 0.外枠 → 1.ラストオーダー → 2.祝日/通常休診 → 3.不定休/営業時間/休憩 → 4.枠使用状況。
 * この関数が空き状況取得(GET)と予約確定の再検証(POST)の唯一の判定ロジック(10章 二重実装リスク対策)。
 */
export function judgeCandidate(
  placeCode: PlaceCode,
  dateStr: string,
  startMinutes: number,
  typeId: number,
  pre: PreloadedJudgeData,
): JudgeResult {
  const duration = TYPE_DURATION_MINUTES[typeId];
  const endMinutes = startMinutes + duration;
  const startAt = jstDateStrToInstant(dateStr, startMinutes);

  // 0. 候補生成範囲の外枠(9:00-18:30 を維持。多枠またぎで終了が超えるケースを明示再チェック)
  if (startMinutes < OUTER_OPEN_MINUTES || endMinutes > OUTER_CLOSE_MINUTES) {
    return { status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" };
  }

  // 1. ラストオーダー制限(拠点別: 日向5時間前 / 延岡1.5時間前)
  const lastOrderMs = LAST_ORDER_HOURS[placeCode] * 60 * 60 * 1000;
  if (startAt.getTime() < pre.now.getTime() + lastOrderMs) {
    return { status: "UNAVAILABLE", reason: "LAST_ORDER_PASSED" };
  }

  // 2. 祝日判定 + 通常休診判定(isOpen=false は両ケース共通)
  const bh = resolveBusinessHour(dateStr, pre);
  if (!bh || !bh.isOpen) {
    return { status: "UNAVAILABLE", reason: "HOLIDAY_CLOSED" };
  }

  // 3. 不定休判定
  const closures = pre.closuresByDate.get(dateStr) ?? [];
  for (const c of closures) {
    if (c.isAllDay) {
      return { status: "UNAVAILABLE", reason: "CLOSURE" };
    }
    const cs = timeColToMinutes(c.startTime);
    const ce = timeColToMinutes(c.endTime);
    if (cs != null && ce != null && overlaps(startMinutes, endMinutes, cs, ce)) {
      return { status: "UNAVAILABLE", reason: "CLOSURE" };
    }
  }

  // 3(続き). 営業時間・休憩時間判定
  const bhOpen = timeColToMinutes(bh.openTime);
  const bhClose = timeColToMinutes(bh.closeTime);
  if (bhOpen == null || bhClose == null) {
    // isOpen=true にもかかわらず時刻が未設定 = データ不整合。安全側に倒す。
    return { status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" };
  }
  if (startMinutes < bhOpen || endMinutes > bhClose) {
    return { status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" };
  }
  const breakStart = timeColToMinutes(bh.breakStart);
  const breakEnd = timeColToMinutes(bh.breakEnd);
  if (
    breakStart != null &&
    breakEnd != null &&
    overlaps(startMinutes, endMinutes, breakStart, breakEnd)
  ) {
    return { status: "UNAVAILABLE", reason: "OUTSIDE_BUSINESS_HOURS" };
  }

  // 4. 予約枠使用状況判定(所要時間ぶんの全30分サブ枠を判定し、最小残数で3段階化)
  let remaining = Number.POSITIVE_INFINITY;
  for (let m = startMinutes; m < endMinutes; m += SLOT_STEP_MINUTES) {
    const subStart = jstDateStrToInstant(dateStr, m);
    const count = pre.slotCounts.get(subStart.getTime()) ?? 0;
    const r = bh.reservationLimit - count;
    if (r <= 0) {
      return { status: "UNAVAILABLE", reason: "CAPACITY_FULL" };
    }
    remaining = Math.min(remaining, r);
  }

  return remaining >= FEW_THRESHOLD ? { status: "AVAILABLE" } : { status: "FEW" };
}

/**
 * 指定日・所要時間に対する候補開始時刻(0時起点の分)の配列を生成する。
 * 外枠 9:00 から 30分刻みで、終了(開始+所要)が 18:30 を超えない範囲まで。
 */
export function candidateStartMinutes(typeId: number): number[] {
  const duration = TYPE_DURATION_MINUTES[typeId];
  const result: number[] = [];
  for (
    let m = OUTER_OPEN_MINUTES;
    m + duration <= OUTER_CLOSE_MINUTES;
    m += SLOT_STEP_MINUTES
  ) {
    result.push(m);
  }
  return result;
}
