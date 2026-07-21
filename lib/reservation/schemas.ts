import { z } from "zod";

/**
 * 公開予約APIのリクエスト/レスポンス Zod スキーマ。
 * api-design.md 2.2 / 2.3 節に対応。
 */

/** GET /api/public/availability クエリ。 */
export const AvailabilityQuerySchema = z.object({
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.coerce.number().int().min(0).max(2), // 0=90分 / 1=60分 / 2=30分(要件 3-2)
  // 省略時は JST 当日。予約範囲は当日から21日先まで固定(要件 A章)。
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

/** POST /api/public/reservations ボディ。 */
export const CreateReservationSchema = z.object({
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.number().int().min(0).max(2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 開始日
  time: z.string().regex(/^\d{2}:\d{2}$/), // 開始時刻 "09:00"(30分刻み)
  // 旧フロントの抜け(氏名系 required 未設定)は踏襲せず、氏名・カナとも必須(api-design.md 2.3 / 9章)。
  name: z.string().min(1).max(255),
  kana: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[ぁ-んァ-ンー\s　]+$/, "ひらがな/カタカナのみで入力してください"),
  tel: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[0-9]+$/, "数字のみで入力してください"),
  email: z.email().max(255),
  privacyAgreed: z.literal(true),
  // 濫用対策用ハニーポット(8章)。実在項目ではなく bot 検知用の空フィールド。
  // 値が入っていた場合は route 側で bot 疑いとして扱う(サイレントドロップ)。
  // 400 ではなくサイレント成功にするため、スキーマ上は自由文字列として受ける。
  hpField: z.string().optional(),
});
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;

/** 30分刻みかどうかの追加検証(スキーマ regex では表現しづらいため関数化)。 */
export function isOn30MinBoundary(time: string): boolean {
  const [, m] = time.split(":").map(Number);
  return m === 0 || m === 30;
}
