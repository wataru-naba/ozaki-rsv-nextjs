/**
 * 利用者向け予約フロー(UI)で共有するクライアントセーフな型・ラベル定義。
 *
 * このファイルは Prisma などサーバー専用モジュールに一切依存しないため、
 * クライアントコンポーネント("use client")からも安全に import できる。
 *
 * 各値の出典:
 * - typeId ⇔ 来店経験ラベル/所要時間: 要件ドキュメント 3-2節
 * - 拠点(HYUGA/NOBEOKA): 要件ドキュメント I章 / seed
 *
 * NOTE (US-001 スコープ): 本ブランチは「相談内容(拠点+来店経験)選択」までを対象とする。
 * 空き状況(AvailabilityResponse)・予約確定(CreateReservationResponse)・共通エラー型などの
 * API レイヤー型は US-002 / US-003 でこのファイルに追加する。ここでは US-001 が必要とする
 * 拠点・来店経験(typeId)の型/定数のみを定義する。
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

/**
 * 来店経験(typeId)の選択肢。
 *
 * ラベルは旧 entrance の文言を暫定踏襲(要件 3-2節 / user-stories.md US-001 未確認事項)。
 * 本番文言はクライアント確認待ちのため、確定後にここを差し替えれば全画面へ反映される。
 */
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

/**
 * 来店経験(typeId)に対応する所要時間(分)を返す。
 * 0→90分 / 1→60分 / 2→30分(要件 3-2節)。未知の typeId は 0 を返す。
 */
export function typeDurationMinutes(typeId: TypeId): number {
  return TYPE_OPTIONS.find((t) => t.typeId === typeId)?.durationMinutes ?? 0;
}

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
