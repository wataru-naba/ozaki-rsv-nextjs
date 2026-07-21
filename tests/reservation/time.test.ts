import { describe, it, expect } from "vitest";
import {
  jstDateStrToInstant,
  jstPartsOfInstant,
  weekdayOfDateStr,
  addDaysToDateStr,
  timeColToMinutes,
  timeStrToMinutes,
  minutesToTimeStr,
  overlaps,
  dateColToStr,
  dateStrToDateCol,
} from "@/lib/reservation/time";

/**
 * US-002 JST↔UTC 変換ユーティリティ(time.ts)のテスト。
 * 空き状況の範囲取得・枠キー一致の土台であり、ここがずれると端の枠を取りこぼす。
 */

describe("jstDateStrToInstant: JST壁時計 → 絶対時刻(UTC)", () => {
  it("JST 09:00 は UTC 00:00(-9h)になる", () => {
    expect(jstDateStrToInstant("2026-08-03", 9 * 60).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("JST 00:00 は前日 UTC 15:00 になる(日跨ぎの繰り下がり)", () => {
    expect(jstDateStrToInstant("2026-08-03", 0).toISOString()).toBe("2026-08-02T15:00:00.000Z");
  });

  it("JST 18:30 は UTC 09:30 になる", () => {
    expect(jstDateStrToInstant("2026-08-03", 18 * 60 + 30).toISOString()).toBe(
      "2026-08-03T09:30:00.000Z",
    );
  });
});

describe("jstPartsOfInstant: 絶対時刻 → JST の年月日/曜日", () => {
  it("UTC 15:00 は JST では翌日 00:00", () => {
    const p = jstPartsOfInstant(new Date("2026-08-02T15:00:00.000Z"));
    expect(p.dateStr).toBe("2026-08-03");
    expect(p.year).toBe(2026);
    expect(p.month0).toBe(7);
    expect(p.day).toBe(3);
  });

  it("jstDateStrToInstant と往復整合する", () => {
    const instant = jstDateStrToInstant("2026-12-31", 23 * 60 + 30);
    expect(jstPartsOfInstant(instant).dateStr).toBe("2026-12-31");
  });
});

describe("weekdayOfDateStr / addDaysToDateStr", () => {
  it("曜日を 0(日)〜6(土) で返す", () => {
    // 2026-08-02 は日曜 / 2026-08-03 は月曜
    expect(weekdayOfDateStr("2026-08-02")).toBe(0);
    expect(weekdayOfDateStr("2026-08-03")).toBe(1);
  });

  it("月をまたぐ加算が正しい", () => {
    expect(addDaysToDateStr("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("21日先までの加算が正しい(範囲の端)", () => {
    expect(addDaysToDateStr("2026-08-03", 20)).toBe("2026-08-23");
    expect(addDaysToDateStr("2026-08-03", 21)).toBe("2026-08-24");
  });
});

describe("@db.Date / @db.Time カラム変換", () => {
  it("dateStrToDateCol と dateColToStr が往復する", () => {
    expect(dateColToStr(dateStrToDateCol("2026-08-03"))).toBe("2026-08-03");
  });

  it("timeColToMinutes は null を透過する", () => {
    expect(timeColToMinutes(null)).toBeNull();
    expect(timeColToMinutes(new Date(Date.UTC(1970, 0, 1, 9, 30)))).toBe(9 * 60 + 30);
  });
});

describe("時刻文字列 <-> 分, 区間重なり", () => {
  it("timeStrToMinutes / minutesToTimeStr が往復する", () => {
    expect(timeStrToMinutes("09:30")).toBe(570);
    expect(minutesToTimeStr(570)).toBe("09:30");
    expect(minutesToTimeStr(0)).toBe("00:00");
  });

  it("overlaps は半開区間 [start,end) で判定する(隣接は非重複)", () => {
    expect(overlaps(600, 630, 615, 700)).toBe(true);
    expect(overlaps(600, 630, 630, 700)).toBe(false); // 隣接
    expect(overlaps(600, 630, 570, 600)).toBe(false); // 隣接
  });
});
