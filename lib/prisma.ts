import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient のシングルトン。
 *
 * Next.js の開発モードでは HMR(ホットリロード)のたびにモジュールが再評価され、
 * その都度 new PrismaClient() すると接続が枯渇する。globalThis にキャッシュして
 * 再利用することでこれを防ぐ(本番では毎回新規インスタンスで問題ない)。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
