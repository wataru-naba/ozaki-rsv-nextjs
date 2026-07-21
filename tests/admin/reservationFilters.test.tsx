// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * US-006 受け入れ条件(日付検索・前後日移動・拠点切り替え):
 * 「前日/翌日ボタンまたは日付検索を使うと URL クエリに反映され、対応日の予約が再取得される」
 * 「拠点を切り替えると表示が切り替わる」
 *
 * ReservationFilters は状態を URL クエリ(?place=&date=)へ反映し、
 * Server Component 側が再取得する設計。ここでは router.push へ渡る
 * クエリ文字列が正しいことを検証する。
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { ReservationFilters } from "@/app/admin/(dashboard)/reservations/ReservationFilters";

const places = [
  { code: "HYUGA", name: "日向" },
  { code: "NOBEOKA", name: "延岡" },
];

function renderFilters() {
  return render(
    <ReservationFilters
      places={places}
      placeCode="HYUGA"
      date="2026-07-15"
      prevDate="2026-07-14"
      nextDate="2026-07-16"
      todayDate="2026-07-21"
    />,
  );
}

/** push へ渡された URL のクエリを URLSearchParams として取り出す。 */
function lastPushQuery(): URLSearchParams {
  const url = String(push.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.split("?")[1] ?? "");
}

beforeEach(() => {
  // NOTE: mockReset() は自身を返すため、式本体で暗黙 return すると Vitest が
  // beforeEach の戻り値を teardown コールバックとして扱ってしまう。ブロック本体にする。
  push.mockReset();
});
afterEach(() => cleanup());

describe("ReservationFilters: 前日/翌日/今日移動", () => {
  it("『前日』押下で date=前日、place は据え置きでプッシュされる", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole("button", { name: /前日/ }));

    const q = lastPushQuery();
    expect(q.get("place")).toBe("HYUGA");
    expect(q.get("date")).toBe("2026-07-14");
  });

  it("『翌日』押下で date=翌日へプッシュされる", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole("button", { name: /翌日/ }));

    expect(lastPushQuery().get("date")).toBe("2026-07-16");
  });

  it("『今日』押下で date=当日へプッシュされる", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole("button", { name: "今日" }));

    expect(lastPushQuery().get("date")).toBe("2026-07-21");
  });
});

describe("ReservationFilters: 日付検索", () => {
  it("日付入力を変更すると指定日でプッシュされる", () => {
    renderFilters();
    const input = screen.getByDisplayValue("2026-07-15");
    // type="date" は 1 文字ずつの入力では確定値を得にくいため、確定値を直接 change する。
    fireEvent.change(input, { target: { value: "2026-08-01" } });

    const q = lastPushQuery();
    expect(q.get("date")).toBe("2026-08-01");
    expect(q.get("place")).toBe("HYUGA");
  });
});

describe("ReservationFilters: 拠点切り替え", () => {
  it("別拠点ボタン押下で place を切り替え、date は据え置きでプッシュされる", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole("button", { name: "延岡" }));

    const q = lastPushQuery();
    expect(q.get("place")).toBe("NOBEOKA");
    expect(q.get("date")).toBe("2026-07-15");
  });

  it("選択中拠点ボタンには選択状態のスタイル(bg-zinc-900)が付く", () => {
    renderFilters();
    const active = screen.getByRole("button", { name: "日向" });
    expect(active.className).toContain("bg-zinc-900");
  });
});
