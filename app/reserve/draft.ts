import type { PlaceCode, TypeId, CreateReservationResponse } from "@/lib/reservation/publicTypes";

/**
 * 予約ウィザードの下書き状態と、その sessionStorage 永続化ヘルパー。
 *
 * sessionStorage に保存することで、リロードやタブ内での戻る操作でも
 * 入力途中の内容が失われないようにする(ブラウザ戻る/リロードへの堅牢性)。
 * 個人情報を含むため localStorage ではなく sessionStorage を用い、
 * 予約完了時・明示リセット時にクリアする。
 */

export type ReservationDraft = {
  place?: PlaceCode;
  typeId?: TypeId;
  date?: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM"
  name?: string;
  kana?: string;
  tel?: string;
  email?: string;
  privacyAgreed?: boolean;
  hpField?: string; // ハニーポット(通常は空)
};

const DRAFT_KEY = "ozaki-reserve:draft";
const RESULT_KEY = "ozaki-reserve:result";

export function loadDraft(): ReservationDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ReservationDraft) : {};
  } catch {
    return {};
  }
}

export function saveDraft(draft: ReservationDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 保存に失敗しても致命的ではないため握りつぶす(容量超過・プライベートモード等)
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DRAFT_KEY);
}

/** 完了画面に引き継ぐ予約結果の保存/取得(完了画面は別ルートのため sessionStorage 経由で受け渡す)。 */
export function saveResult(result: CreateReservationResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    // noop
  }
}

export function loadResult(): CreateReservationResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as CreateReservationResponse) : null;
  } catch {
    return null;
  }
}

export function clearResult(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(RESULT_KEY);
}
