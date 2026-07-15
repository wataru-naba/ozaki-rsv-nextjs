import { PrismaClient, Weekday, AdminRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * 開発用シードデータ投入スクリプト。
 *
 * すべて upsert で実装しており、繰り返し実行しても重複しない(冪等)。
 * 投入対象:
 *  - Place        : 日向(HYUGA)/ 延岡(NOBEOKA)
 *  - BusinessHour : 両拠点 × 全曜日区分(SUNDAY〜SATURDAY, PUBLIC_HOLIDAY)
 *  - AdminUser    : 開発用テスト管理者(env で上書き可能)
 *  - PublicHoliday: 動作確認用のダミー祝日
 */

/** @db.Time 用の Date を生成する(日付部分は無視され時刻のみ保持される)。UTC基準で構築。 */
function timeOf(hour: number, minute: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

/** @db.Date 用の Date を生成する(その日の 00:00 UTC)。 */
function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

type BusinessHourSeed = {
  weekday: Weekday;
  isOpen: boolean;
  openTime: Date | null;
  closeTime: Date | null;
  breakStart: Date | null;
  breakEnd: Date | null;
  reservationLimit: number;
};

// 平日(月〜金): 9:00-18:30、昼休憩 13:00-14:00、1枠あたり上限2
const weekdayOpen = (weekday: Weekday): BusinessHourSeed => ({
  weekday,
  isOpen: true,
  openTime: timeOf(9, 0),
  closeTime: timeOf(18, 30),
  breakStart: timeOf(13, 0),
  breakEnd: timeOf(14, 0),
  reservationLimit: 2,
});

// 休診(日曜・祝日): 時刻・上限は無効値
const closedDay = (weekday: Weekday): BusinessHourSeed => ({
  weekday,
  isOpen: false,
  openTime: null,
  closeTime: null,
  breakStart: null,
  breakEnd: null,
  reservationLimit: 0,
});

const businessHourDefaults: BusinessHourSeed[] = [
  closedDay(Weekday.SUNDAY),
  weekdayOpen(Weekday.MONDAY),
  weekdayOpen(Weekday.TUESDAY),
  weekdayOpen(Weekday.WEDNESDAY),
  weekdayOpen(Weekday.THURSDAY),
  weekdayOpen(Weekday.FRIDAY),
  // 土曜は 9:00-17:00 の短縮営業(現実的なデフォルト)
  {
    weekday: Weekday.SATURDAY,
    isOpen: true,
    openTime: timeOf(9, 0),
    closeTime: timeOf(17, 0),
    breakStart: timeOf(13, 0),
    breakEnd: timeOf(14, 0),
    reservationLimit: 2,
  },
  // 祝日区分はデフォルト休診(要件どおり)
  closedDay(Weekday.PUBLIC_HOLIDAY),
];

async function main() {
  console.log("Seeding database...");

  // --- Place ---
  const places = [
    { code: "HYUGA", name: "日向" },
    { code: "NOBEOKA", name: "延岡" },
  ];

  for (const p of places) {
    const place = await prisma.place.upsert({
      where: { code: p.code },
      update: { name: p.name },
      create: { code: p.code, name: p.name },
    });
    console.log(`  Place: ${place.code} (${place.name}) [id=${place.id}]`);

    // --- BusinessHour(拠点 × 全曜日区分)---
    for (const bh of businessHourDefaults) {
      await prisma.businessHour.upsert({
        where: { placeId_weekday: { placeId: place.id, weekday: bh.weekday } },
        update: {
          isOpen: bh.isOpen,
          openTime: bh.openTime,
          closeTime: bh.closeTime,
          breakStart: bh.breakStart,
          breakEnd: bh.breakEnd,
          reservationLimit: bh.reservationLimit,
        },
        create: {
          placeId: place.id,
          weekday: bh.weekday,
          isOpen: bh.isOpen,
          openTime: bh.openTime,
          closeTime: bh.closeTime,
          breakStart: bh.breakStart,
          breakEnd: bh.breakEnd,
          reservationLimit: bh.reservationLimit,
        },
      });
    }
    console.log(`    BusinessHour: ${businessHourDefaults.length} rows`);
  }

  // --- AdminUser(開発用テストアカウント)---
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "password123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.adminUser.upsert({
    where: { username: adminUsername },
    update: { passwordHash, role: AdminRole.ADMIN },
    create: {
      username: adminUsername,
      email: "admin@example.com",
      passwordHash,
      role: AdminRole.ADMIN,
    },
  });
  console.log(`  AdminUser: ${admin.username} (role=${admin.role})`);
  console.log(`    -> login password (dev only): ${adminPassword}`);

  // --- PublicHoliday(動作確認用ダミー祝日。全拠点共有)---
  const holidays = [
    { date: "2026-07-20", name: "海の日" },
    { date: "2026-08-11", name: "山の日" },
    { date: "2026-09-21", name: "敬老の日" },
  ];

  for (const h of holidays) {
    await prisma.publicHoliday.upsert({
      where: { date: dateOf(h.date) },
      update: { name: h.name },
      create: { date: dateOf(h.date), name: h.name },
    });
  }
  console.log(`  PublicHoliday: ${holidays.length} rows`);

  console.log("Seeding complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
