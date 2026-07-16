import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * US-005 受入条件(認可): requireAdminSession のセッションガード。
 *
 * `auth()` をモックし、
 * - 未認証(session なし / user.id なし) → UnauthorizedError を throw
 * - 認証済み → ユーザー情報(id/username/role)を返す
 */

const auth = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => auth(...args),
}));

import { requireAdminSession, UnauthorizedError } from "@/lib/auth/session";

beforeEach(() => {
  auth.mockReset();
});

describe("requireAdminSession", () => {
  it("認証済みセッションならユーザー情報を返す", async () => {
    auth.mockResolvedValue({
      user: { id: "user_1", username: "staff", role: "ADMIN" },
    });

    const user = await requireAdminSession();

    expect(user).toEqual({ id: "user_1", username: "staff", role: "ADMIN" });
  });

  it("セッションが null(未認証)なら UnauthorizedError を throw する", async () => {
    auth.mockResolvedValue(null);

    await expect(requireAdminSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("user.id が欠落しているなら UnauthorizedError を throw する", async () => {
    auth.mockResolvedValue({ user: { username: "staff" } });

    await expect(requireAdminSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
