import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Credentials Provider の資格情報検証ロジック(api-design.md 6.1 節)。
 *
 * NextAuth の設定(lib/auth.ts)から分離し、DB 参照 + bcrypt 照合を単体テスト可能にする。
 * Node ランタイム専用(Prisma / bcryptjs は Edge では動かないため middleware では使わない)。
 */

export const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** JWT に載せる最小限のユーザー情報(passwordHash は含めない)。 */
export type AuthorizedAdmin = {
  id: string;
  username: string;
  email?: string;
  role: AdminRole;
};

/**
 * username で AdminUser を検索し、passwordHash を bcrypt で照合する。
 * 検証に失敗した場合(入力不正 / ユーザー不在 / パスワード不一致)は null を返す。
 */
export async function authorizeCredentials(raw: unknown): Promise<AuthorizedAdmin | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { username, password } = parsed.data;

  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user) return null;

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email ?? undefined,
    role: user.role,
  };
}
