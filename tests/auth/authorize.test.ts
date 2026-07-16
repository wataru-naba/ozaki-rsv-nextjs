import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * US-005 受入条件(認証): Credentials Provider の資格情報検証。
 *
 * DB(Prisma)と bcrypt をモックし、DB 接続なしで authorize ロジックを検証する。
 * - 正しい username/password → ユーザー情報(passwordHash は含まない)を返す
 * - 誤った password(bcrypt 照合失敗) → null
 * - 存在しない username → null
 * - 入力が空/不正 → null(Zod バリデーション)
 */

const findUnique = vi.fn();
const compare = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminUser: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: (...args: unknown[]) => compare(...args),
  },
}));

import { authorizeCredentials } from "@/lib/auth/authorize";

const dbUser = {
  id: "user_1",
  username: "staff",
  email: "staff@example.com",
  passwordHash: "$2a$10$hashedvalue",
  role: "ADMIN" as const,
};

beforeEach(() => {
  findUnique.mockReset();
  compare.mockReset();
});

describe("authorizeCredentials", () => {
  it("正しい username/password ならユーザー情報を返す(passwordHash は含まない)", async () => {
    findUnique.mockResolvedValue(dbUser);
    compare.mockResolvedValue(true);

    const result = await authorizeCredentials({ username: "staff", password: "correct-pw" });

    expect(findUnique).toHaveBeenCalledWith({ where: { username: "staff" } });
    expect(compare).toHaveBeenCalledWith("correct-pw", dbUser.passwordHash);
    expect(result).toEqual({
      id: "user_1",
      username: "staff",
      email: "staff@example.com",
      role: "ADMIN",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("パスワードが誤っている(bcrypt 照合失敗)なら null を返す", async () => {
    findUnique.mockResolvedValue(dbUser);
    compare.mockResolvedValue(false);

    const result = await authorizeCredentials({ username: "staff", password: "wrong-pw" });

    expect(result).toBeNull();
  });

  it("存在しない username なら null を返す(bcrypt 照合は行わない)", async () => {
    findUnique.mockResolvedValue(null);

    const result = await authorizeCredentials({ username: "ghost", password: "any" });

    expect(result).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });

  it("username/password が空なら DB 参照せず null を返す", async () => {
    const result = await authorizeCredentials({ username: "", password: "" });

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("email が null のユーザーは email を undefined として返す", async () => {
    findUnique.mockResolvedValue({ ...dbUser, email: null });
    compare.mockResolvedValue(true);

    const result = await authorizeCredentials({ username: "staff", password: "correct-pw" });

    expect(result?.email).toBeUndefined();
  });
});
