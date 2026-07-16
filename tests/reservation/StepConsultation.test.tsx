// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepConsultation from "@/app/reserve/steps/StepConsultation";

/**
 * US-001 StepConsultation(拠点 + 来店経験の選択)のふるまいテスト。
 *
 * 受け入れ条件:
 * - 未選択の状態では「次へ」が無効(先へ進めない)。
 * - 拠点と来店経験の両方を選ぶと「次へ」が有効化される。
 * - 「次へ」押下で onNext が正しい payload({place, typeId})で呼ばれる。
 */
afterEach(() => cleanup());

function getNextButton() {
  return screen.getByRole("button", { name: "日時の選択へ進む" });
}

describe("StepConsultation", () => {
  it("未選択では「次へ」ボタンが無効", () => {
    render(<StepConsultation onNext={vi.fn()} />);
    expect(getNextButton()).toBeDisabled();
  });

  it("拠点のみ選択では「次へ」ボタンは無効のまま", async () => {
    const user = userEvent.setup();
    render(<StepConsultation onNext={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /日向店/ }));
    expect(getNextButton()).toBeDisabled();
  });

  it("来店経験のみ選択では「次へ」ボタンは無効のまま", async () => {
    const user = userEvent.setup();
    render(<StepConsultation onNext={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /今月に来店した事がある/ }));
    expect(getNextButton()).toBeDisabled();
  });

  it("拠点と来店経験の両方を選ぶと「次へ」ボタンが有効化される", async () => {
    const user = userEvent.setup();
    render(<StepConsultation onNext={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /延岡店/ }));
    await user.click(screen.getByRole("button", { name: /今月ははじめて来店する/ }));
    expect(getNextButton()).toBeEnabled();
  });

  it("「次へ」押下で onNext が正しい payload({place, typeId})で呼ばれる", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<StepConsultation onNext={onNext} />);
    await user.click(screen.getByRole("button", { name: /延岡店/ }));
    await user.click(screen.getByRole("button", { name: /一度も来店したことがない/ }));
    await user.click(getNextButton());
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith({ place: "NOBEOKA", typeId: 0 });
  });

  it("初期値(place/typeId)が渡されると選択済みとして「次へ」が有効", () => {
    render(<StepConsultation place="HYUGA" typeId={1} onNext={vi.fn()} />);
    expect(getNextButton()).toBeEnabled();
  });
});
