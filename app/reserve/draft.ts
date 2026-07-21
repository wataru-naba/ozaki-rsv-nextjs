import type {
  PlaceCode,
  TypeId,
  CreateReservationResponse,
} from "@/lib/reservation/publicTypes";

/**
 * 予約ウィザードの下書き状態と、その sessionStorage 永続化ヘルパー。
 *
 * sessionStorage に保存することで、リロードやタブ内での戻る操作でも
 * 入力途中の内容が失われないようにする(ブラウザ戻る/リロードへの堅牢性)。
 * 個人情報を含むため localStorage ではなく sessionStorage を用い、
 * 予約完了時・明示リセット時にクリアする。
 *
 * NOTE (US-001 スコープ): date/time/name/... のフィールドは後続ステップ(US-002 日時選択 /
 * US-003 お客様情報・確定)で使用する。本ブランチでは place/typeId のみを実際に読み書きするが、
 * 下書きの器としてフィールド定義は残す(後続 US がこの器の上に積む)。
 * 完了画面への結果受け渡し(saveResult 等)は US-003 でここに追加する。
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

/**
 * 完了画面へ引き継ぐ予約結果の保存/取得/クリア(US-003)。
 *
 * 完了画面(/reserve/complete)はウィザードとは別ルートのため、確定 API の結果は
 * sessionStorage 経由で受け渡す。完了画面側は読み取り後に必ず clearResult() し、
 * リロードでの二重表示や個人情報の残留を避ける(CompleteView 参照)。
 */
export function saveResult(result: CreateReservationResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    // 保存に失敗しても致命的ではないため握りつぶす(容量超過・プライベートモード等)
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

/**
 * 相談内容(拠点・来店経験)の選択を下書きへ反映する純粋関数。
 *
 * 拠点または来店経験(typeId)が変わった場合、以前に選んでいた日時(date/time)は
 * 別の枠を指すため無効になる。そのため date/time を破棄し、新しい条件で
 * 空き状況を取り直せるようにする(US-001 受け入れ条件: 条件変更時に日時を破棄)。
 * 変更が無ければ日時はそのまま保持する。
 *
 * 副作用を持たない純粋関数として切り出し、ウィザード本体(UI)から独立して
 * テストできるようにしている。
 */
export function applyConsultationSelection(
  draft: ReservationDraft,
  selection: { place: PlaceCode; typeId: TypeId },
): ReservationDraft {
  const changed = draft.place !== selection.place || draft.typeId !== selection.typeId;
  if (changed) {
    return {
      ...draft,
      place: selection.place,
      typeId: selection.typeId,
      date: undefined,
      time: undefined,
    };
  }
  return { ...draft, place: selection.place, typeId: selection.typeId };
}

/**
 * 日時選択(date/time)を下書きへ反映する純粋関数(US-002)。
 *
 * StepDateTime が選択した開始日("YYYY-MM-DD")と開始時刻("HH:MM")を下書きに載せ、
 * 次ステップ(お客様情報入力=US-003)へ引き継げるようにする。
 * 拠点・来店経験は変えないため、それらは保持する。副作用を持たない純粋関数として
 * 切り出し、ウィザード本体(UI)から独立してテストできるようにしている。
 */
export function applyDateTimeSelection(
  draft: ReservationDraft,
  selection: { date: string; time: string },
): ReservationDraft {
  return { ...draft, date: selection.date, time: selection.time };
}
