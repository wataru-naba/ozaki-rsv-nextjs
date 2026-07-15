"use client";

import { useEffect, useMemo, useState } from "react";
import {
  WEEKDAY_LABELS,
  type AvailabilityResponse,
  type PlaceCode,
  type SlotStatus,
  type TypeId,
} from "@/lib/reservation/publicTypes";

type Props = {
  place: PlaceCode;
  typeId: TypeId;
  date?: string;
  time?: string;
  /** 前ステップで予約枠が取れなかった等、外から差し込むエラーメッセージ。 */
  externalError?: string | null;
  onBack: () => void;
  onNext: (value: { date: string; time: string }) => void;
};

const STATUS_META: Record<SlotStatus, { symbol: string; label: string; className: string }> = {
  AVAILABLE: { symbol: "○", label: "予約可能", className: "text-emerald-600" },
  FEW: { symbol: "△", label: "残りわずか", className: "text-amber-600" },
  UNAVAILABLE: { symbol: "×", label: "予約不可", className: "text-zinc-300" },
};

/**
 * ステップ2: カレンダーUIで空き状況を3段階表示し、日時を選ぶ。
 * GET /api/public/availability を呼び、日付を選ぶと時間枠グリッドを表示する。
 */
export default function StepDateTime({
  place,
  typeId,
  date,
  time,
  externalError,
  onBack,
  onNext,
}: Props) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(date);
  const [selectedTime, setSelectedTime] = useState<string | undefined>(time);

  useEffect(() => {
    let aborted = false;
    // 空き状況の取得(データフェッチ)。place/typeId 変更時に再取得するため effect 内で状態更新する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ place, typeId: String(typeId) });
    fetch(`/api/public/availability?${params.toString()}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        return (await res.json()) as AvailabilityResponse;
      })
      .then((json) => {
        if (aborted) return;
        setData(json);
      })
      .catch(() => {
        if (aborted) return;
        setLoadError("空き状況の取得に失敗しました。通信環境をご確認のうえ、再度お試しください。");
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [place, typeId]);

  const selectedDay = useMemo(
    () => data?.days.find((d) => d.date === selectedDate),
    [data, selectedDate],
  );

  function handleSelectDate(d: string) {
    setSelectedDate(d);
    setSelectedTime(undefined);
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-zinc-500">空き状況を読み込んでいます…</p>;
  }

  if (loadError || !data) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{loadError ?? "データを取得できませんでした。"}</p>
        <div className="flex justify-between">
          <BackButton onClick={onBack} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {externalError && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{externalError}</p>
      )}

      <div>
        <h2 className="mb-1 text-lg font-semibold text-zinc-800">ご希望の日付を選択してください</h2>
        <p className="text-xs text-zinc-500">本日から21日先までご予約いただけます(所要 約{data.durationMinutes}分)。</p>
      </div>

      <Legend />

      {/* 日付リスト */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {data.days.map((day) => {
          const hasOpen = day.slots.some((s) => s.status !== "UNAVAILABLE");
          const active = selectedDate === day.date;
          const [, mm, dd] = day.date.split("-");
          const isSunday = day.weekday === 0;
          const isSaturday = day.weekday === 6;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => handleSelectDate(day.date)}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-2 text-center text-sm transition ${
                active
                  ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                  : "border-zinc-200 bg-white hover:border-emerald-400"
              }`}
            >
              <span
                className={`block font-medium ${
                  day.isPublicHoliday || isSunday
                    ? "text-red-500"
                    : isSaturday
                      ? "text-blue-500"
                      : "text-zinc-800"
                }`}
              >
                {Number(mm)}/{Number(dd)}（{WEEKDAY_LABELS[day.weekday]}）
              </span>
              <span className={`mt-1 block text-xs ${hasOpen ? "text-emerald-600" : "text-zinc-400"}`}>
                {hasOpen ? "空きあり" : "満"}
              </span>
            </button>
          );
        })}
      </div>

      {/* 時間枠グリッド */}
      {selectedDay && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-zinc-800">
            {formatDateLabel(selectedDay.date, selectedDay.weekday)} の時間帯
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {selectedDay.slots.map((slot) => {
              const meta = STATUS_META[slot.status];
              const disabled = slot.status === "UNAVAILABLE";
              const active = selectedTime === slot.time;
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedTime(slot.time)}
                  aria-pressed={active}
                  className={`flex flex-col items-center rounded-lg border px-2 py-2 text-sm transition ${
                    active
                      ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                      : disabled
                        ? "cursor-not-allowed border-zinc-100 bg-zinc-50"
                        : "border-zinc-200 bg-white hover:border-emerald-400"
                  }`}
                >
                  <span className={`font-medium ${disabled ? "text-zinc-300" : "text-zinc-800"}`}>
                    {slot.time}
                  </span>
                  <span className={`text-base leading-none ${meta.className}`}>{meta.symbol}</span>
                </button>
              );
            })}
          </div>
          {selectedDay.slots.every((s) => s.status === "UNAVAILABLE") && (
            <p className="mt-3 text-sm text-zinc-500">この日に予約可能な時間帯はありません。別の日をお選びください。</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <BackButton onClick={onBack} />
        <button
          type="button"
          disabled={!selectedDate || !selectedTime}
          onClick={() => {
            if (selectedDate && selectedTime) onNext({ date: selectedDate, time: selectedTime });
          }}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition enabled:hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          お客様情報の入力へ進む
        </button>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 rounded-lg bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
      {(["AVAILABLE", "FEW", "UNAVAILABLE"] as SlotStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`text-base leading-none ${STATUS_META[s].className}`}>
            {STATUS_META[s].symbol}
          </span>
          {STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
    >
      戻る
    </button>
  );
}

export function formatDateLabel(date: string, weekday: number): string {
  const [y, m, d] = date.split("-");
  return `${y}年${Number(m)}月${Number(d)}日（${WEEKDAY_LABELS[weekday]}）`;
}
