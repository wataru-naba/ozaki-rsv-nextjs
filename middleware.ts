import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * 管理画面(/admin/**)のみを保護するミドルウェア(api-design.md 6.2節)。
 *
 * - 未認証で /admin/**(/admin/login を除く)にアクセスした場合は /admin/login へリダイレクト。
 * - 認証済みで /admin/login にアクセスした場合は /admin(管理トップ)へリダイレクト。
 * - 公開ページ(/、利用者向け予約フロー、/api/public/**、/api/auth/**)は matcher により対象外。
 *
 * Edge ランタイムで動くため、Prisma / bcrypt を含まない authConfig のみを使う。
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = Boolean(req.auth);
  const isLoginPage = nextUrl.pathname === "/admin/login";

  // 未認証で保護ページ(ログイン画面以外の /admin/**)へアクセス → ログインへ
  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/admin/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return Response.redirect(loginUrl);
  }

  // 認証済みでログイン画面へアクセス → 管理トップへ
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/admin", nextUrl.origin));
  }

  return undefined;
});

export const config = {
  // /admin 配下のみをミドルウェアの対象にする(/admin/login も含むが上のロジックで除外制御)。
  matcher: ["/admin/:path*"],
};
