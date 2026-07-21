import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError, SlotUnavailableError, ValidationError } from "@/lib/api/errors";
import { SLOT_STEP_MINUTES, TYPE_DURATION_MINUTES } from "./constants";
import type { PlaceCode } from "./constants";
import type { CreateReservationInput } from "./schemas";
import { isOn30MinBoundary } from "./schemas";
import { dateStrToDateCol, jstDateStrToInstant, timeStrToMinutes } from "./time";
import {
  judgeCandidate,
  resolveBusinessHour,
  type PreloadedJudgeData,
} from "./judge";

/** 予約確定成功時の結果(route がレスポンスへ整形する)。 */
export type CreateReservationResult = {
  reservationId: number;
  place: PlaceCode;
  typeId: number;
  durationMinutes: number;
  startAt: Date;
  endAt: Date;
};

/**
 * 予約確定処理(api-design.md 2.3 / 4章)。
 *
 * - ステップ0〜3(外枠/ラストオーダー/祝日/不定休/営業時間)をサーバー側で再検証(TOCTOU 対策)。
 * - ステップ4(枠使用状況)は、トランザクション内の `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`
 *   によるアトミック条件更新で厳密に排他制御する。
 * - デッドロック回避のため、サブ枠は startAt 昇順で処理する(4.4節)。
 *
 * メール送信はコミット後に呼び出し元(route)が別途行う(7.1節。DB ロック保持時間に影響させない)。
 */
export async function createReservation(
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  // 30分境界チェック(スキーマの regex では表現しづらいため関数で補う)
  if (!isOn30MinBoundary(input.time)) {
    throw new ValidationError({ time: ["予約時刻は30分刻みで指定してください"] });
  }

  const place = await prisma.place.findUnique({ where: { code: input.place } });
  if (!place) {
    throw new NotFoundError("指定された拠点が見つかりません。");
  }

  const duration = TYPE_DURATION_MINUTES[input.typeId];
  const startMinutes = timeStrToMinutes(input.time);
  const startAt = jstDateStrToInstant(input.date, startMinutes);
  const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

  const now = new Date();

  // --- ステップ0〜3の再検証用データを当日ぶんだけロード ---
  const [businessHours, holiday, closures] = await Promise.all([
    prisma.businessHour.findMany({ where: { placeId: place.id } }),
    prisma.publicHoliday.findUnique({ where: { date: dateStrToDateCol(input.date) } }),
    prisma.closure.findMany({
      where: { placeId: place.id, date: dateStrToDateCol(input.date) },
    }),
  ]);

  const pre: PreloadedJudgeData = {
    now,
    businessHoursByWeekday: new Map(businessHours.map((bh) => [bh.weekday, bh])),
    holidayDates: new Set(holiday ? [input.date] : []),
    closuresByDate: new Map([[input.date, closures]]),
    // ステップ4の枠使用状況はトランザクション内で厳密判定するため、ここでは空(=残数上限)にする。
    slotCounts: new Map(),
  };

  // ステップ0〜3の再検証。ここでの UNAVAILABLE は 409(状態変化 or 不正申告)。
  const judged = judgeCandidate(input.place, input.date, startMinutes, input.typeId, pre);
  if (judged.status === "UNAVAILABLE") {
    throw new SlotUnavailableError(judged.reason);
  }

  const bh = resolveBusinessHour(input.date, pre);
  // judged が UNAVAILABLE でない時点で bh は存在し isOpen=true
  const reservationLimit = bh!.reservationLimit;

  // 占有する30分サブ枠(startAt 昇順)
  const subSlotStarts: Date[] = [];
  for (let m = startMinutes; m < startMinutes + duration; m += SLOT_STEP_MINUTES) {
    subSlotStarts.push(jstDateStrToInstant(input.date, m));
  }
  subSlotStarts.sort((a, b) => a.getTime() - b.getTime());

  // --- トランザクション: 全サブ枠をアトミックに +1 → 予約作成 ---
  const reservation = await prisma.$transaction(
    async (tx) => {
      for (const subStart of subSlotStarts) {
        // 単一SQLでチェックと更新を不可分に行う。新規行は count=1 で挿入、既存行は
        // count < limit のときのみ +1。WHERE を満たさない(満枠)場合は影響行 0。
        const affected = await tx.$executeRaw(Prisma.sql`
          INSERT INTO reservation_slots (place_id, start_at, count, created_at, updated_at)
          VALUES (${place.id}, ${subStart}, 1, now(), now())
          ON CONFLICT (place_id, start_at)
          DO UPDATE SET count = reservation_slots.count + 1, updated_at = now()
          WHERE reservation_slots.count < ${reservationLimit}
        `);
        if (affected === 0) {
          // 満枠。トランザクション全体をロールバックさせる。
          throw new SlotUnavailableError("CAPACITY_FULL");
        }
      }

      return tx.reservation.create({
        data: {
          placeId: place.id,
          typeId: input.typeId,
          durationMinutes: duration,
          startAt,
          endAt,
          name: input.name,
          kana: input.kana,
          tel: input.tel,
          email: input.email,
        },
      });
    },
    { timeout: 10_000 },
  );

  return {
    reservationId: reservation.id,
    place: input.place,
    typeId: input.typeId,
    durationMinutes: duration,
    startAt,
    endAt,
  };
}
