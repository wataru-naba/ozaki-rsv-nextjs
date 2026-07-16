import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 設定(土台 PR で導入するテストハーネス)。
 *
 * - environment: "node" … デフォルトは純粋なロジック/ユーティリティ向け。
 *   React コンポーネントテストは各ファイル先頭の `// @vitest-environment jsdom` で
 *   個別に jsdom へ切り替える(US-001 でコンポーネントテストを導入。ADR 0001 未決事項の判断)。
 * - setupFiles … 全テスト共通の初期化フック(jest-dom マッチャ登録を含む)。
 * - alias "@/*" … tsconfig.json の paths と一致させ、アプリコードと同じ import 解決を提供する。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
