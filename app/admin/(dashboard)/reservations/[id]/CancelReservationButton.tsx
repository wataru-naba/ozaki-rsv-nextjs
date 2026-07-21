"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelReservation } from "@/app/admin/_actions/reservations";

/**
 * 予約キャンセルボタン。確認ダイアログの上で Server Action を呼び、
 * 成功時は一覧へ戻る。
 */
export function CancelReservationButton({
  reservationId,
  backHref,
}: {
  reservationId: number;
  backHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    if (!window.confirm("この予約をキャンセルします。よろしいですか?")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelReservation({ reservationId });
      if (result.ok) {
        router.push(backHref);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
      >
        {isPending ? "キャンセル中..." : "この予約をキャンセル"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
