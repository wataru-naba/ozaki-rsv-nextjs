"use client";

import { useState, useTransition } from "react";
import type { Weekday } from "@prisma/client";
import { updateBusinessHour } from "@/app/admin/_actions/settings";
import { WEEKDAY_LABEL } from "@/lib/admin/labels";

export type BusinessHourRow = {
  weekday: Weekday;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  breakStart: string;
  breakEnd: string;
  reservationLimit: number;
};

/** 1曜日区分ぶんの編集フォーム(行)。 */
function RowForm({ placeId, row }: { placeId: number; row: BusinessHourRow }) {
  const [isOpen, setIsOpen] = useState(row.isOpen);
  const [openTime, setOpenTime] = useState(row.openTime);
  const [closeTime, setCloseTime] = useState(row.closeTime);
  const [breakStart, setBreakStart] = useState(row.breakStart);
  const [breakEnd, setBreakEnd] = useState(row.breakEnd);
  const [reservationLimit, setReservationLimit] = useState(String(row.reservationLimit));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function onSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateBusinessHour({
        placeId,
        weekday: row.weekday,
        isOpen,
        openTime: openTime || undefined,
        closeTime: closeTime || undefined,
        breakStart: breakStart || undefined,
        breakEnd: breakEnd || undefined,
        reservationLimit: Number(reservationLimit) || 0,
      });
      if (result.ok) {
        setMessage({ type: "ok", text: "保存しました" });
      } else {
        const fieldMsg = result.error.fieldErrors
          ? Object.values(result.error.fieldErrors).flat().join(" / ")
          : "";
        setMessage({ type: "error", text: fieldMsg || result.error.message });
      }
    });
  }

  const timeCls =
    "w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-400";

  return (
    <tr className="border-b border-zinc-50 last:border-0 align-middle">
      <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800">
        {WEEKDAY_LABEL[row.weekday]}
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
          <input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} />
          営業
        </label>
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          value={openTime}
          disabled={!isOpen}
          min="09:00"
          max="18:30"
          onChange={(e) => setOpenTime(e.target.value)}
          className={timeCls}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          value={closeTime}
          disabled={!isOpen}
          min="09:00"
          max="18:30"
          onChange={(e) => setCloseTime(e.target.value)}
          className={timeCls}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          value={breakStart}
          disabled={!isOpen}
          onChange={(e) => setBreakStart(e.target.value)}
          className={timeCls}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          value={breakEnd}
          disabled={!isOpen}
          onChange={(e) => setBreakEnd(e.target.value)}
          className={timeCls}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={reservationLimit}
          disabled={!isOpen}
          onChange={(e) => setReservationLimit(e.target.value)}
          className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-400"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {message && (
            <span
              className={
                "text-xs " + (message.type === "ok" ? "text-green-600" : "text-red-600")
              }
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
          >
            {isPending ? "保存中" : "保存"}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** 拠点の全曜日区分の営業設定テーブル。 */
export function BusinessHourEditor({
  placeId,
  rows,
}: {
  placeId: number;
  rows: BusinessHourRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
            <th className="px-3 py-2 font-medium">曜日区分</th>
            <th className="px-3 py-2 font-medium">営業</th>
            <th className="px-3 py-2 font-medium">開始</th>
            <th className="px-3 py-2 font-medium">終了</th>
            <th className="px-3 py-2 font-medium">休憩開始</th>
            <th className="px-3 py-2 font-medium">休憩終了</th>
            <th className="px-3 py-2 font-medium">予約上限</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RowForm key={row.weekday} placeId={placeId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
