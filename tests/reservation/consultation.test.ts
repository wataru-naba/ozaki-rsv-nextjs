import { describe, it, expect } from "vitest";
import { typeDurationMinutes, TYPE_OPTIONS } from "@/lib/reservation/publicTypes";
import { applyConsultationSelection } from "@/app/reserve/draft";

/**
 * US-001 の相談内容選択に関するロジック(純粋関数)のテスト。
 *
 * - typeId(0/1/2) → 所要時間(90/60/30分)マッピング(受け入れ条件: 所要時間の自動決定)
 * - 拠点/来店経験の変更時に既選択の日時(date/time)が破棄される(受け入れ条件: 条件変更で日時を取り直す)
 */
describe("typeDurationMinutes: 来店経験(typeId) → 所要時間(分)", () => {
  it("typeId 0(はじめて) は 90 分", () => {
    expect(typeDurationMinutes(0)).toBe(90);
  });

  it("typeId 1(今月はじめて) は 60 分", () => {
    expect(typeDurationMinutes(1)).toBe(60);
  });

  it("typeId 2(今月来店済み) は 30 分", () => {
    expect(typeDurationMinutes(2)).toBe(30);
  });

  it("TYPE_OPTIONS は 0/1/2 の3件で構成される", () => {
    expect(TYPE_OPTIONS.map((t) => t.typeId)).toEqual([0, 1, 2]);
  });
});

describe("applyConsultationSelection: 条件変更時の日時破棄", () => {
  it("拠点を変更すると既存の date/time が破棄される", () => {
    const draft = {
      place: "HYUGA" as const,
      typeId: 0 as const,
      date: "2026-07-20",
      time: "10:00",
    };
    const next = applyConsultationSelection(draft, { place: "NOBEOKA", typeId: 0 });
    expect(next.place).toBe("NOBEOKA");
    expect(next.typeId).toBe(0);
    expect(next.date).toBeUndefined();
    expect(next.time).toBeUndefined();
  });

  it("来店経験(typeId)を変更すると既存の date/time が破棄される", () => {
    const draft = {
      place: "HYUGA" as const,
      typeId: 0 as const,
      date: "2026-07-20",
      time: "10:00",
    };
    const next = applyConsultationSelection(draft, { place: "HYUGA", typeId: 2 });
    expect(next.typeId).toBe(2);
    expect(next.date).toBeUndefined();
    expect(next.time).toBeUndefined();
  });

  it("拠点・来店経験が同じなら既存の date/time は保持される", () => {
    const draft = {
      place: "HYUGA" as const,
      typeId: 1 as const,
      date: "2026-07-20",
      time: "10:00",
    };
    const next = applyConsultationSelection(draft, { place: "HYUGA", typeId: 1 });
    expect(next.date).toBe("2026-07-20");
    expect(next.time).toBe("10:00");
  });

  it("初回選択(空の下書き)でも選択値が反映される", () => {
    const next = applyConsultationSelection({}, { place: "NOBEOKA", typeId: 1 });
    expect(next).toEqual({ place: "NOBEOKA", typeId: 1 });
  });

  it("入力の下書きを破壊的に変更しない(純粋関数)", () => {
    const draft = {
      place: "HYUGA" as const,
      typeId: 0 as const,
      date: "2026-07-20",
      time: "10:00",
    };
    applyConsultationSelection(draft, { place: "NOBEOKA", typeId: 0 });
    expect(draft.date).toBe("2026-07-20");
    expect(draft.place).toBe("HYUGA");
  });
});
