"use client";

import {
  placeLabel,
  typeLabel,
  typeDurationMinutes,
  type PlaceCode,
  type TypeId,
} from "@/lib/reservation/publicTypes";
import { formatDateLabel } from "./StepDateTime";
import { weekdayOfDateStr } from "../dateUtil";

type Props = {
  place: PlaceCode;
  typeId: TypeId;
  date: string;
  time: string;
  name: string;
  kana: string;
  tel: string;
  email: string;
  submitting: boolean;
  submitError: string | null;
  onBack: () => void;
  onSubmit: () => void;
};

/**
 * ステップ4: 入力内容の確認。ここで最終送信(POST /api/public/reservations)を行う。
 */
export default function StepConfirm({
  place,
  typeId,
  date,
  time,
  name,
  kana,
  tel,
  email,
  submitting,
  submitError,
  onBack,
  onSubmit,
}: Props) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "店舗", value: `${placeLabel(place)}店` },
    { label: "ご相談内容", value: `${typeLabel(typeId)}(約${typeDurationMinutes(typeId)}分)` },
    { label: "ご予約日時", value: `${formatDateLabel(date, weekdayOfDateStr(date))} ${time}` },
    { label: "お名前", value: name },
    { label: "フリガナ", value: kana },
    { label: "電話番号", value: tel },
    { label: "メールアドレス", value: email },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-800">ご予約内容の確認</h2>
      <p className="text-sm text-zinc-600">以下の内容でよろしければ「この内容で予約する」を押してください。</p>

      <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 text-sm font-medium text-zinc-500">{r.label}</dt>
            <dd className="text-sm text-zinc-900">{r.value}</dd>
          </div>
        ))}
      </dl>

      {submitError && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{submitError}</p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="rounded-lg border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
        >
          戻る
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition enabled:hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? "送信中…" : "この内容で予約する"}
        </button>
      </div>
    </div>
  );
}
