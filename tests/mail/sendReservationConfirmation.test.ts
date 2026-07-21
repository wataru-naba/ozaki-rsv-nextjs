import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReservationMailInput } from "@/lib/mail/sendReservationConfirmation";

/**
 * US-004 予約確認メール送信サービスのテスト(api-design.md 7章 / 要件 C章)。
 *
 * 実際の SMTP サーバーに接続せず完結させるため nodemailer をモックする。
 * 検証対象:
 * - 本文に要件 C章の全項目(店舗名/予約日時/氏名/カナ/電話/メール/両店舗電話番号/キャンセル案内)が含まれる。
 * - Bcc は環境変数(MAIL_BCC)から設定され、ハードコードされていない。
 * - 送信成功時は { success: true }、失敗(SMTP接続エラー等)でも throw せず { success: false }。
 * - SMTP 未設定時は console へフォールバック出力し、SMTP なしでテストが完結する。
 */

const sendMailMock = vi.fn();
const createTransportMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args),
  },
}));

import { sendReservationConfirmation } from "@/lib/mail/sendReservationConfirmation";

const baseInput: ReservationMailInput = {
  reservationId: 42,
  place: "HYUGA",
  name: "尾崎 太郎",
  kana: "オザキタロウ",
  tel: "09012345678",
  email: "taro@example.com",
  // JST 09:00 〜 09:30(startAt/endAt は UTC 絶対時刻)
  startAt: new Date("2030-06-03T00:00:00.000Z"),
  endAt: new Date("2030-06-03T00:30:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // 既定は SMTP 設定あり + 送信成功。個別テストで上書きする。
  vi.stubEnv("MAIL_HOST", "smtp.example.test");
  vi.stubEnv("MAIL_FROM", "noreply@example.test");
  vi.stubEnv("MAIL_BCC", "ops-bcc@example.test");
  vi.stubEnv("MAIL_SUBJECT", "ご予約ありがとうございます");
  vi.stubEnv("STORE_TEL_HYUGA", "0982-11-1111");
  vi.stubEnv("STORE_TEL_NOBEOKA", "0982-22-2222");
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  sendMailMock.mockResolvedValue({ messageId: "test" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** sendMail に渡された text 本文を取り出す。 */
function sentText(): string {
  expect(sendMailMock).toHaveBeenCalledTimes(1);
  return sendMailMock.mock.calls[0][0].text as string;
}

describe("sendReservationConfirmation - 本文組立(要件C章)", () => {
  it("店舗名・予約日時・氏名・カナ・電話・メール・両店舗電話番号・キャンセル案内を含む", async () => {
    const result = await sendReservationConfirmation(baseInput);
    expect(result.success).toBe(true);

    const text = sentText();
    // 店舗名(申込拠点)
    expect(text).toContain("日向店");
    // 予約日時(JST 表示)
    expect(text).toContain("2030-06-03");
    expect(text).toContain("09:00");
    expect(text).toContain("09:30");
    // 氏名・カナ・電話・メール
    expect(text).toContain("尾崎 太郎");
    expect(text).toContain("オザキタロウ");
    expect(text).toContain("09012345678");
    expect(text).toContain("taro@example.com");
    // 両店舗電話番号(日向店・延岡店の両方を併記)
    expect(text).toContain("延岡店");
    expect(text).toContain("0982-11-1111");
    expect(text).toContain("0982-22-2222");
    // キャンセルは電話連絡の案内
    expect(text).toContain("キャンセル");
    expect(text).toContain("電話");
  });

  it("宛先(to)は申込者のメールアドレス", async () => {
    await sendReservationConfirmation(baseInput);
    expect(sendMailMock.mock.calls[0][0].to).toBe("taro@example.com");
  });
});

describe("sendReservationConfirmation - Bcc は環境変数から", () => {
  it("MAIL_BCC の値が Bcc に設定される(ハードコードでない)", async () => {
    await sendReservationConfirmation(baseInput);
    expect(sendMailMock.mock.calls[0][0].bcc).toBe("ops-bcc@example.test");
  });

  it("MAIL_BCC を変更すると Bcc も追従する(環境変数参照であることの確認)", async () => {
    vi.stubEnv("MAIL_BCC", "another-bcc@example.test");
    await sendReservationConfirmation(baseInput);
    expect(sendMailMock.mock.calls[0][0].bcc).toBe("another-bcc@example.test");
  });

  it("From/件名も環境変数から設定される", async () => {
    await sendReservationConfirmation(baseInput);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.from).toBe("noreply@example.test");
    expect(arg.subject).toBe("ご予約ありがとうございます");
  });
});

describe("sendReservationConfirmation - 失敗時の扱い(api-design 7.2)", () => {
  it("SMTP 接続エラー(sendMail が reject)でも throw せず { success: false } を返す", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendReservationConfirmation(baseInput);

    expect(result.success).toBe(false);
    // 構造化ログ(reservationId を含む個人情報最小化ログ)が出る
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("sendReservationConfirmation - SMTP 未設定フォールバック", () => {
  it("MAIL_HOST 未設定なら送信せず console へフォールバック出力し { success: false }", async () => {
    vi.stubEnv("MAIL_HOST", "");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendReservationConfirmation(baseInput);

    expect(result.success).toBe(false);
    // 実際の送信は行わない(SMTP なしで完結)
    expect(sendMailMock).not.toHaveBeenCalled();
    // フォールバックのログに本文相当が出力される
    expect(infoSpy).toHaveBeenCalled();
    const logged = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("尾崎 太郎");
  });
});
