import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { resolveAdminRedirect } from "@/lib/auth/middleware-logic";

/**
 * 管理画面(/admin/**)のみを保護するミドルウェア(api-design.md 6.2節)。
 *
 * - 未認証で /admin/**(/admin/login を除く)にアクセスした場合は /admin/login へリダイレクト。
 * - 認証済みで /admin/login にアクセスした場合は /admin(管理トップ)へリダイレクト。
 * - 公開ページ(/、利用者向け予約フロー、/api/public/**、/api/auth/**)は matcher により対象外。
 *
 * 遷移判定は単体テスト可能な純粋関数 resolveAdminRedirect(lib/auth/middleware-logic.ts)に集約している。
 * Edge ランタイムで動くため、Prisma / bcrypt を含まない authConfig のみを使う。
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const redirect = resolveAdminRedirect({
    isLoggedIn: Boolean(req.auth),
    pathname: nextUrl.pathname,
    search: nextUrl.search,
    origin: nextUrl.origin,
  });

  return redirect ? Response.redirect(redirect) : undefined;
});

export const config = {
  // /admin 配下のみをミドルウェアの対象にする(/admin/login も含むが上のロジックで除外制御)。
  matcher: ["/admin/:path*"],
};
