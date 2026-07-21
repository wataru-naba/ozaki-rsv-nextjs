"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ApiErrorResponse,
  CreateReservationResponse,
  PlaceCode,
  TypeId,
} from "@/lib/reservation/publicTypes";
import {
  applyConsultationSelection,
  applyDateTimeSelection,
  clearDraft,
  loadDraft,
  saveDraft,
  saveResult,
  type ReservationDraft,
} from "./draft";
import type { CustomerInfoValues } from "./customerSchema";
import StepConsultation from "./steps/StepConsultation";
import StepDateTime from "./steps/StepDateTime";
import StepCustomerInfo from "./steps/StepCustomerInfo";
import StepConfirm from "./steps/StepConfirm";

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ["相談内容", "日時選択", "お客様情報", "確認"] as const;

/**
 * 利用者向け予約フローのウィザード本体(クライアントコンポーネント)。
 *
 * ステップ構成:
 * - ステップ0: 相談内容(拠点+来店経験)選択 … US-001
 * - ステップ1: 日時選択(空き状況タイムテーブル) … US-002
 * - ステップ2: お客様情報入力 … US-003(本ブランチで実装)
 * - ステップ3: 入力内容の確認 → 予約確定(POST) … US-003(本ブランチで実装)
 *
 * 5画面のうち完了画面のみ別ルート(/reserve/complete)とし、上記4ステップを本コンポーネントで管理する。
 * 入力途中の内容は sessionStorage(draft.ts)へ永続化し、リロードでも失われないようにする。
 * 確定成功(201)後は結果を sessionStorage へ渡して /reserve/complete へ遷移する。
 */
export default function ReserveWizard() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<ReservationDraft>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 予約枠が取れなかった(SLOT_UNAVAILABLE)場合に日時選択ステップへ戻して表示する警告。
  const [slotError, setSlotError] = useState<string | null>(null);

  // 初回マウント時に sessionStorage から復元(SSR出力との不一致を避けるためマウント後に読み込む)。
  useEffect(() => {
    const loaded = loadDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loaded);
    setStep(deriveStep(loaded));
    setHydrated(true);
  }, []);

  function commit(next: ReservationDraft, nextStep: Step) {
    setDraft(next);
    saveDraft(next);
    setStep(nextStep);
    scrollTop();
  }

  function goTo(nextStep: Step) {
    setStep(nextStep);
    scrollTop();
  }

  async function handleSubmit() {
    if (
      draft.place == null ||
      draft.typeId == null ||
      !draft.date ||
      !draft.time ||
      !draft.name ||
      !draft.kana ||
      !draft.tel ||
      !draft.email
    ) {
      setSubmitError("入力内容が不足しています。最初からやり直してください。");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: draft.place,
          typeId: draft.typeId,
          date: draft.date,
          time: draft.time,
          name: draft.name,
          kana: draft.kana,
          tel: draft.tel,
          email: draft.email,
          privacyAgreed: true,
          hpField: draft.hpField ?? "",
        }),
      });

      if (res.status === 201) {
        const result = (await res.json()) as CreateReservationResponse;
        saveResult(result);
        clearDraft();
        router.push("/reserve/complete");
        return;
      }

      const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
      const code = body?.error.code;

      if (code === "SLOT_UNAVAILABLE") {
        // 選択済みの時間帯が確保できなくなった → 日時選択ステップへ戻す(受け入れ条件)。
        setSlotError(
          "申し訳ございません。ご選択の時間帯はちょうど埋まってしまいました。別の日時をお選びください。",
        );
        setSubmitError(null);
        goTo(1);
        return;
      }

      if (code === "VALIDATION_ERROR") {
        setSubmitError("入力内容に誤りがあります。お客様情報をご確認ください。");
        return;
      }

      if (code === "RATE_LIMITED") {
        setSubmitError("送信回数が上限に達しました。しばらくしてから再度お試しください。");
        return;
      }

      setSubmitError(
        body?.error.message ?? "予約の送信に失敗しました。時間をおいて再度お試しください。",
      );
    } catch {
      setSubmitError("通信エラーが発生しました。通信環境をご確認のうえ、再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

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
              commit(applyConsultationSelection(draft, { place, typeId }), 1);
              setSlotError(null);
            }}
          />
        )}

        {step === 1 && draft.place != null && draft.typeId != null && (
          <StepDateTime
            place={draft.place}
            typeId={draft.typeId}
            date={draft.date}
            time={draft.time}
            externalError={slotError}
            onBack={() => goTo(0)}
            onNext={({ date, time }) => {
              setSlotError(null);
              commit(applyDateTimeSelection(draft, { date, time }), 2);
            }}
          />
        )}

        {step === 2 && (
          <StepCustomerInfo
            defaultValues={{
              name: draft.name,
              kana: draft.kana,
              tel: draft.tel,
              email: draft.email,
              privacyAgreed: draft.privacyAgreed,
              hpField: draft.hpField,
            }}
            onBack={() => goTo(1)}
            onNext={(values: CustomerInfoValues) => {
              commit(
                {
                  ...draft,
                  name: values.name,
                  kana: values.kana,
                  tel: values.tel,
                  email: values.email,
                  privacyAgreed: values.privacyAgreed,
                  hpField: values.hpField,
                },
                3,
              );
            }}
          />
        )}

        {step === 3 &&
          draft.place != null &&
          draft.typeId != null &&
          draft.date &&
          draft.time &&
          draft.name &&
          draft.kana &&
          draft.tel &&
          draft.email && (
            <StepConfirm
              place={draft.place as PlaceCode}
              typeId={draft.typeId as TypeId}
              date={draft.date}
              time={draft.time}
              name={draft.name}
              kana={draft.kana}
              tel={draft.tel}
              email={draft.email}
              submitting={submitting}
              submitError={submitError}
              onBack={() => goTo(2)}
              onSubmit={handleSubmit}
            />
          )}
      </div>
    </div>
  );
}

function scrollTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}

/** 現在の下書きから復元すべきステップを算出する(直接 URL 復帰・リロード時の整合性確保)。 */
function deriveStep(draft: ReservationDraft): Step {
  if (draft.place == null || draft.typeId == null) return 0;
  if (!draft.date || !draft.time) return 1;
  if (!draft.name || !draft.kana || !draft.tel || !draft.email) return 2;
  return 3;
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
