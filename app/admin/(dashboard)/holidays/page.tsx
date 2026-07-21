import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth/session";
import { dateColToStr } from "@/lib/reservation/time";
import { HolidayManager, type HolidayRow } from "./HolidayManager";

/**
 * 祝日管理ページ(AdminHeader の「祝日管理」リンク先 /admin/holidays)。US-010。
 *
 * - 祝日マスタ(PublicHoliday)は拠点非依存(全拠点共有)。拠点セレクタは設けない。
 * - 日付昇順で一覧表示し、個別追加・削除を行う(api-design.md 5.5 節)。
 */
export default async function HolidaysPage() {
  await requireAdminSession();

  const holidays = await prisma.publicHoliday.findMany({
    orderBy: { date: "asc" },
  });

  const holidayRows: HolidayRow[] = holidays.map((h) => ({
    id: h.id,
    date: dateColToStr(h.date),
    name: h.name ?? "",
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">祝日管理</h1>
        <p className="mt-1 text-sm text-zinc-500">
          祝日マスタは全拠点共有(拠点非依存)です。ここに登録した日付を、各拠点の
          「祝日」区分の営業設定が休診の場合に予約不可として扱います。新設祝日や移動祝日を
          個別に追加・削除できます。
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <HolidayManager holidays={holidayRows} />
      </section>
    </div>
  );
}
