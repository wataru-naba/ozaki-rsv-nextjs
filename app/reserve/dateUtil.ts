/**
 * クライアント側で使う軽量な日付ユーティリティ。
 * サーバー専用モジュールに依存しないよう、UI 表示用途に限定して自前実装する。
 */

/** "YYYY-MM-DD" から曜日番号(0=日〜6=土)を返す。JSTの暦日として素直に解釈する。 */
export function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // 時刻を正午にして DST/TZ 起因のずれを避ける(日付部分のみが目的)
  return new Date(y, m - 1, d, 12, 0, 0).getDay();
}
