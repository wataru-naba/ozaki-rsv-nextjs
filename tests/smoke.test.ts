import { describe, it, expect } from "vitest";

/**
 * スモークテスト(ADR 0001 決定1「テストハーネスが動くことを示すスモークテスト1本」)。
 *
 * 土台 PR は認証・認可・金額・在庫・予約重複・データ整合性のいずれにも触れないため、
 * architect.md の必須テスト対象は発生しない。ここでは Vitest ハーネスが正しく起動し、
 * TypeScript のテストが実行・アサートできることのみを確認する。
 * フィーチャーのロジックテストは各 US ブランチで追加する。
 */
describe("test harness smoke", () => {
  it("runs a pure assertion", () => {
    const sum = (a: number, b: number) => a + b;
    expect(sum(2, 3)).toBe(5);
  });

  it("supports async assertions", async () => {
    const value = await Promise.resolve("ok");
    expect(value).toBe("ok");
  });
});
