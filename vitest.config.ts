import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 設定(土台 PR で導入するテストハーネス)。
 *
 * - environment: "node" … 土台段階のテストは純粋なロジック/ユーティリティが対象。
 *   React コンポーネントテスト(jsdom + Testing Library)や E2E は後続スプリントで判断する(ADR 0001 未決事項)。
 * - setupFiles … 全テスト共通の初期化フック。現状は最小。
 * - alias "@/*" … tsconfig.json の paths と一致させ、アプリコードと同じ import 解決を提供する。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
