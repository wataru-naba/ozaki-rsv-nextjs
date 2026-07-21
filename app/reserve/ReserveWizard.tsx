"use client";

import { useEffect, useState } from "react";
import {
  placeLabel,
  typeDurationMinutes,
  typeLabel,
  type PlaceCode,
  type TypeId,
} from "@/lib/reservation/publicTypes";
import {
  applyConsultationSelection,
  applyDateTimeSelection,
  loadDraft,
  saveDraft,
  type ReservationDraft,
} from "./draft";
import StepConsultation from "./steps/StepConsultation";
import StepDateTime from "./steps/StepDateTime";

type Step = 0 | 1 | 2;

const STEP_LABELS = ["相談内容", "日時選択", "お客様情報"] as const;

/**
 * 利用者向け予約フローのウィザード本体(クライアントコンポーネント)。
 *
 * ステップ構成(現状):
 * - ステップ0: 相談内容(拠点+来店経験)選択 … US-001
 * - ステップ1: 日時選択(空き状況タイムテーブル) … US-002(本ブランチで実装)
 * - ステップ2: お客様情報入力 … US-003(未実装。プレースホルダ)
 *
 * US-002 スコープ: US-001 が確立した骨格(ステップ管理 + sessionStorage 下書き永続化)の上に、
 * ステップ1のプレースホルダを実際の StepDateTime へ差し替える。
 * - StepDateTime の onNext が {date, time} で呼ばれると下書きへ反映し、次ステップ(お客様情報)へ進む。
 * - 「戻る」で相談内容選択へ戻る。
 * - お客様情報入力(StepCustomer / 確定)は US-003 がこの骨格の上に追加する。
 *   本ブランチでは「準備中」プレースホルダで止める(契約: onNext が {date,time} で正しく呼ばれること)。
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
              scrollTop();
            }}
          />
        )}

        {step === 1 && draft.place != null && draft.typeId != null && (
          <StepDateTime
            place={draft.place}
            typeId={draft.typeId}
            date={draft.date}
            time={draft.time}
            onBack={() => {
              setStep(0);
              scrollTop();
            }}
            onNext={({ date, time }) => {
              const merged = applyDateTimeSelection(draft, { date, time });
              setDraft(merged);
              saveDraft(merged);
              setStep(2);
              scrollTop();
            }}
          />
        )}

        {step === 2 && draft.place != null && draft.typeId != null && draft.date && draft.time && (
          <CustomerInfoPlaceholder
            place={draft.place}
            typeId={draft.typeId}
            date={draft.date}
            time={draft.time}
            onBack={() => {
              setStep(1);
              scrollTop();
            }}
          />
        )}
      </div>
    </div>
  );
}

function scrollTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}

/**
 * US-003(お客様情報入力・予約確定)導入までの暫定プレースホルダ。
 * ここまでに選択した条件(拠点・来店経験・所要時間・日時)を確認表示し、次の実装対象であることを明示する。
 */
function CustomerInfoPlaceholder({
  place,
  typeId,
  date,
  time,
  onBack,
}: {
  place: PlaceCode;
  typeId: TypeId;
  date: string;
  time: string;
  onBack: () => void;
}) {
  const duration = typeDurationMinutes(typeId);
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <dt className="text-zinc-500">店舗</dt>
        <dd className="font-medium text-zinc-800">{placeLabel(place)}店</dd>
        <dt className="text-zinc-500">ご相談内容</dt>
        <dd className="font-medium text-zinc-800">
          {typeLabel(typeId)}(所要 約{duration}分)
        </dd>
        <dt className="text-zinc-500">ご希望日時</dt>
        <dd className="font-medium text-zinc-800">
          {date} {time}
        </dd>
      </dl>

      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
        <p className="text-sm font-semibold text-zinc-700">お客様情報の入力は準備中です</p>
        <p className="mt-2 text-xs text-zinc-500">
          氏名・フリガナ・電話番号・メールの入力と予約確定は、現在準備中です。
        </p>
      </div>

      <div className="flex justify-start">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400"
        >
          日時の選択へ戻る
        </button>
      </div>
    </div>
  );
}

/** 現在の下書きから復元すべきステップを算出する(直接 URL 復帰・リロード時の整合性確保)。 */
function deriveStep(draft: ReservationDraft): Step {
  if (draft.place == null || draft.typeId == null) return 0;
  if (!draft.date || !draft.time) return 1;
  return 2;
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
