import { z } from "zod";

/**
 * 基本設定(BusinessHour)の入力バリデーションスキーマ(api-design.md 5.3 節)。
 *
 * Server Action(`"use server"`)ファイルは async 関数しか export できないため、
 * スキーマ定義はこのモジュールに分離し、Action からは import して利用する。
 * これにより単体テストからもスキーマを直接検証できる。
 *
 * 不定休(Closure)関連スキーマは US-009 の範囲のため本 US では定義しない。
 * US-009 が本ファイルへ CreateClosureSchema 等を追記する前提とする。
 */

const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * BusinessHour 編集。営業時間の外枠 9:00-18:30 を入力時点で強制する
 * (3章判定ロジックのステップ0と二重担保)。
 */
export const UpdateBusinessHourSchema = z
  .object({
    placeId: z.number().int(),
    weekday: z.enum([
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "PUBLIC_HOLIDAY",
    ]),
    isOpen: z.boolean(),
    openTime: z.string().regex(TIME_RE).optional(),
    closeTime: z.string().regex(TIME_RE).optional(),
    breakStart: z.string().regex(TIME_RE).optional(),
    breakEnd: z.string().regex(TIME_RE).optional(),
    reservationLimit: z.number().int().min(0),
  })
  .refine((v) => !v.isOpen || (v.openTime && v.closeTime), {
    message: "営業日の場合は開始・終了時刻が必須です",
    path: ["openTime"],
  })
  .refine((v) => !v.openTime || v.openTime >= "09:00", {
    message: "開始時刻は9:00以降のみ設定できます",
    path: ["openTime"],
  })
  .refine((v) => !v.closeTime || v.closeTime <= "18:30", {
    message: "終了時刻は18:30以前のみ設定できます",
    path: ["closeTime"],
  })
  .refine((v) => !v.openTime || !v.closeTime || v.openTime < v.closeTime, {
    message: "終了時刻は開始時刻より後に設定してください",
    path: ["closeTime"],
  })
  .refine(
    (v) => {
      // 休憩は両方揃っている必要があり、営業時間内に収まること。
      if (!v.breakStart && !v.breakEnd) return true;
      if (!v.breakStart || !v.breakEnd) return false;
      if (v.breakStart >= v.breakEnd) return false;
      if (v.openTime && v.breakStart < v.openTime) return false;
      if (v.closeTime && v.breakEnd > v.closeTime) return false;
      return true;
    },
    {
      message: "休憩時間は開始<終了、かつ営業時間内で指定してください",
      path: ["breakStart"],
    },
  );

export type UpdateBusinessHourInput = z.infer<typeof UpdateBusinessHourSchema>;
