"use client";

import { useState } from "react";
import {
  PLACE_OPTIONS,
  TYPE_OPTIONS,
  type PlaceCode,
  type TypeId,
} from "@/lib/reservation/publicTypes";

type Props = {
  place?: PlaceCode;
  typeId?: TypeId;
  onNext: (value: { place: PlaceCode; typeId: TypeId }) => void;
};

/**
 * ステップ1: 拠点選択 + 相談内容(来店経験 typeId)選択。
 * MVP要件どおり、フローの最初に拠点選択を含める。
 */
export default function StepConsultation({ place, typeId, onNext }: Props) {
  const [selectedPlace, setSelectedPlace] = useState<PlaceCode | undefined>(place);
  const [selectedType, setSelectedType] = useState<TypeId | undefined>(typeId);

  const canProceed = selectedPlace != null && selectedType != null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-800">ご希望の店舗を選択してください</h2>
        <div className="grid grid-cols-2 gap-3">
          {PLACE_OPTIONS.map((p) => {
            const active = selectedPlace === p.code;
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setSelectedPlace(p.code)}
                aria-pressed={active}
                className={`rounded-lg border p-4 text-center transition ${
                  active
                    ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                    : "border-zinc-300 bg-white hover:border-emerald-400"
                }`}
              >
                <span className="block text-base font-semibold text-zinc-800">{p.name}店</span>
                <span className="mt-1 block text-xs text-zinc-500">TEL {p.tel}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-800">ご相談内容(来店経験)を選択してください</h2>
        <div className="space-y-3">
          {TYPE_OPTIONS.map((t) => {
            const active = selectedType === t.typeId;
            return (
              <button
                key={t.typeId}
                type="button"
                onClick={() => setSelectedType(t.typeId)}
                aria-pressed={active}
                className={`flex w-full items-center justify-between rounded-lg border p-4 text-left transition ${
                  active
                    ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                    : "border-zinc-300 bg-white hover:border-emerald-400"
                }`}
              >
                <span className="text-sm font-medium text-zinc-800">{t.label}</span>
                <span className="ml-3 shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                  所要 約{t.durationMinutes}分
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canProceed}
          onClick={() => {
            if (selectedPlace != null && selectedType != null) {
              onNext({ place: selectedPlace, typeId: selectedType });
            }
          }}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition enabled:hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          日時の選択へ進む
        </button>
      </div>
    </div>
  );
}
