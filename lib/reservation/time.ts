/**
 * Asia/Tokyo(JST, UTC+9 固定・DST無し)前提の日時ユーティリティ。
 *
 * 方針:
 * - JST は年間を通じてオフセットが +9:00 で固定のため、外部ライブラリ(dayjs等)を
 *   導入せず、UTC を +9h ずらして「JST の壁時計(wall-clock)」を読む方式で扱う。
 * - 日内の比較(営業時間・休憩・不定休の時間帯)は「0時起点の分(minutes-of-day)」で行う。
 * - 絶対時刻(ラストオーダー判定・スロットの一意キー)は Date(UTC epoch)で扱う。
 *
 * Prisma のカラム型との対応:
 * - @db.Time (openTime等)      : 1970-01-01 の UTC 時刻として返るため getUTC* で読む。
 * - @db.Date (PublicHoliday.date): UTC 0時として返るため getUTC* で "YYYY-MM-DD" を組む。
 * - @db.Timestamptz (startAt等) : 絶対時刻。getTime() を一意キーに用いる。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** JST の「年・月(0起点)・日・曜日・YYYY-MM-DD」を、ある絶対時刻から取り出す。 */
export function jstPartsOfInstant(instant: Date): {
  year: number;
  month0: number;
  day: number;
  weekday: number; // 0(日)〜6(土)
  dateStr: string; // "2026-07-15"
} {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month0 = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const weekday = shifted.getUTCDay();
  return { year, month0, day, weekday, dateStr: `${year}-${pad2(month0 + 1)}-${pad2(day)}` };
}

/** JST 壁時計(日付文字列 + 0時起点の分)を絶対時刻(Date)に変換する。 */
export function jstDateStrToInstant(dateStr: string, minutesOfDay: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  // UTC = JST - 9h。Date.UTC は桁あふれ(負の時・翌日繰り上がり)を正しく処理する。
  return new Date(Date.UTC(y, m - 1, d, hour - 9, minute, 0, 0));
}

/** カレンダー日付("YYYY-MM-DD")の曜日(0〜6)。曜日はタイムゾーン非依存。 */
export function weekdayOfDateStr(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

/** "YYYY-MM-DD" に日数を加算した新しい日付文字列を返す。 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** @db.Time カラムの Date を「0時起点の分」に変換する(null 透過)。 */
export function timeColToMinutes(t: Date | null | undefined): number | null {
  if (!t) return null;
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** @db.Date カラム(PublicHoliday.date / Closure.date)の Date を "YYYY-MM-DD" にする。 */
export function dateColToStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" を @db.Date 用の Date(UTC 0時)に変換する。 */
export function dateStrToDateCol(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** "HH:MM" を 0時起点の分に変換する。 */
export function timeStrToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 0時起点の分を "HH:MM" 表記にする。 */
export function minutesToTimeStr(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** 2つの半開区間 [aStart, aEnd) と [bStart, bEnd) が重なるか。 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** メール等の表示用: 絶対時刻を "2026-07-15(水) 09:00" 形式(JST)にする。 */
export function formatJstDateTime(instant: Date): string {
  const p = jstPartsOfInstant(instant);
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS);
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());
  return `${p.dateStr}(${WEEKDAY_JP[p.weekday]}) ${hh}:${mm}`;
}

/** メール等の表示用: 絶対時刻を "09:00" 形式(JST)にする。 */
export function formatJstTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS);
  return `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}
