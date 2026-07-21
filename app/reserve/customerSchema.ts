import { z } from "zod";

/**
 * お客様情報入力フォームの Zod スキーマ(React Hook Form 用)。
 *
 * POST /api/public/reservations の CreateReservationSchema
 * (`lib/reservation/schemas.ts`)の氏名・カナ・電話・メール・同意部分と整合させる。
 * バリデーションルールはサーバー側と同一(要件B章):
 *  - フリガナ: 平仮名/カタカナ(長音「ー」含む)のみ
 *  - 電話番号: 数字のみ
 *  - メール: 形式チェック
 *  - プライバシー同意: 必須
 * サーバーが最終的な正であり、ここはUX向上のためのクライアント側二重チェック。
 */
export const CustomerInfoSchema = z.object({
  name: z.string().min(1, "お名前を入力してください").max(255, "255文字以内で入力してください"),
  kana: z
    .string()
    .min(1, "フリガナを入力してください")
    .max(255, "255文字以内で入力してください")
    .regex(/^[ぁ-んァ-ンー\s　]+$/, "ひらがな/カタカナのみで入力してください"),
  tel: z
    .string()
    .min(1, "電話番号を入力してください")
    .max(50, "50文字以内で入力してください")
    .regex(/^[0-9]+$/, "数字のみ(ハイフンなし)で入力してください"),
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .max(255, "255文字以内で入力してください")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "メールアドレスの形式が正しくありません"),
  privacyAgreed: z
    .boolean()
    .refine((v) => v === true, "プライバシーポリシーへの同意が必要です"),
  // ハニーポット(通常ユーザーには不可視。値が入っていれば bot 疑い。api-design.md 8.1節)
  hpField: z.string().optional(),
});

export type CustomerInfoValues = z.infer<typeof CustomerInfoSchema>;
