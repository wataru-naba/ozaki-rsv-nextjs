"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";

export type LoginState = { error?: string };

/**
 * ログイン用 Server Action(Credentials Provider)。
 *
 * signIn は成功時 redirectTo へリダイレクトするため NEXT_REDIRECT を throw する。
 * これは正常系なので握りつぶさず再 throw し、AuthError(認証失敗)のみ画面へ返す。
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrlRaw = String(formData.get("callbackUrl") ?? "");
  // オープンリダイレクト防止: /admin 配下の相対パスのみ許可する。
  // 既定のリダイレクト先は予約一覧(US-006 でダッシュボードを実装したため /admin/reservations)。
  const redirectTo =
    callbackUrlRaw.startsWith("/admin") && !callbackUrlRaw.startsWith("/admin/login")
      ? callbackUrlRaw
      : "/admin/reservations";

  if (!username || !password) {
    return { error: "ユーザー名とパスワードを入力してください。" };
  }

  try {
    await signIn("credentials", { username, password, redirectTo });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "ユーザー名またはパスワードが正しくありません。" };
    }
    // NEXT_REDIRECT を含むその他はそのまま伝播させる。
    throw e;
  }
}

/** ログアウト。/admin/login へ戻す。 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/admin/login" });
}
