"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type PlaceOption = { code: string; name: string };

/**
 * 予約一覧のフィルタバー(拠点切り替え・日付検索・前日/翌日移動)。
 * 状態はURLクエリ(?place=&date=)に反映し、Server Component が再取得する。
 */
export function ReservationFilters({
  places,
  placeCode,
  date,
  prevDate,
  nextDate,
  todayDate,
}: {
  places: PlaceOption[];
  placeCode: string;
  date: string;
  prevDate: string;
  nextDate: string;
  todayDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(nextPlace: string, nextDateStr: string) {
    const params = new URLSearchParams({ place: nextPlace, date: nextDateStr });
    startTransition(() => {
      router.push(`/admin/reservations?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex gap-1">
        {places.map((p) => {
          const active = p.code === placeCode;
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => navigate(p.code, date)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (active
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100")
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(placeCode, prevDate)}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          ← 前日
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && navigate(placeCode, e.target.value)}
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-800"
        />
        <button
          type="button"
          onClick={() => navigate(placeCode, nextDate)}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          翌日 →
        </button>
        <button
          type="button"
          onClick={() => navigate(placeCode, todayDate)}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          今日
        </button>
        {isPending && <span className="text-xs text-zinc-400">更新中...</span>}
      </div>
    </div>
  );
}
