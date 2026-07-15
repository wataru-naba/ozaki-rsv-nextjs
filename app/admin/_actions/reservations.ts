"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, UnauthorizedError } from "@/lib/auth/session";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actionResult";
import { SLOT_STEP_MINUTES } from "@/lib/reservation/constants";

/**
 * 予約キャンセル(api-design.md 5.2 節)。
 *
 * 1. セッション検証(6章)。
 * 2. Reservation を取得。無ければ NOT_FOUND。
 * 3. トランザクション内で占有サブ枠を startAt 昇順で `count-1 WHERE count > 0`(5.2/4.4節)。
 *    影響行数0(count がすでに0という理論上の不整合)でも中断せず警告ログを出して継続する。
 * 4. Reservation を削除。
 * 5. revalidatePath で一覧・詳細を再検証。
 */
export async function cancelReservation(input: {
  reservationId: number;
}): Promise<ActionResult<{ reservationId: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return actionError("UNAUTHORIZED", e.message);
    }
    throw e;
  }

  const { reservationId } = input;
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return actionError("VALIDATION_ERROR", "予約IDが不正です。");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!reservation) {
    return actionError("NOT_FOUND", "対象の予約が見つかりません。");
  }

  // 占有していた30分サブ枠を startAt/endAt から再計算(startAt 昇順)。
  const subSlotStarts: Date[] = [];
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  for (let t = reservation.startAt.getTime(); t < reservation.endAt.getTime(); t += stepMs) {
    subSlotStarts.push(new Date(t));
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const subStart of subSlotStarts) {
          const affected = await tx.$executeRaw(Prisma.sql`
            UPDATE reservation_slots
            SET count = count - 1, updated_at = now()
            WHERE place_id = ${reservation.placeId}
              AND start_at = ${subStart}
              AND count > 0
          `);
          if (affected === 0) {
            // 理論上の不整合(count が既に 0)。中断せず可観測にする(5.2節の設計方針)。
            console.warn(
              "[cancelReservation] slot count already 0 or missing (skipped)",
              {
                reservationId: reservation.id,
                placeId: reservation.placeId,
                startAt: subStart.toISOString(),
              },
            );
          }
        }
        await tx.reservation.delete({ where: { id: reservation.id } });
      },
      { timeout: 10_000 },
    );
  } catch (e) {
    console.error("[cancelReservation] transaction failed", {
      reservationId: reservation.id,
      error: e,
    });
    return actionError("INTERNAL_ERROR", "キャンセル処理に失敗しました。時間をおいて再度お試しください。");
  }

  revalidatePath("/admin/reservations");
  revalidatePath(`/admin/reservations/${reservation.id}`);

  return actionOk({ reservationId: reservation.id });
}
