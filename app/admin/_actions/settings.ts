"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, UnauthorizedError } from "@/lib/auth/session";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actionResult";
import { dateStrToDateCol } from "@/lib/reservation/time";
import {
  CreateClosureSchema,
  CreatePublicHolidaySchema,
  UpdateBusinessHourSchema,
  type CreateClosureInput,
  type CreatePublicHolidayInput,
  type UpdateBusinessHourInput,
} from "@/lib/admin/settingsSchemas";

/**
 * 管理画面の設定系 Server Action(api-design.md 5章)。
 *
 * - 基本設定(BusinessHour)の編集: updateBusinessHour(US-008, 5.3 節)
 * - 不定休(Closure)の登録・削除: createClosure / deleteClosure(US-009, 5.4 節)
 * - 祝日(PublicHoliday)の追加・削除: createPublicHoliday / deletePublicHoliday(US-010, 5.5 節)
 */

/** Prisma のユニーク制約違反(P2002)かどうかを判定する。 */
function isUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

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

/**
 * 不定休(Closure)登録(api-design.md 5.4 節)。
 *
 * - 終日休診(isAllDay=true)は時刻系を null にする。
 * - 時間帯休診は開始・終了時刻が必須(CreateClosureSchema の refine で担保)。
 */
export async function createClosure(
  input: CreateClosureInput,
): Promise<ActionResult<{ id: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return actionError("UNAUTHORIZED", e.message);
    throw e;
  }

  const parsed = CreateClosureSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("VALIDATION_ERROR", "入力内容に誤りがあります。", zodFieldErrors(parsed.error));
  }
  const v = parsed.data;

  try {
    const created = await prisma.closure.create({
      data: {
        placeId: v.placeId,
        date: dateStrToDateCol(v.date),
        isAllDay: v.isAllDay,
        startTime: v.isAllDay || !v.startTime ? null : timeStrToTimeCol(v.startTime),
        endTime: v.isAllDay || !v.endTime ? null : timeStrToTimeCol(v.endTime),
      },
    });
    revalidatePath("/admin/slots");
    return actionOk({ id: created.id });
  } catch (e) {
    console.error("[createClosure] failed", { input: v, error: e });
    return actionError("INTERNAL_ERROR", "登録に失敗しました。時間をおいて再度お試しください。");
  }
}

/**
 * 不定休(Closure)削除(api-design.md 5.4 節)。
 *
 * 存在しない ID は NOT_FOUND。削除後は /admin/slots を revalidate する。
 */
export async function deleteClosure(
  input: { closureId: number },
): Promise<ActionResult<{ closureId: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return actionError("UNAUTHORIZED", e.message);
    throw e;
  }

  const { closureId } = input;
  if (!Number.isInteger(closureId) || closureId <= 0) {
    return actionError("VALIDATION_ERROR", "IDが不正です。");
  }

  const existing = await prisma.closure.findUnique({ where: { id: closureId } });
  if (!existing) {
    return actionError("NOT_FOUND", "対象の不定休が見つかりません。");
  }

  try {
    await prisma.closure.delete({ where: { id: closureId } });
    revalidatePath("/admin/slots");
    return actionOk({ closureId });
  } catch (e) {
    console.error("[deleteClosure] failed", { closureId, error: e });
    return actionError("INTERNAL_ERROR", "削除に失敗しました。時間をおいて再度お試しください。");
  }
}

/**
 * 祝日(PublicHoliday)個別追加(api-design.md 5.5 節)。
 *
 * - 祝日マスタは拠点非依存(全拠点共有)。placeId を受け取らない。
 * - date は @unique のため、既に登録済みの日付は VALIDATION_ERROR ではなく
 *   専用コード DUPLICATE_DATE を返す(Prisma のユニーク制約違反 P2002 をハンドリング)。
 * - name は任意。空文字は未指定として null に正規化する。
 * - 登録後は /admin/holidays を revalidate する。
 */
export async function createPublicHoliday(
  input: CreatePublicHolidayInput,
): Promise<ActionResult<{ id: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return actionError("UNAUTHORIZED", e.message);
    throw e;
  }

  const parsed = CreatePublicHolidaySchema.safeParse(input);
  if (!parsed.success) {
    return actionError("VALIDATION_ERROR", "入力内容に誤りがあります。", zodFieldErrors(parsed.error));
  }
  const v = parsed.data;
  const name = v.name && v.name.trim() !== "" ? v.name.trim() : null;

  try {
    const created = await prisma.publicHoliday.create({
      data: {
        date: dateStrToDateCol(v.date),
        name,
      },
    });
    revalidatePath("/admin/holidays");
    return actionOk({ id: created.id });
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return actionError("DUPLICATE_DATE", "指定された日付は既に祝日として登録されています。");
    }
    console.error("[createPublicHoliday] failed", { input: v, error: e });
    return actionError("INTERNAL_ERROR", "登録に失敗しました。時間をおいて再度お試しください。");
  }
}

/**
 * 祝日(PublicHoliday)削除(api-design.md 5.5 節)。
 *
 * 存在しない ID は NOT_FOUND。削除後は /admin/holidays を revalidate する。
 */
export async function deletePublicHoliday(
  input: { holidayId: number },
): Promise<ActionResult<{ holidayId: number }>> {
  try {
    await requireAdminSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return actionError("UNAUTHORIZED", e.message);
    throw e;
  }

  const { holidayId } = input;
  if (!Number.isInteger(holidayId) || holidayId <= 0) {
    return actionError("VALIDATION_ERROR", "IDが不正です。");
  }

  const existing = await prisma.publicHoliday.findUnique({ where: { id: holidayId } });
  if (!existing) {
    return actionError("NOT_FOUND", "対象の祝日が見つかりません。");
  }

  try {
    await prisma.publicHoliday.delete({ where: { id: holidayId } });
    revalidatePath("/admin/holidays");
    return actionOk({ holidayId });
  } catch (e) {
    console.error("[deletePublicHoliday] failed", { holidayId, error: e });
    return actionError("INTERNAL_ERROR", "削除に失敗しました。時間をおいて再度お試しください。");
  }
}
