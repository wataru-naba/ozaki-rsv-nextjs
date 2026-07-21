import { SLOT_STEP_MINUTES } from "./constants";

/**
 * 予約が占有する 30 分サブ枠の開始時刻列を、予約の [startAt, endAt) から再計算する。
 *
 * 予約確定時に +1 した枠と、キャンセル時に -1 する枠を常に対称にするための唯一の
 * 導出ロジック(db-schema.md 3-6 節: startAt/endAt から機械的に再現できるため
 * 対応テーブルを持たない方針)。
 *
 * 返り値は必ず startAt 昇順にソート済み。予約確定・キャンセルの双方でこの順序に
 * 従ってスロットを更新することでデッドロックを回避する(api-design.md 4.4 節)。
 *
 * @param startAt 予約開始時刻(この枠を含む)
 * @param endAt   予約終了時刻(この枠は含まない = 半開区間 [startAt, endAt))
 */
export function subSlotStartsForRange(startAt: Date, endAt: Date): Date[] {
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  const starts: Date[] = [];
  for (let t = startAt.getTime(); t < endAt.getTime(); t += stepMs) {
    starts.push(new Date(t));
  }
  starts.sort((a, b) => a.getTime() - b.getTime());
  return starts;
}
