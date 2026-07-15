import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth/session";
import { WEEKDAY_ORDER, timeColToInputValue } from "@/lib/admin/labels";
import { dateColToStr } from "@/lib/reservation/time";
import { BusinessHourEditor, type BusinessHourRow } from "./BusinessHourEditor";
import { ClosureManager, type ClosureRow } from "./ClosureManager";
import type { Weekday } from "@prisma/client";

export default async function SlotsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();

  const params = await searchParams;
  const places = await prisma.place.findMany({ orderBy: { id: "asc" } });

  const rawPlace = typeof params.place === "string" ? params.place : "";
  const place = places.find((p) => p.code === rawPlace) ?? places[0];

  if (!place) {
    return <p className="text-sm text-red-600">拠点マスタが登録されていません。</p>;
  }

  const [businessHours, closures] = await Promise.all([
    prisma.businessHour.findMany({ where: { placeId: place.id } }),
    prisma.closure.findMany({
      where: { placeId: place.id },
      orderBy: { date: "asc" },
    }),
  ]);

  // 全曜日区分を固定順で並べ、DBに無い区分は空(休診)行として補完する。
  const bhByWeekday = new Map(businessHours.map((bh) => [bh.weekday, bh]));
  const bhRows: BusinessHourRow[] = WEEKDAY_ORDER.map((weekday: Weekday) => {
    const bh = bhByWeekday.get(weekday);
    return {
      weekday,
      isOpen: bh?.isOpen ?? false,
      openTime: timeColToInputValue(bh?.openTime ?? null),
      closeTime: timeColToInputValue(bh?.closeTime ?? null),
      breakStart: timeColToInputValue(bh?.breakStart ?? null),
      breakEnd: timeColToInputValue(bh?.breakEnd ?? null),
      reservationLimit: bh?.reservationLimit ?? 0,
    };
  });

  const closureRows: ClosureRow[] = closures.map((c) => ({
    id: c.id,
    date: dateColToStr(c.date),
    isAllDay: c.isAllDay,
    startTime: timeColToInputValue(c.startTime),
    endTime: timeColToInputValue(c.endTime),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">予約枠管理</h1>
        <div className="flex gap-1">
          {places.map((p) => {
            const active = p.code === place.code;
            return (
              <Link
                key={p.code}
                href={`/admin/slots?place=${p.code}`}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100")
                }
              >
                {p.name}
              </Link>
            );
          })}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-800">基本設定(営業時間)</h2>
          <p className="mt-1 text-sm text-zinc-500">
            曜日区分ごとの営業可否・診療時間・休憩時間・予約上限。営業時間は 9:00〜18:30
            の範囲でのみ設定できます。
          </p>
        </div>
        <BusinessHourEditor placeId={place.id} rows={bhRows} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-800">不定休診管理</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {place.name}拠点の臨時休診(終日 / 時間帯)を登録・削除します。
          </p>
        </div>
        <ClosureManager placeId={place.id} closures={closureRows} />
      </section>
    </div>
  );
}
