import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth/session";
import { reservationTypeLabel } from "@/lib/admin/labels";
import { formatJstDateTime, formatJstTime, jstPartsOfInstant } from "@/lib/reservation/time";
import { CancelReservationButton } from "./CancelReservationButton";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex border-b border-zinc-100 py-3 last:border-0">
      <dt className="w-32 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();

  const { id } = await params;
  const reservationId = Number(id);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    notFound();
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { place: true },
  });
  if (!reservation) {
    notFound();
  }

  // 一覧へ戻る際のクエリ(拠点・当日)を復元する。
  const dateStr = jstPartsOfInstant(reservation.startAt).dateStr;
  const backHref = `/admin/reservations?place=${reservation.place.code}&date=${dateStr}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">予約詳細</h1>
        <Link href={backHref} className="text-sm text-blue-600 hover:underline">
          ← 一覧へ戻る
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <dl>
          <Row label="予約ID" value={reservation.id} />
          <Row label="拠点" value={reservation.place.name} />
          <Row
            label="予約日時"
            value={`${formatJstDateTime(reservation.startAt)} 〜 ${formatJstTime(reservation.endAt)}`}
          />
          <Row
            label="種別"
            value={`${reservationTypeLabel(reservation.typeId)}（約${reservation.durationMinutes}分）`}
          />
          <Row label="名前" value={reservation.name} />
          <Row label="カナ" value={reservation.kana ?? "—"} />
          <Row label="Email" value={reservation.email} />
          <Row label="TEL" value={reservation.tel ?? "—"} />
          <Row label="申込日時" value={formatJstDateTime(reservation.createdAt)} />
        </dl>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-red-800">予約のキャンセル</h2>
            <p className="mt-1 text-sm text-red-700">
              キャンセルすると予約が削除され、占有していた予約枠が解放されます。この操作は取り消せません。
            </p>
          </div>
          <CancelReservationButton reservationId={reservation.id} backHref={backHref} />
        </div>
      </div>
    </div>
  );
}
