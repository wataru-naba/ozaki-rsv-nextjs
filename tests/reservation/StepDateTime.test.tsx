// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepDateTime from "@/app/reserve/steps/StepDateTime";
import {
  weekdayOfDateStr,
  addDaysToDateStr,
  minutesToTimeStr,
} from "@/lib/reservation/time";
import type { AvailabilityResponse, SlotStatus } from "@/lib/reservation/publicTypes";

/**
 * US-002 日時選択(StepDateTime)コンポーネントテスト。
 *
 * 受け入れ条件:
 * - タイムテーブルのセル選択 → onNext が {date, time} で正しく呼ばれる(契約担保)。
 * - 7日単位・3ページのページング境界(先頭で「前の週」無効、最終で「次の週」無効、中間の日付範囲)。
 * - 「戻る」で onBack が呼ばれる。
 *
 * fetch(/api/public/availability) をモックし、決定的なレスポンスで検証する。
 */

const BASE = "2026-08-03";
const TIMES = [9 * 60, 9 * 60 + 30, 10 * 60]; // 09:00 / 09:30 / 10:00

/** 21日ぶんの決定的な空き状況レスポンスを組み立てる。 */
function buildResponse(): AvailabilityResponse {
  const days = Array.from({ length: 21 }, (_, i) => {
    const date = addDaysToDateStr(BASE, i);
    return {
      date,
      weekday: weekdayOfDateStr(date),
      isPublicHoliday: false,
      slots: TIMES.map((m, j) => ({
        time: minutesToTimeStr(m),
        // 初日の 09:00 は必ず AVAILABLE。それ以外は交互に AVAILABLE/UNAVAILABLE。
        status: (i === 0 && j === 0
          ? "AVAILABLE"
          : (i + j) % 2 === 0
            ? "AVAILABLE"
            : "UNAVAILABLE") as SlotStatus,
      })),
    };
  });
  return { place: "HYUGA", typeId: 2, durationMinutes: 30, generatedAt: "2026-07-21T00:00:00.000Z", days };
}

function mockFetchOk(res: AvailabilityResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(res) } as Response)),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockFetchOk(buildResponse());
});

async function renderLoaded(props: Partial<React.ComponentProps<typeof StepDateTime>> = {}) {
  const onNext = vi.fn();
  const onBack = vi.fn();
  render(
    <StepDateTime place="HYUGA" typeId={2} onNext={onNext} onBack={onBack} {...props} />,
  );
  // 読み込み完了(テーブル描画)を待つ。
  await screen.findByRole("table");
  return { onNext, onBack };
}

describe("StepDateTime: セル選択と onNext 契約", () => {
  it("空き枠を選び「進む」を押すと onNext が {date, time} で呼ばれる", async () => {
    const user = userEvent.setup();
    const { onNext } = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "8/3 09:00 予約可能" }));
    await user.click(screen.getByRole("button", { name: "お客様情報の入力へ進む" }));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith({ date: "2026-08-03", time: "09:00" });
  });

  it("未選択では「進む」が無効", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: "お客様情報の入力へ進む" })).toBeDisabled();
  });

  it("予約不可(×)のセルは選択できず onNext は呼ばれない", async () => {
    const user = userEvent.setup();
    const { onNext } = await renderLoaded();
    // 初日 09:30 は UNAVAILABLE(i=0,j=1)。
    const cell = screen.getByRole("button", { name: "8/3 09:30 予約不可" });
    expect(cell).toBeDisabled();
    await user.click(cell);
    expect(screen.getByRole("button", { name: "お客様情報の入力へ進む" })).toBeDisabled();
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe("StepDateTime: 7日単位・3ページのページング境界", () => {
  it("先頭ページでは「前の週」が無効・「次の週」が有効", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: /前の週/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /次の週/ })).toBeEnabled();
  });

  it("最終ページ(3ページ目)では「次の週」が無効", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /次の週/ }));
    await user.click(screen.getByRole("button", { name: /次の週/ }));
    expect(screen.getByRole("button", { name: /次の週/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /前の週/ })).toBeEnabled();
  });

  it("中間ページ(2ページ目)の日付範囲が 8/10 〜 8/16 になる", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /次の週/ }));
    expect(screen.getByText("8/10 〜 8/16")).toBeInTheDocument();
    // 中間ページには初日(8/3)の列見出しは無い。
    const table = screen.getByRole("table");
    expect(within(table).queryByText(/8\/3(?!\d)/)).not.toBeInTheDocument();
  });
});

describe("StepDateTime: 戻る", () => {
  it("「戻る」で onBack が呼ばれる", async () => {
    const user = userEvent.setup();
    const { onBack } = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
