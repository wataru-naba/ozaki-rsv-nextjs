import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth/session";
import { reservationTypeLabel } from "@/lib/admin/labels";
import {
  addDaysToDateStr,
  formatJstTime,
  jstDateStrToInstant,
  jstPartsOfInstant,
} from "@/lib/reservation/time";
import { WEEKDAY_LABELS } from "@/lib/reservation/publicTypes";
import { ReservationFilters } from "./ReservationFilters";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();

  const params = await searchParams;
  const places = await prisma.place.findMany({ orderBy: { id: "asc" } });

  // 拠点解決(不正/未指定なら先頭拠点)
  const rawPlace = typeof params.place === "string" ? params.place : "";
  const place = places.find((p) => p.code === rawPlace) ?? places[0];

  // 日付解決(不正/未指定なら JST 当日)
  const todayStr = jstPartsOfInstant(new Date()).dateStr;
  const rawDate = typeof params.date === "string" ? params.date : "";
  const date = DATE_RE.test(rawDate) ? rawDate : todayStr;

  // JST 当日の予約を範囲検索([00:00, 翌00:00))
  const dayStart = jstDateStrToInstant(date, 0);
  const dayEnd = jstDateStrToInstant(date, 24 * 60);

  const reservations = place
    ? await prisma.reservation.findMany({
        where: { placeId: place.id, startAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startAt: "asc" },
      })
    : [];

  const weekday = jstPartsOfInstant(dayStart).weekday;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">予約一覧</h1>
      </div>

      {place ? (
        <ReservationFilters
          places={places.map((p) => ({ code: p.code, name: p.name }))}
          placeCode={place.code}
          date={date}
          prevDate={addDaysToDateStr(date, -1)}
          nextDate={addDaysToDateStr(date, 1)}
          todayDate={todayStr}
        />
      ) : (
        <p className="text-sm text-red-600">拠点マスタが登録されていません。</p>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-3">
          <p className="text-sm font-medium text-zinc-800">
            {place?.name} / {date}（{WEEKDAY_LABELS[weekday]}）— {reservations.length} 件
          </p>
        </div>

        {reservations.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400">
            この日の予約はありません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                  <th className="px-4 py-2 font-medium">予約時間</th>
                  <th className="px-4 py-2 font-medium">名前</th>
                  <th className="px-4 py-2 font-medium">種別</th>
                  <th className="px-4 py-2 font-medium">所要</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">TEL</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-zinc-900">
                      {formatJstTime(r.startAt)}–{formatJstTime(r.endAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-800">{r.name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">
                      {reservationTypeLabel(r.typeId)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">
                      {r.durationMinutes}分
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{r.email}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{r.tel ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Link
                        href={`/admin/reservations/${r.id}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        詳細
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
