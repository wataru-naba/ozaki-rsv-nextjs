import { describe, it, expect } from "vitest";
import { applyDateTimeSelection } from "@/app/reserve/draft";

/**
 * US-002 日時選択の下書き反映(純粋関数)テスト。
 * StepDateTime の onNext({date,time}) をウィザードが下書きへ載せ、
 * 次ステップ(US-003)へ引き継げることを担保する。
 */
describe("applyDateTimeSelection: 日時を下書きへ反映", () => {
  it("date/time を下書きへ載せ、拠点・来店経験は保持する", () => {
    const draft = { place: "HYUGA" as const, typeId: 0 as const };
    const next = applyDateTimeSelection(draft, { date: "2026-08-03", time: "09:00" });
    expect(next).toEqual({
      place: "HYUGA",
      typeId: 0,
      date: "2026-08-03",
      time: "09:00",
    });
  });

  it("既存の日時を上書きする", () => {
    const draft = {
      place: "NOBEOKA" as const,
      typeId: 2 as const,
      date: "2026-08-03",
      time: "09:00",
    };
    const next = applyDateTimeSelection(draft, { date: "2026-08-04", time: "10:30" });
    expect(next.date).toBe("2026-08-04");
    expect(next.time).toBe("10:30");
  });

  it("入力の下書きを破壊的に変更しない(純粋関数)", () => {
    const draft = { place: "HYUGA" as const, typeId: 1 as const };
    applyDateTimeSelection(draft, { date: "2026-08-03", time: "09:00" });
    expect(draft).toEqual({ place: "HYUGA", typeId: 1 });
  });
});
