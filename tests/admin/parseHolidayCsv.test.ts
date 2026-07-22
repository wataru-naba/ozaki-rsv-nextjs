import { describe, it, expect } from "vitest";
import { parseHolidayCsv } from "@/lib/admin/parseHolidayCsv";

/**
 * US-010 追加 / ADR 0002: 祝日 CSV パーサ(純粋関数)の単体テスト。
 *
 * 内閣府「国民の祝日・休日」フォーマット:
 *   ヘッダー行 `国民の祝日・休日月日,国民の祝日・休日名称`
 *   データ行   `YYYY/M/D,名称`(0 埋めなし、UTF-8、CRLF)
 *
 * 検証観点(破壊前の全検証=全か無か):
 * - 正常系、ヘッダースキップ、BOM 除去、CRLF/LF 両対応、YYYY/M/D → YYYY-MM-DD 正規化。
 * - 不正日付・実在しない日付・名称超過・ファイル内重複・空ファイルは ok:false。
 * - 1 件でも不正なら rows を返さず issues にまとめて返す(部分成功しない)。
 */

const HEADER = "国民の祝日・休日月日,国民の祝日・休日名称";

describe("parseHolidayCsv: 正常系", () => {
  it("ヘッダー + データ行(LF)を正しくパースする", () => {
    const csv = [HEADER, "1955/1/1,元日", "1955/1/15,成人の日"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toEqual([
        { date: "1955-01-01", name: "元日" },
        { date: "1955-01-15", name: "成人の日" },
      ]);
    }
  });

  it("CRLF 改行でもパースできる", () => {
    const csv = [HEADER, "2026/1/1,元日", "2026/2/11,建国記念の日"].join("\r\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.date)).toEqual(["2026-01-01", "2026-02-11"]);
  });

  it("先頭 BOM を除去してヘッダーを認識する", () => {
    const csv = "﻿" + [HEADER, "2026/5/3,憲法記念日"].join("\r\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([{ date: "2026-05-03", name: "憲法記念日" }]);
  });

  it("YYYY/M/D(0 埋めなし)を YYYY-MM-DD(0 埋め)へ正規化する", () => {
    const csv = [HEADER, "2026/3/5,テスト", "2026/12/23,テスト2"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.date)).toEqual(["2026-03-05", "2026-12-23"]);
  });

  it("末尾・行間の空行は無視する", () => {
    const csv = [HEADER, "2026/1/1,元日", "", "2026/2/11,建国記念の日", "", ""].join("\r\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it("名称が空の行は name=null になる", () => {
    const csv = [HEADER, "2026/1/1,"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0]).toEqual({ date: "2026-01-01", name: null });
  });

  it("ヘッダーが無く先頭行が日付ならデータ行として扱う", () => {
    const csv = ["2026/1/1,元日", "2026/2/11,建国記念の日"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it("名称 50 文字ちょうどは許可(上限境界)", () => {
    const csv = [HEADER, `2026/1/1,${"あ".repeat(50)}`].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(true);
  });
});

describe("parseHolidayCsv: 異常系(全か無か)", () => {
  it("日付形式が不正な行があれば全体を ok:false にする", () => {
    const csv = [HEADER, "2026/1/1,元日", "2026-02-11,建国記念の日"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // 3 行目(元ファイル行番号)を指摘する。
      expect(r.issues.some((i) => i.line === 3)).toBe(true);
    }
  });

  it("実在しない日付(2026/2/30)は ok:false", () => {
    const csv = [HEADER, "2026/2/30,不正"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toContain("実在しない");
  });

  it("月・日が範囲外(2026/13/1, 2026/1/0)は ok:false", () => {
    expect(parseHolidayCsv([HEADER, "2026/13/1,x"].join("\n")).ok).toBe(false);
    expect(parseHolidayCsv([HEADER, "2026/1/0,x"].join("\n")).ok).toBe(false);
  });

  it("名称が 50 文字超過なら ok:false", () => {
    const csv = [HEADER, `2026/1/1,${"あ".repeat(51)}`].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toContain("50文字");
  });

  it("ファイル内で日付が重複していれば ok:false(重複行を指摘)", () => {
    const csv = [HEADER, "2026/1/1,元日", "2026/1/1,元日(重複)"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0].reason).toContain("重複");
      // 重複行(3 行目)を指摘する。
      expect(r.issues[0].line).toBe(3);
    }
  });

  it("複数の不正行をまとめて報告する(先に成功行があっても rows は返さない)", () => {
    const csv = [HEADER, "2026/1/1,元日", "bad,x", "2026/2/30,y"].join("\n");
    const r = parseHolidayCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(2);
      expect(r).not.toHaveProperty("rows");
    }
  });

  it("空文字は ok:false", () => {
    expect(parseHolidayCsv("").ok).toBe(false);
  });

  it("ヘッダーのみでデータ行が無ければ ok:false", () => {
    const r = parseHolidayCsv(HEADER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].line).toBe(0);
  });

  it("空白・改行のみのファイルは ok:false", () => {
    expect(parseHolidayCsv("  \r\n \n").ok).toBe(false);
  });
});

describe("parseHolidayCsv: 行数上限", () => {
  it("データ行数が maxRows を超えたら ok:false", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `2026/1/${i + 1},d${i}`);
    const csv = [HEADER, ...rows].join("\n");
    const r = parseHolidayCsv(csv, { maxRows: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toContain("上限");
  });

  it("maxRows ちょうどは許可(境界)", () => {
    const rows = Array.from({ length: 3 }, (_, i) => `2026/1/${i + 1},d${i}`);
    const csv = [HEADER, ...rows].join("\n");
    const r = parseHolidayCsv(csv, { maxRows: 3 });
    expect(r.ok).toBe(true);
  });
});
