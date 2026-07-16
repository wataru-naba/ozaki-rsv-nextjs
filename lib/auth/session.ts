import { auth } from "@/lib/auth";
import type { AdminRole } from "@prisma/client";

/**
 * 管理画面の認証・認可ヘルパー(api-design.md 6.3 節)。
 *
 * middleware.ts のページ保護だけに依存せず、全ての Server Action / 参照系の
 * データ取得関数の先頭で本ヘルパーを呼び、セッションを二重に検証する。
 * 将来ロール別のガードを追加する場合の変更点をここ1箇所に集約する(5.6 節)。
 */

export type AdminSessionUser = {
  id: string;
  username?: string;
  role?: AdminRole;
};

/** 認証が確認できなかった場合に throw する例外。Server Action 側で UNAUTHORIZED に変換する。 */
export class UnauthorizedError extends Error {
  constructor(message = "認証が必要です。") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * 認証済みの AdminUser セッションを取得する。未認証なら UnauthorizedError を throw。
 *
 * MVP では ADMIN / AUTHOR を区別せず、認証済みであれば全操作を許可する(5.6 節)。
 */
export async function requireAdminSession(): Promise<AdminSessionUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}
