import { describe, it, expect } from "vitest";
import { subSlotStartsForRange } from "@/lib/reservation/slots";
import { jstDateStrToInstant } from "@/lib/reservation/time";

/**
 * US-007 データ整合性の中核となる純粋関数のテスト。
 *
 * 予約が占有する 30 分サブ枠を [startAt, endAt) から機械的に導出する。
 * この列がキャンセル時に count を -1 する対象そのものであり、予約確定時に
 * +1 した枠と対称であることが「満枠が誤って解除されない」保証の起点になる。
 */

const DATE = "2026-07-15";

describe("subSlotStartsForRange — 占有サブ枠の導出", () => {
  it("30分予約(単一枠): 開始枠1つだけを返す", () => {
    const start = jstDateStrToInstant(DATE, 10 * 60); // 10:00
    const end = jstDateStrToInstant(DATE, 10 * 60 + 30); // 10:30
    const slots = subSlotStartsForRange(start, end);

    expect(slots).toHaveLength(1);
    expect(slots[0].getTime()).toBe(start.getTime());
  });

  it("60分予約(2枠): 連続する2つの30分枠を返す", () => {
    const start = jstDateStrToInstant(DATE, 10 * 60); // 10:00
    const end = jstDateStrToInstant(DATE, 11 * 60); // 11:00
    const slots = subSlotStartsForRange(start, end);

    expect(slots.map((s) => s.getTime())).toEqual([
      jstDateStrToInstant(DATE, 10 * 60).getTime(),
      jstDateStrToInstant(DATE, 10 * 60 + 30).getTime(),
    ]);
  });

  it("90分予約(3枠): 連続する3つの30分枠を返す", () => {
    const start = jstDateStrToInstant(DATE, 10 * 60); // 10:00
    const end = jstDateStrToInstant(DATE, 11 * 60 + 30); // 11:30
    const slots = subSlotStartsForRange(start, end);

    expect(slots.map((s) => s.getTime())).toEqual([
      jstDateStrToInstant(DATE, 10 * 60).getTime(),
      jstDateStrToInstant(DATE, 10 * 60 + 30).getTime(),
      jstDateStrToInstant(DATE, 11 * 60).getTime(),
    ]);
  });

  it("終端(endAt)は半開区間として含まない", () => {
    const start = jstDateStrToInstant(DATE, 10 * 60);
    const end = jstDateStrToInstant(DATE, 11 * 60 + 30);
    const slots = subSlotStartsForRange(start, end);

    // 11:30(=endAt)は占有枠に含まれない。
    expect(slots.some((s) => s.getTime() === end.getTime())).toBe(false);
  });

  it("必ず startAt 昇順にソートされて返る(デッドロック回避の前提)", () => {
    const start = jstDateStrToInstant(DATE, 9 * 60);
    const end = jstDateStrToInstant(DATE, 11 * 60 + 30); // 5枠
    const slots = subSlotStartsForRange(start, end);

    const times = slots.map((s) => s.getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
    expect(slots).toHaveLength(5);
  });

  it("開始と終了が同一(0分)なら空配列を返す", () => {
    const start = jstDateStrToInstant(DATE, 10 * 60);
    expect(subSlotStartsForRange(start, start)).toEqual([]);
  });
});
