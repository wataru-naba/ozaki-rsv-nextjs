/**
 * 予約判定ロジックで使う業務定数。
 *
 * 出典・根拠:
 * - typeId ⇔ 所要時間: 要件ドキュメント 3-2節(0=90分 / 1=60分 / 2=30分)
 * - ラストオーダー制限: 要件ドキュメント A章(日向=5時間前 / 延岡=1.5時間前)
 * - 営業時間の外枠 9:00-18:30: 要件ドキュメント 3-10 / 4章(確定事項。候補生成の絶対範囲)
 * - タイムゾーン: 全処理で Asia/Tokyo(要件 4章 確定事項)
 */

/** typeId(来店経験)→ 所要時間(分)。要件 3-2節。 */
export const TYPE_DURATION_MINUTES: Record<number, number> = {
  0: 90, // 一度も来店したことがない・わからない
  1: 60, // 今月ははじめて来店する
  2: 30, // 今月に来店した事がある
};

/** 拠点コード。Place.code と一致させる。 */
export type PlaceCode = "HYUGA" | "NOBEOKA";

/**
 * 拠点別ラストオーダー制限(時間)。要件 A章。
 * 「現在時刻 + この時間」より前に始まる枠は締め切る(直前予約の抑止)。
 */
export const LAST_ORDER_HOURS: Record<PlaceCode, number> = {
  HYUGA: 5,
  NOBEOKA: 1.5,
};

/** 営業時間の外枠(分単位・0時起点)。9:00 = 540 / 18:30 = 1110。要件 3-10 / 4章。 */
export const OUTER_OPEN_MINUTES = 9 * 60; // 540
export const OUTER_CLOSE_MINUTES = 18 * 60 + 30; // 1110

/** 予約枠の刻み(分)。30分単位。要件 A章。 */
export const SLOT_STEP_MINUTES = 30;

/** 予約可能範囲(当日から何日先まで生成するか)。要件 A章(当日〜21日先)。 */
export const AVAILABILITY_DAYS = 21;

/** 3段階表示の境界。残数がこの値以上なら「予約可能(○)」、1〜(この値-1)なら「残りわずか(△)」。要件 3-1節。 */
export const FEW_THRESHOLD = 4;
