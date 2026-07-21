import type { AdminRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * NextAuth のセッション/ユーザー/JWT に、管理画面で必要な独自フィールド
 * (username, role)を型として追加する。api-design.md 6.1節の
 * 「JWTコールバックで role をトークンに埋め込み、セッションにも公開する」方針に対応。
 */
declare module "next-auth" {
  interface User {
    username?: string;
    role?: AdminRole;
  }

  interface Session {
    user: {
      id: string;
      username?: string;
      role?: AdminRole;
    } & DefaultSession["user"];
  }
}

// JWT インターフェースの本体は @auth/core/jwt で宣言されており、
// next-auth/jwt はそれを re-export しているだけなので、本体側を拡張する。
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    role?: AdminRole;
  }
}
