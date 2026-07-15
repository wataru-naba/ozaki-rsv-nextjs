import { TYPE_OPTIONS } from "@/lib/reservation/publicTypes";
import { minutesToTimeStr, timeColToMinutes } from "@/lib/reservation/time";
import type { Weekday } from "@prisma/client";

/**
 * 管理画面の表示ラベル導出(db-schema.md 3-7 節方針)。
 *
 * 種別(typeLabel)は DB に保存された自由文字列ではなく、typeId から
 * アプリケーション定数(TYPE_OPTIONS)を用いて導出する。
 */

/** 予約種別ラベル(typeId → 来店経験ラベル)。要件 3-2 節。 */
export function reservationTypeLabel(typeId: number): string {
  return TYPE_OPTIONS.find((t) => t.typeId === typeId)?.label ?? `種別 ${typeId}`;
}

/** 曜日区分(Weekday enum)の日本語表示。 */
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  SUNDAY: "日曜",
  MONDAY: "月曜",
  TUESDAY: "火曜",
  WEDNESDAY: "水曜",
  THURSDAY: "木曜",
  FRIDAY: "金曜",
  SATURDAY: "土曜",
  PUBLIC_HOLIDAY: "祝日",
};

/** 表示順を固定するための曜日区分並び(日→土→祝日)。 */
export const WEEKDAY_ORDER: Weekday[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "PUBLIC_HOLIDAY",
];

/** @db.Time カラム(Date | null)を "HH:MM"(未設定は "")へ整形。フォーム初期値用。 */
export function timeColToInputValue(t: Date | null): string {
  const m = timeColToMinutes(t);
  return m == null ? "" : minutesToTimeStr(m);
}
