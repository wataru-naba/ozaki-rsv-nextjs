// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * US-006 認証ガード(統合的な確認):
 * 管理ダッシュボード(dashboard)ルートグループの共通レイアウトは、
 * middleware のページ保護に加えて requireAdminSession で二重に検証する。
 * - 認証済み: 子要素とヘッダー(ログアウト導線)を描画する。
 * - 未認証: requireAdminSession が UnauthorizedError を throw し、描画へ進まない。
 *
 * `@/lib/auth/session` は next-auth 依存(`@/lib/auth`)を引き込むため、
 * 実体は読み込まず完全にモックする(認可の実体は session.test.ts で検証済み)。
 */

const requireAdminSession = vi.fn();
vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {
    constructor(message = "認証が必要です。") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }
  return {
    requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
    UnauthorizedError,
  };
});

// ヘッダーはログアウト用 Server Action を import する。ここでは描画のみ確認するためモック。
vi.mock("@/app/admin/_actions/auth", () => ({
  logoutAction: vi.fn(),
}));

import { UnauthorizedError } from "@/lib/auth/session";
import DashboardLayout from "@/app/admin/(dashboard)/layout";

beforeEach(() => {
  // NOTE: `mockReset()` は自身(mock関数)を返すため、アロー関数の式本体で
  // 暗黙 return すると Vitest が beforeEach の戻り値をteardownコールバックとして
  // 扱ってしまう(呼び出し済みの mockImplementation が意図せず再実行される)。
  // ブロック本体にして戻り値を渡さないようにする。
  requireAdminSession.mockReset();
});
afterEach(() => cleanup());

describe("DashboardLayout: 認証ガード", () => {
  it("認証済みなら子要素とログアウト導線を描画する", async () => {
    requireAdminSession.mockResolvedValue({ id: "u1", username: "staff" });

    const ui = await DashboardLayout({ children: <p>protected content</p> });
    render(ui);

    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.getByText("staff")).toBeInTheDocument();
  });

  it("未認証なら UnauthorizedError を throw し、レイアウトを構築しない", async () => {
    requireAdminSession.mockImplementation(() => {
      throw new UnauthorizedError();
    });

    let caught: unknown = null;
    try {
      await DashboardLayout({ children: <p>protected content</p> });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
  });

  it("未認証時は AdminHeader を含む JSX を描画せず即座に拒否する(requireAdminSession のみ呼ばれる)", async () => {
    requireAdminSession.mockImplementation(() => {
      throw new UnauthorizedError();
    });

    try {
      await DashboardLayout({ children: <p>protected content</p> });
    } catch {
      // 期待どおりの拒否。
    }
    expect(requireAdminSession).toHaveBeenCalledTimes(1);
  });
});
