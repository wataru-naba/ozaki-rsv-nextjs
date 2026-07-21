"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPublicHoliday, deletePublicHoliday } from "@/app/admin/_actions/settings";

export type HolidayRow = {
  id: number;
  date: string; // "YYYY-MM-DD"
  name: string; // "" or 祝日名
};

/**
 * 祝日(PublicHoliday)の一覧・登録・削除(US-010 / api-design.md 5.5 節)。
 *
 * 祝日マスタは拠点非依存(全拠点共有)のため、拠点セレクタは設けない。
 * date は @unique のため、重複登録時は Server Action が DUPLICATE_DATE を返す。
 */
export function HolidayManager({ holidays }: { holidays: HolidayRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    if (!date) {
      setError("日付を指定してください。");
      return;
    }
    startTransition(async () => {
      const result = await createPublicHoliday({
        date,
        name: name.trim() === "" ? undefined : name.trim(),
      });
      if (result.ok) {
        setDate("");
        setName("");
        router.refresh();
      } else {
        const fieldMsg = result.error.fieldErrors
          ? Object.values(result.error.fieldErrors).flat().join(" / ")
          : "";
        setError(fieldMsg || result.error.message);
      }
    });
  }

  function onDelete(holidayId: number) {
    if (!window.confirm("この祝日を削除しますか?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePublicHoliday({ holidayId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">名称(任意)</label>
            <input
              type="text"
              value={name}
              maxLength={50}
              placeholder="例: 建国記念の日"
              onChange={(e) => setName(e.target.value)}
              className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm"
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
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {holidays.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-zinc-400">
                  登録された祝日はありません。
                </td>
              </tr>
            ) : (
              holidays.map((h) => (
                <tr key={h.id} className="border-b border-zinc-50 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-800">{h.date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {h.name === "" ? "—" : h.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(h.id)}
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
