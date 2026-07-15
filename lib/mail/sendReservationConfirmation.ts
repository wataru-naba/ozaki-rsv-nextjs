import nodemailer from "nodemailer";
import type { PlaceCode } from "@/lib/reservation/constants";
import { formatJstDateTime, formatJstTime } from "@/lib/reservation/time";

/**
 * 予約確認メール送信サービス(api-design.md 7章)。
 *
 * - 予約確定トランザクションの **コミット後** に呼び出す(7.1節)。
 * - 失敗しても throw せず `{ success: false }` を返し、予約確定APIのレスポンスに影響させない(7.2節)。
 * - SMTP 設定が無い/接続できない開発環境では、エラーを握りつぶさず送信内容を console.log する
 *   フォールバックを行う(ブラウザ動作確認で処理完了が分かるように)。
 * - From / Bcc / 件名は環境変数化(7.3節)。Bcc(要件 3-5)はコードにハードコードしない。
 */

/** 拠点の表示情報。両店舗の電話番号を本文に併記する(要件 C章)。 */
const STORE_INFO: Record<PlaceCode, { name: string; tel: string }> = {
  // NOTE: 電話番号は原典に実値があるが本リポジトリからは取得できないため暫定値。
  //       本番投入前に実際の店舗電話番号へ差し替えること(未対応事項として報告)。
  HYUGA: { name: "日向店", tel: process.env.STORE_TEL_HYUGA ?? "0982-XX-XXXX" },
  NOBEOKA: { name: "延岡店", tel: process.env.STORE_TEL_NOBEOKA ?? "0982-YY-YYYY" },
};

export type ReservationMailInput = {
  reservationId: number;
  place: PlaceCode;
  name: string;
  kana: string;
  tel: string;
  email: string;
  startAt: Date;
  endAt: Date;
};

export async function sendReservationConfirmation(
  input: ReservationMailInput,
): Promise<{ success: boolean }> {
  const store = STORE_INFO[input.place];
  const subject = process.env.MAIL_SUBJECT ?? "ご予約ありがとうございます";
  const from = process.env.MAIL_FROM ?? "noreply@example.com";
  const bcc = process.env.MAIL_BCC ?? undefined;

  const text = buildBody(input, store);

  try {
    const transporter = createTransport();
    if (!transporter) {
      // SMTP 未設定 → フォールバック(内容をログ出力し、処理完了扱いにする)
      logFallback("SMTP 未設定のためメール送信をスキップ(内容をログ出力)", {
        to: input.email,
        subject,
        text,
      });
      return { success: false };
    }

    await transporter.sendMail({
      from,
      to: input.email,
      bcc,
      subject,
      text,
    });
    console.info(
      `[mail] 予約確認メール送信成功 reservationId=${input.reservationId} toDomain=${emailDomain(input.email)}`,
    );
    return { success: true };
  } catch (err) {
    // 失敗しても予約自体は確定済み。個人情報を最小化して構造化ログを出し、フォールバックで内容を残す。
    console.error(
      `[mail] 予約確認メール送信失敗 reservationId=${input.reservationId} toDomain=${emailDomain(input.email)}:`,
      err instanceof Error ? err.message : err,
    );
    logFallback("メール送信失敗のためフォールバック(内容をログ出力)", {
      to: input.email,
      subject,
      text,
    });
    return { success: false };
  }
}

/** 環境変数から nodemailer トランスポートを組む。最低限 MAIL_HOST が無ければ null。 */
function createTransport(): nodemailer.Transporter | null {
  const host = process.env.MAIL_HOST;
  if (!host) return null;

  const port = Number(process.env.MAIL_PORT ?? "587");
  const secure = process.env.MAIL_SECURE === "true";
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASSWORD;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass } } : {}),
    // 開発環境の未起動 SMTP で長時間ブロックしないよう短めのタイムアウトを設定
    connectionTimeout: 5000,
    greetingTimeout: 5000,
  });
}

/** 要件 C章の記載項目を含む本文を組み立てる。 */
function buildBody(
  input: ReservationMailInput,
  store: { name: string; tel: string },
): string {
  const both = STORE_INFO;
  return [
    `${input.name} 様`,
    "",
    "この度はご予約いただきありがとうございます。",
    "以下の内容でご予約を承りました。",
    "",
    "──────────────────────",
    `店舗名  : ${store.name}`,
    `ご予約日時: ${formatJstDateTime(input.startAt)} 〜 ${formatJstTime(input.endAt)}`,
    `お名前  : ${input.name}`,
    `フリガナ : ${input.kana}`,
    `電話番号 : ${input.tel}`,
    `メール  : ${input.email}`,
    "──────────────────────",
    "",
    "【ご予約のキャンセル・変更について】",
    "キャンセルやご変更はお電話にてご連絡をお願いいたします。",
    "",
    "【お問い合わせ先】",
    `${both.HYUGA.name}: ${both.HYUGA.tel}`,
    `${both.NOBEOKA.name}: ${both.NOBEOKA.tel}`,
    "",
    "※本メールは送信専用です。ご返信いただいてもお答えできません。",
  ].join("\n");
}

/** メール本文をログに残すフォールバック(開発時の動作確認用)。 */
function logFallback(
  reason: string,
  payload: { to: string; subject: string; text: string },
): void {
  console.info(
    [
      "==================== [mail:fallback] ====================",
      reason,
      `To     : ${payload.to}`,
      `Subject: ${payload.subject}`,
      "----- body -----",
      payload.text,
      "=========================================================",
    ].join("\n"),
  );
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "unknown";
}
