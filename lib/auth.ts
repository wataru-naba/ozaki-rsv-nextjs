import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth/authorize";

/**
 * Auth.js (NextAuth v5) の完全な設定エクスポート。
 *
 * Credentials Provider の authorize は AdminUser を username で検索し、passwordHash を
 * bcrypt で比較する(api-design.md 6.1節)。検証ロジックは単体テスト可能にするため
 * lib/auth/authorize.ts に分離している。authorize は Node ランタイムで実行される
 * (Prisma / bcryptjs は Edge では動かないため middleware では使わない)。
 *
 * - handlers: app/api/auth/[...nextauth]/route.ts でエクスポートする GET/POST
 * - auth:     Server Component / Server Action / Route Handler でのセッション取得
 * - signIn / signOut: 認証操作
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "ユーザー名", type: "text" },
        password: { label: "パスワード", type: "password" },
      },
      authorize: (rawCredentials) => authorizeCredentials(rawCredentials),
    }),
  ],
});
