/**
 * 祝日 CSV(内閣府「国民の祝日・休日」フォーマット)の純粋パーサ(ADR 0002 / api-design.md 5.5.1)。
 *
 * 入力: CSV 全文(UTF-8 文字列)。出力: 検証済み行の配列、または不正行の一覧。
 *
 * 破壊的操作(全削除→再投入)の前段として使うため「全か無か」で検証する:
 * 1 件でも不正(日付形式不正・実在しない日付・名称超過・ファイル内日付重複・上限超過・空)なら
 * ok:false を返し、呼び出し側は DB を一切変更しない。部分投入・サイレントスキップはしない。
 *
 * Prisma のカラム変換(YYYY-MM-DD → @db.Date)は呼び出し側で `dateStrToDateCol` を用いる。
 * 本モジュールは副作用を持たず(DB/日時の now 参照なし)、単体テストで網羅検証できる。
 */

/** 検証済みの 1 行(date は "YYYY-MM-DD" 0 埋め正規化済み、name は空なら null)。 */
export type ParsedHolidayRow = { date: string; name: string | null };

/** 不正行の指摘。line は 1 起点の元ファイル行番号(0 = ファイル全体に対する指摘)。 */
export type HolidayCsvIssue = { line: number; reason: string };

export type ParseHolidayCsvResult =
  | { ok: true; rows: ParsedHolidayRow[] }
  | { ok: false; issues: HolidayCsvIssue[] };

/** データ行数の既定上限(桁違いの誤ファイルを弾く。ADR 0002 §5)。 */
export const DEFAULT_MAX_ROWS = 10_000;

const DATE_RE = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
const KNOWN_HEADER_FIRST_COL = "国民の祝日・休日月日";
const NAME_MAX = 50;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * "YYYY/M/D"(0 埋めなし)を実在日として検証し、"YYYY-MM-DD"(0 埋め)へ正規化する。
 * 実在しない日付(例 2026/2/30, 2026/13/1, 2026/0/1)は null。
 */
function normalizeDate(s: string): string | null {
  const [y, m, d] = s.split("/").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 1 行を列へ分割する。名称にカンマが含まれても失われないよう 2 列目以降は再結合する。 */
function splitColumns(line: string): { date: string; name: string } {
  const parts = line.split(",");
  return { date: (parts[0] ?? "").trim(), name: parts.slice(1).join(",").trim() };
}

export function parseHolidayCsv(
  raw: string,
  options?: { maxRows?: number },
): ParseHolidayCsvResult {
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;

  // 先頭 BOM(U+FEFF)を除去し、CRLF/CR/LF いずれの改行でも分割する。
  const text = raw.replace(/^﻿/, "");
  const rawLines = text.split(/\r\n|\r|\n/);

  // 空行(空白のみ含む)は行番号を保持したまま除外する(末尾空行・行間空行を無視)。
  const nonEmpty = rawLines
    .map((content, idx) => ({ no: idx + 1, content }))
    .filter((l) => l.content.trim() !== "");

  if (nonEmpty.length === 0) {
    return {
      ok: false,
      issues: [{ line: 0, reason: "CSV が空です。祝日データを含む CSV を指定してください。" }],
    };
  }

  // ヘッダー判定: 先頭行の 1 列目が既知ヘッダー、または日付として解釈できなければヘッダーとして除く。
  const firstCol = splitColumns(nonEmpty[0].content).date;
  const hasHeader = firstCol === KNOWN_HEADER_FIRST_COL || !DATE_RE.test(firstCol);
  const dataLines = hasHeader ? nonEmpty.slice(1) : nonEmpty;

  if (dataLines.length === 0) {
    return {
      ok: false,
      issues: [{ line: 0, reason: "有効な祝日データ行がありません。" }],
    };
  }
  if (dataLines.length > maxRows) {
    return {
      ok: false,
      issues: [
        { line: 0, reason: `データ行数(${dataLines.length})が上限(${maxRows})を超えています。` },
      ],
    };
  }

  const issues: HolidayCsvIssue[] = [];
  const rows: ParsedHolidayRow[] = [];
  const seen = new Map<string, number>(); // normalizedDate -> 初出の行番号

  for (const { no, content } of dataLines) {
    const { date: rawDate, name: rawName } = splitColumns(content);

    if (!DATE_RE.test(rawDate)) {
      issues.push({
        line: no,
        reason: `日付の形式が不正です(「${rawDate}」)。YYYY/M/D 形式で指定してください。`,
      });
      continue;
    }
    const normalized = normalizeDate(rawDate);
    if (normalized === null) {
      issues.push({ line: no, reason: `実在しない日付です(「${rawDate}」)。` });
      continue;
    }
    if (rawName.length > NAME_MAX) {
      issues.push({
        line: no,
        reason: `名称が${NAME_MAX}文字を超えています(${rawName.length}文字)。`,
      });
      continue;
    }
    const firstSeen = seen.get(normalized);
    if (firstSeen !== undefined) {
      issues.push({
        line: no,
        reason: `日付「${normalized}」が${firstSeen}行目と重複しています。`,
      });
      continue;
    }
    seen.set(normalized, no);
    rows.push({ date: normalized, name: rawName === "" ? null : rawName });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, rows };
}
