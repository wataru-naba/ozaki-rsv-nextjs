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

/** 1ページ(1週間分)に表示する日数。21日間 ÷ 7 = ちょうど3ページになる。 */
const DAYS_PER_PAGE = 7;

/**
 * ステップ2: 日付×時間のタイムテーブル形式で空き状況を3段階表示し、日時を選ぶ。
 * GET /api/public/availability で21日分をまとめて取得し、日付を選ばなくても
 * 一覧性高く空き時間を確認できるようにする(行=日付、列=時間、7日単位でページャー)。
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
  const [page, setPage] = useState(0);

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
        // 前ステップから戻ってきた際、既に選択済みの日付が含まれるページを開いた状態にする。
        if (date) {
          const idx = json.days.findIndex((d) => d.date === date);
          if (idx >= 0) setPage(Math.floor(idx / DAYS_PER_PAGE));
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, typeId]);

  const pageCount = data ? Math.max(1, Math.ceil(data.days.length / DAYS_PER_PAGE)) : 1;
  const pageDays = useMemo(
    () => data?.days.slice(page * DAYS_PER_PAGE, page * DAYS_PER_PAGE + DAYS_PER_PAGE) ?? [],
    [data, page],
  );
  // 全日で同一の時間帯セットが返る前提(要件A章: 営業時間9:00-18:30固定)のため先頭日から列を作る。
  const times = data?.days[0]?.slots.map((s) => s.time) ?? [];
  const selectedDay = useMemo(
    () => data?.days.find((d) => d.date === selectedDate),
    [data, selectedDate],
  );

  function handleSelect(d: string, t: string, status: SlotStatus) {
    if (status === "UNAVAILABLE") return;
    setSelectedDate(d);
    setSelectedTime(t);
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

  const firstDay = pageDays[0];
  const lastDay = pageDays[pageDays.length - 1];

  return (
    <div className="space-y-6">
      {externalError && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{externalError}</p>
      )}

      <div>
        <h2 className="mb-1 text-lg font-semibold text-zinc-800">ご希望の日時を選択してください</h2>
        <p className="text-xs text-zinc-500">
          本日から21日先までご予約いただけます(所要 約{data.durationMinutes}分)。表内の○/△をタップして日時をお選びください。
        </p>
      </div>

      <Legend />

      {selectedDay && selectedTime && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          選択中: {formatDateLabel(selectedDay.date, selectedDay.weekday)} {selectedTime}
        </p>
      )}

      {/* 週送りページャー */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-zinc-50"
        >
          ← 前の週
        </button>
        <span className="text-sm font-medium text-zinc-600">
          {firstDay && lastDay ? `${rangeLabel(firstDay.date)} 〜 ${rangeLabel(lastDay.date)}` : ""}
        </span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-zinc-50"
        >
          次の週 →
        </button>
      </div>

      {/* タイムテーブル(行=時間、列=日付) */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50">
              <th className="sticky left-0 z-10 bg-zinc-50 px-2 py-2 text-left font-medium text-zinc-500">
                時刻
              </th>
              {pageDays.map((day) => {
                const [, mm, dd] = day.date.split("-");
                const isSunday = day.weekday === 0;
                const isSaturday = day.weekday === 6;
                return (
                  <th
                    key={day.date}
                    className={`whitespace-nowrap px-1.5 py-2 text-center font-medium ${
                      day.isPublicHoliday || isSunday
                        ? "text-red-500"
                        : isSaturday
                          ? "text-blue-500"
                          : "text-zinc-500"
                    }`}
                  >
                    {Number(mm)}/{Number(dd)}（{WEEKDAY_LABELS[day.weekday]}）
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {times.map((t, i) => (
              <tr key={t} className="border-t border-zinc-100">
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 text-left font-medium text-zinc-800"
                >
                  {t}
                </th>
                {pageDays.map((day) => {
                  const slot = day.slots[i];
                  const meta = STATUS_META[slot.status];
                  const disabled = slot.status === "UNAVAILABLE";
                  const active = selectedDate === day.date && selectedTime === slot.time;
                  const [, mm, dd] = day.date.split("-");
                  return (
                    <td key={day.date} className="p-0.5 text-center">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleSelect(day.date, slot.time, slot.status)}
                        aria-pressed={active}
                        aria-label={`${Number(mm)}/${Number(dd)} ${slot.time} ${meta.label}`}
                        className={`flex h-8 w-8 items-center justify-center rounded transition ${
                          active
                            ? "bg-emerald-100 ring-2 ring-emerald-500"
                            : disabled
                              ? "cursor-not-allowed"
                              : "hover:bg-emerald-50"
                        }`}
                      >
                        <span className={`text-base leading-none ${meta.className}`}>{meta.symbol}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

/** ページャー見出し用の短い日付表記("7/15"等)。 */
function rangeLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function formatDateLabel(date: string, weekday: number): string {
  const [y, m, d] = date.split("-");
  return `${y}年${Number(m)}月${Number(d)}日（${WEEKDAY_LABELS[weekday]}）`;
}
