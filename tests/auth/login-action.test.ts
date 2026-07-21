import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * US-005 受入条件(認証): ログイン Server Action。
 *
 * - 未入力 → エラーを返し signIn を呼ばない
 * - 誤った資格情報(AuthError) → エラーメッセージを返す
 * - 正しい資格情報 → signIn を正しい引数で呼び、成功時のリダイレクト(NEXT_REDIRECT)を再 throw する
 * - callbackUrl のオープンリダイレクト防止(/admin 配下のみ許可、/admin/login は除外)
 */

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("next-auth", () => {
  class AuthError extends Error {
    type = "CredentialsSignin";
  }
  return { AuthError };
});

vi.mock("@/lib/auth", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

import { AuthError } from "next-auth";
import { loginAction, logoutAction } from "@/app/admin/_actions/auth";

function formOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

// signIn 成功時に next-auth が投げる NEXT_REDIRECT を模したエラー。
function redirectError(): Error {
  const e = new Error("NEXT_REDIRECT");
  (e as unknown as { digest: string }).digest = "NEXT_REDIRECT;replace;/admin;307;";
  return e;
}

beforeEach(() => {
  signIn.mockReset();
  signOut.mockReset();
});

describe("loginAction", () => {
  it("ユーザー名/パスワードが未入力ならエラーを返し signIn を呼ばない", async () => {
    const result = await loginAction({}, formOf({ username: "", password: "" }));

    expect(result.error).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("誤った資格情報(AuthError)なら認証失敗メッセージを返す", async () => {
    signIn.mockRejectedValue(new AuthError("invalid"));

    const result = await loginAction(
      {},
      formOf({ username: "staff", password: "wrong", callbackUrl: "/admin" }),
    );

    expect(result.error).toBe("ユーザー名またはパスワードが正しくありません。");
  });

  it("正しい資格情報なら signIn を呼び、成功時の NEXT_REDIRECT を再 throw する", async () => {
    signIn.mockRejectedValue(redirectError());

    await expect(
      loginAction(
        {},
        formOf({ username: "staff", password: "correct", callbackUrl: "/admin/reservations" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signIn).toHaveBeenCalledWith("credentials", {
      username: "staff",
      password: "correct",
      redirectTo: "/admin/reservations",
    });
  });

  it("外部 URL の callbackUrl は無視し /admin へリダイレクトする(オープンリダイレクト防止)", async () => {
    signIn.mockRejectedValue(redirectError());

    await expect(
      loginAction(
        {},
        formOf({ username: "staff", password: "correct", callbackUrl: "https://evil.example.com" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/admin" }),
    );
  });

  it("callbackUrl が /admin/login の場合はループ防止のため /admin へ", async () => {
    signIn.mockRejectedValue(redirectError());

    await expect(
      loginAction(
        {},
        formOf({ username: "staff", password: "correct", callbackUrl: "/admin/login" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/admin" }),
    );
  });
});

describe("logoutAction", () => {
  it("signOut を /admin/login への redirectTo 付きで呼ぶ", async () => {
    signOut.mockResolvedValue(undefined);

    await logoutAction();

    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/admin/login" });
  });
});
