/**
 * 利用者向け予約フロー(UI)で共有するクライアントセーフな型・ラベル定義。
 *
 * このファイルは Prisma などサーバー専用モジュールに一切依存しないため、
 * クライアントコンポーネント("use client")からも安全に import できる。
 *
 * 各値の出典:
 * - typeId ⇔ 来店経験ラベル/所要時間: 要件ドキュメント 3-2節
 * - 拠点(HYUGA/NOBEOKA): 要件ドキュメント I章 / seed
 * - SlotStatus の3段階: api-design.md 2.2節・要件 3-1節
 */

export type PlaceCode = "HYUGA" | "NOBEOKA";

export type TypeId = 0 | 1 | 2;

export type SlotStatus = "AVAILABLE" | "FEW" | "UNAVAILABLE";

/** 拠点の表示ラベル(要件 I章)。 */
export const PLACE_OPTIONS: ReadonlyArray<{ code: PlaceCode; name: string; tel: string }> = [
  { code: "HYUGA", name: "日向", tel: "0982-52-6688" },
  { code: "NOBEOKA", name: "延岡", tel: "0982-20-2500" },
];

export function placeLabel(code: PlaceCode): string {
  return PLACE_OPTIONS.find((p) => p.code === code)?.name ?? code;
}

/** 来店経験(typeId)の選択肢。ラベルは要件 3-2節どおり。 */
export const TYPE_OPTIONS: ReadonlyArray<{
  typeId: TypeId;
  label: string;
  durationMinutes: number;
}> = [
  { typeId: 0, label: "一度も来店したことがない・わからない", durationMinutes: 90 },
  { typeId: 1, label: "今月ははじめて来店する", durationMinutes: 60 },
  { typeId: 2, label: "今月に来店した事がある", durationMinutes: 30 },
];

export function typeLabel(typeId: TypeId): string {
  return TYPE_OPTIONS.find((t) => t.typeId === typeId)?.label ?? String(typeId);
}

export function typeDurationMinutes(typeId: TypeId): number {
  return TYPE_OPTIONS.find((t) => t.typeId === typeId)?.durationMinutes ?? 0;
}

/** GET /api/public/availability のレスポンス型(api-design.md 2.2節)。 */
export type AvailabilityResponse = {
  place: PlaceCode;
  typeId: number;
  durationMinutes: number;
  generatedAt: string;
  days: Array<{
    date: string; // "2026-07-15"
    weekday: number; // 0(日)〜6(土)
    isPublicHoliday: boolean;
    slots: Array<{ time: string; status: SlotStatus }>;
  }>;
};

/** POST /api/public/reservations の成功レスポンス型(api-design.md 2.3節)。 */
export type CreateReservationResponse = {
  reservationId: number;
  place: PlaceCode;
  typeId: number;
  durationMinutes: number;
  startAt: string; // ISO
  endAt: string; // ISO
};

/** 公開APIの共通エラーレスポンス型(api-design.md 2.1節)。 */
export type ApiErrorResponse = {
  error: {
    code:
      | "VALIDATION_ERROR"
      | "SLOT_UNAVAILABLE"
      | "RATE_LIMITED"
      | "NOT_FOUND"
      | "INTERNAL_ERROR";
    message: string;
    reason?: string;
    fieldErrors?: Record<string, string[]>;
  };
};

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
