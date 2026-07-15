import type { NextAuthConfig } from "next-auth";

/**
 * Edge ランタイム(middleware.ts)でも安全に読み込める NextAuth 基本設定。
 *
 * ここには Prisma / bcryptjs など Node ランタイム専用の依存を含めない。
 * Credentials Provider の authorize()(DB参照 + bcrypt比較)は Node ランタイムで
 * 動く lib/auth.ts 側でこの設定に注入する(api-design.md 6章の分割方針)。
 */
export const authConfig = {
  // JWTセッション運用(DBアダプタ用テーブルは設けない: db-schema.md 3-2節)
  session: { strategy: "jwt" },
  // ログイン画面(未認証で /admin/** にアクセスした場合の遷移先)
  pages: {
    signIn: "/admin/login",
  },
  // 開発環境で AUTH_URL 未設定でもホストを信頼する
  trustHost: true,
  // Provider は lib/auth.ts で注入する(Edge安全性のためここでは空)
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // 初回サインイン時のみ user が渡る。role/username をトークンへ載せる。
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.username = token.username;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
