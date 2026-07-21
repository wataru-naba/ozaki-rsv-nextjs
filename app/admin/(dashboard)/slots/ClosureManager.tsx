"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClosure, deleteClosure } from "@/app/admin/_actions/settings";

export type ClosureRow = {
  id: number;
  date: string; // "YYYY-MM-DD"
  isAllDay: boolean;
  startTime: string; // "" or "HH:MM"
  endTime: string;
};

/** 不定休(Closure)の一覧・登録・削除。 */
export function ClosureManager({
  placeId,
  closures,
}: {
  placeId: number;
  closures: ClosureRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    if (!date) {
      setError("日付を指定してください。");
      return;
    }
    startTransition(async () => {
      const result = await createClosure({
        placeId,
        date,
        isAllDay,
        startTime: isAllDay ? undefined : startTime || undefined,
        endTime: isAllDay ? undefined : endTime || undefined,
      });
      if (result.ok) {
        setDate("");
        setStartTime("");
        setEndTime("");
        setIsAllDay(true);
        router.refresh();
      } else {
        const fieldMsg = result.error.fieldErrors
          ? Object.values(result.error.fieldErrors).flat().join(" / ")
          : "";
        setError(fieldMsg || result.error.message);
      }
    });
  }

  function onDelete(closureId: number) {
    if (!window.confirm("この不定休を削除しますか?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteClosure({ closureId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  const timeCls =
    "w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-400";

  return (
    <div className="flex flex-col gap-4">
      {/* 登録フォーム */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
            />
            終日休診
          </label>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">開始</label>
            <input
              type="time"
              value={startTime}
              disabled={isAllDay}
              onChange={(e) => setStartTime(e.target.value)}
              className={timeCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">終了</label>
            <input
              type="time"
              value={endTime}
              disabled={isAllDay}
              onChange={(e) => setEndTime(e.target.value)}
              className={timeCls}
            />
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            追加
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* 一覧 */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">日付</th>
              <th className="px-3 py-2 font-medium">区分</th>
              <th className="px-3 py-2 font-medium">時間帯</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {closures.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-zinc-400">
                  登録された不定休はありません。
                </td>
              </tr>
            ) : (
              closures.map((c) => (
                <tr key={c.id} className="border-b border-zinc-50 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-800">{c.date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {c.isAllDay ? "終日休診" : "時間帯休診"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {c.isAllDay ? "—" : `${c.startTime} 〜 ${c.endTime}`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      disabled={isPending}
                      className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
