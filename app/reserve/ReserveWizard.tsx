"use client";

import { useEffect, useState } from "react";
import { typeDurationMinutes, type TypeId } from "@/lib/reservation/publicTypes";
import {
  applyConsultationSelection,
  loadDraft,
  saveDraft,
  type ReservationDraft,
} from "./draft";
import StepConsultation from "./steps/StepConsultation";

type Step = 0 | 1;

const STEP_LABELS = ["相談内容", "日時選択"] as const;

/**
 * 利用者向け予約フローのウィザード本体(クライアントコンポーネント)。
 *
 * US-001 スコープ: 「相談内容(拠点+来店経験)選択」までを担う最小のウィザード骨格。
 * - ステップ管理と sessionStorage への下書き永続化(リロード耐性)を確立する。
 * - StepConsultation の onNext が正しい payload({place, typeId})で呼ばれると、
 *   下書きへ反映(条件変更時は日時を破棄)し、日時選択ステップの「準備中」プレースホルダを表示する。
 * - 日時選択画面本体(StepDateTime)は US-002 が本ブランチの骨格の上に追加する。
 *   本ブランチでは StepDateTime を import しない(スコープ厳守)。
 */
export default function ReserveWizard() {
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<ReservationDraft>({});

  // 初回マウント時に sessionStorage から復元(SSR出力との不一致を避けるためマウント後に読み込む)。
  useEffect(() => {
    const loaded = loadDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loaded);
    setStep(deriveStep(loaded));
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return <p className="py-12 text-center text-sm text-zinc-500">読み込み中…</p>;
  }

  return (
    <div>
      <StepIndicator current={step} />

      <div className="mt-6">
        {step === 0 && (
          <StepConsultation
            place={draft.place}
            typeId={draft.typeId}
            onNext={({ place, typeId }) => {
              // 拠点/来店経験が変わったら日時選択(date/time)を破棄して条件を取り直す。
              const merged = applyConsultationSelection(draft, { place, typeId });
              setDraft(merged);
              saveDraft(merged);
              setStep(1);
              if (typeof window !== "undefined") window.scrollTo({ top: 0 });
            }}
          />
        )}

        {step === 1 && draft.place != null && draft.typeId != null && (
          <DateTimePlaceholder
            typeId={draft.typeId}
            onBack={() => {
              setStep(0);
              if (typeof window !== "undefined") window.scrollTo({ top: 0 });
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * US-002(日時選択)導入までの暫定プレースホルダ。
 * 選択済みの拠点・来店経験・確定した所要時間を表示し、次の実装対象であることを明示する。
 */
function DateTimePlaceholder({
  typeId,
  onBack,
}: {
  typeId: TypeId;
  onBack: () => void;
}) {
  const duration = typeDurationMinutes(typeId);
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
        <p className="text-sm font-semibold text-zinc-700">日時選択は準備中です</p>
        <p className="mt-2 text-xs text-zinc-500">
          ご選択の条件で所要時間(約{duration}分)の枠をご案内する日時選択画面は、現在準備中です。
        </p>
      </div>
      <div className="flex justify-start">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400"
        >
          相談内容の選択へ戻る
        </button>
      </div>
    </div>
  );
}

/** 現在の下書きから復元すべきステップを算出する(直接 URL 復帰・リロード時の整合性確保)。 */
function deriveStep(draft: ReservationDraft): Step {
  if (draft.place == null || draft.typeId == null) return 0;
  return 1;
}

function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-1 text-xs sm:text-sm">
      {STEP_LABELS.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li key={label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  active
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : done
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-zinc-300 bg-white text-zinc-400"
                }`}
              >
                {i + 1}
              </span>
              <span className={active ? "text-emerald-700" : "text-zinc-500"}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <span className={`mx-1 h-px flex-1 ${done ? "bg-emerald-500" : "bg-zinc-200"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
