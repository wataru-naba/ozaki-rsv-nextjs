// @vitest-environment jsdom
import { StrictMode } from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { CreateReservationResponse } from "@/lib/reservation/publicTypes";

/**
 * US-003 完了画面(CompleteView)のテスト。
 *
 * 重要な回帰テスト(既知バグ): React Strict Mode(開発時)はマウント直後に effect を
 * 2回実行する。「結果を読み取って即クリア」を素朴に書くと、2回目の実行時には結果が消えており
 * 誤って /reserve へリダイレクトされる。CompleteView は useRef で初回実行のみに制限してこれを防ぐ。
 * 本テストは StrictMode でラップし、二重 effect 実行下でも結果が1回だけ読まれ表示されることを担保する。
 */

const replaceMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

// next/link はテストでは単純なアンカーに置き換える(ルーターコンテキスト不要化)。
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import CompleteView from "@/app/reserve/complete/CompleteView";

const RESULT_KEY = "ozaki-reserve:result";

const sampleResult: CreateReservationResponse = {
  reservationId: 123,
  place: "NOBEOKA",
  typeId: 2,
  durationMinutes: 30,
  startAt: "2030-06-03T01:00:00.000Z", // JST 10:00
  endAt: "2030-06-03T01:30:00.000Z",
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("CompleteView", () => {
  it("sessionStorage の結果を読み取り、予約内容を表示する(通常マウント)", async () => {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(sampleResult));

    render(<CompleteView />);

    await waitFor(() => {
      expect(screen.getByText("ご予約が完了しました")).toBeInTheDocument();
    });
    expect(screen.getByText("No. 123")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    // 読み取り後にクリアされ、リロードでの二重表示・個人情報残留を防ぐ。
    expect(window.sessionStorage.getItem(RESULT_KEY)).toBeNull();
  });

  it("React Strict Mode の二重 effect 実行下でも結果を1回だけ読み取り表示する(回帰テスト)", async () => {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(sampleResult));

    render(
      <StrictMode>
        <CompleteView />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("ご予約が完了しました")).toBeInTheDocument();
    });
    expect(screen.getByText("No. 123")).toBeInTheDocument();
    // 二重実行でも誤リダイレクトが起きないこと(既知バグの回帰防止)。
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("結果が無い(直接アクセス)場合は /reserve へリダイレクトする", async () => {
    render(<CompleteView />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/reserve");
    });
    expect(screen.queryByText("ご予約が完了しました")).not.toBeInTheDocument();
  });
});
