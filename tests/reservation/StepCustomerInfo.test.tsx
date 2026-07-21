// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepCustomerInfo from "@/app/reserve/steps/StepCustomerInfo";

/**
 * US-003 StepCustomerInfo(お客様情報入力)のクライアント側バリデーションテスト。
 *
 * サーバー(CreateReservationSchema)が最終的な正だが、UX 向上のためのクライアント二重チェックとして
 * 同一ルール(カナ=ひら/カナのみ、電話=数字のみ、メール形式、プライバシー同意必須)を担保する。
 */
afterEach(() => cleanup());

describe("StepCustomerInfo", () => {
  it("全項目を正しく入力し同意すると onNext が入力値で呼ばれる", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<StepCustomerInfo defaultValues={{}} onBack={vi.fn()} onNext={onNext} />);

    await user.type(screen.getByPlaceholderText("尾崎 太郎"), "尾崎 太郎");
    await user.type(screen.getByPlaceholderText("オザキ タロウ"), "オザキタロウ");
    await user.type(screen.getByPlaceholderText("09012345678"), "09012345678");
    await user.type(screen.getByPlaceholderText("taro@example.com"), "taro@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "入力内容の確認へ進む" }));

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    // react-hook-form は onNext(data, event) の形で呼ぶため第1引数のみ検証する。
    expect(onNext.mock.calls[0][0]).toMatchObject({
      name: "尾崎 太郎",
      kana: "オザキタロウ",
      tel: "09012345678",
      email: "taro@example.com",
      privacyAgreed: true,
    });
  });

  it("不正なカナ・電話・メール、未同意では onNext を呼ばずエラーを表示する", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<StepCustomerInfo defaultValues={{}} onBack={vi.fn()} onNext={onNext} />);

    await user.type(screen.getByPlaceholderText("尾崎 太郎"), "尾崎 太郎");
    await user.type(screen.getByPlaceholderText("オザキ タロウ"), "yamada"); // カナ以外
    await user.type(screen.getByPlaceholderText("09012345678"), "090-1234-5678"); // ハイフン
    await user.type(screen.getByPlaceholderText("taro@example.com"), "not-an-email"); // 形式不正
    // プライバシー未同意
    await user.click(screen.getByRole("button", { name: "入力内容の確認へ進む" }));

    await waitFor(() =>
      expect(screen.getByText("ひらがな/カタカナのみで入力してください")).toBeInTheDocument(),
    );
    expect(screen.getByText("数字のみ(ハイフンなし)で入力してください")).toBeInTheDocument();
    expect(screen.getByText("メールアドレスの形式が正しくありません")).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });
});
