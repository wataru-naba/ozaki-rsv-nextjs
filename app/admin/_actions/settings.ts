"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, UnauthorizedError } from "@/lib/auth/session";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actionResult";
import {
  UpdateBusinessHourSchema,
  type UpdateBusinessHourInput,
} from "@/lib/admin/settingsSchemas";

/**
 * 管理画面の設定系 Server Action(api-design.md 5章)。
 *
 * 本 US(US-008)では基本設定(BusinessHour)の編集のみを実装する。
 * 不定休(Closure)登録・削除の Server Action は US-009 が本ファイルへ追記する前提。
 */

/** "HH:MM" を @db.Time 用の Date(1970-01-01 UTC の時刻)に変換する。 */
function timeStrToTimeCol(time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, 0));
}

/** ZodError をフィールド別マップへ整形する。 */
function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * 基本設定(BusinessHour)編集(api-design.md 5.3 節)。
 *
 * - 既存行の更新のみ(初期化=全削除→再投入は MVP 対象外)。@@unique([placeId, weekday]) を
 *   キーに upsert し、データ不整合で行が無い場合も復旧可能にする(重複行が生まれない)。
 * - 営業時間の外枠 9:00-18:30 は UpdateBusinessHourSchema の refine で入力時にも強制する。
 * - 休診(isOpen=false)に変更した場合は時刻系を null に正規化する。
 */
export async function updateBusinessHour(
  input: UpdateBusinessHourInput,
): Promise<ActionResult<{ id: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return actionError("UNAUTHORIZED", e.message);
    throw e;
  }

  const parsed = UpdateBusinessHourSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("VALIDATION_ERROR", "入力内容に誤りがあります。", zodFieldErrors(parsed.error));
  }
  const v = parsed.data;

  // 休診日は時刻系を null に正規化する。
  const openTime = v.isOpen && v.openTime ? timeStrToTimeCol(v.openTime) : null;
  const closeTime = v.isOpen && v.closeTime ? timeStrToTimeCol(v.closeTime) : null;
  const breakStart = v.isOpen && v.breakStart ? timeStrToTimeCol(v.breakStart) : null;
  const breakEnd = v.isOpen && v.breakEnd ? timeStrToTimeCol(v.breakEnd) : null;

  try {
    const saved = await prisma.businessHour.upsert({
      where: { placeId_weekday: { placeId: v.placeId, weekday: v.weekday } },
      update: {
        isOpen: v.isOpen,
        openTime,
        closeTime,
        breakStart,
        breakEnd,
        reservationLimit: v.reservationLimit,
      },
      create: {
        placeId: v.placeId,
        weekday: v.weekday,
        isOpen: v.isOpen,
        openTime,
        closeTime,
        breakStart,
        breakEnd,
        reservationLimit: v.reservationLimit,
      },
    });
    revalidatePath("/admin/slots");
    return actionOk({ id: saved.id });
  } catch (e) {
    console.error("[updateBusinessHour] failed", { input: v, error: e });
    return actionError("INTERNAL_ERROR", "保存に失敗しました。時間をおいて再度お試しください。");
  }
}
