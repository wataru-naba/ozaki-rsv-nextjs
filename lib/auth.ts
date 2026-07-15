import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";

/**
 * Auth.js (NextAuth v5) の完全な設定エクスポート。
 *
 * Credentials Provider は AdminUser を username で検索し、passwordHash を
 * bcrypt で比較する(api-design.md 6.1節)。この authorize は Node ランタイムで
 * 実行される(Prisma / bcryptjs は Edge では動かないため middleware では使わない)。
 *
 * - handlers: app/api/auth/[...nextauth]/route.ts でエクスポートする GET/POST
 * - auth:     Server Component / Server Action / Route Handler でのセッション取得
 * - signIn / signOut: 認証操作
 */
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "ユーザー名", type: "text" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        const user = await prisma.adminUser.findUnique({
          where: { username },
        });
        if (!user) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        // JWT に載せる最小限の情報のみ返す(passwordHash は返さない)
        return {
          id: user.id,
          username: user.username,
          email: user.email ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
});
