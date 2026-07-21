/**
 * 管理画面(/admin/**)保護のルーティング判定ロジック(api-design.md 6.2 節)。
 *
 * middleware.ts は Edge の NextAuth ラッパーで包まれ直接テストしづらいため、
 * 判定を純粋関数として分離し単体テスト可能にする。Edge 安全(Prisma / bcrypt を含まない)。
 */

export const LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin";

/**
 * ミドルウェアの保護対象(= /admin 配下)かどうか。
 * matcher(config)と同じ範囲を表し、公開ルート(/, /reserve/**, /api/public/**, /api/auth/**)は false。
 */
export function isProtectedAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME_PATH || pathname.startsWith(`${ADMIN_HOME_PATH}/`);
}

export type AdminRouteContext = {
  isLoggedIn: boolean;
  pathname: string;
  search: string;
  origin: string;
};

/**
 * 保護対象ルートに対する遷移先を決定する。
 * - 未認証 かつ ログイン画面以外の /admin/** → /admin/login(callbackUrl 付き)
 * - 認証済み かつ ログイン画面 → /admin(管理トップ)
 * - それ以外 → null(素通し)
 */
export function resolveAdminRedirect(ctx: AdminRouteContext): URL | null {
  const isLoginPage = ctx.pathname === LOGIN_PATH;

  if (!ctx.isLoggedIn && !isLoginPage) {
    const url = new URL(LOGIN_PATH, ctx.origin);
    url.searchParams.set("callbackUrl", ctx.pathname + ctx.search);
    return url;
  }

  if (ctx.isLoggedIn && isLoginPage) {
    return new URL(ADMIN_HOME_PATH, ctx.origin);
  }

  return null;
}
