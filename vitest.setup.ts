/**
 * Vitest 共通セットアップ。
 *
 * - @testing-library/jest-dom/vitest … `toBeDisabled` / `toBeEnabled` 等の DOM 向け
 *   マッチャを expect に登録する(US-001 で導入したコンポーネントテスト用)。
 *   マッチャ登録自体は環境非依存で、node 環境のテストにも無害。
 * - 各 US でテスト共通のモックやマッチャ拡張が必要になった場合はここに追加する。
 */
import "@testing-library/jest-dom/vitest";
