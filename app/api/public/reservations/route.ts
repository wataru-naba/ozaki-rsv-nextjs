import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, RateLimitError, ValidationError } from "@/lib/api/errors";
import { checkRateLimit, getClientIp } from "@/lib/api/rateLimit";
import { CreateReservationSchema } from "@/lib/reservation/schemas";
import { createReservation } from "@/lib/reservation/createReservation";
import { TYPE_DURATION_MINUTES } from "@/lib/reservation/constants";
import { jstDateStrToInstant, timeStrToMinutes } from "@/lib/reservation/time";
import { sendReservationConfirmation } from "@/lib/mail/sendReservationConfirmation";

/**
 * POST /api/public/reservations
 * 認証不要の公開API(api-design.md 2.3 / 4章)。予約を確定する。
 *
 * 順序(4.2節): Zod検証 → ハニーポット → レート制限 → ステップ0〜3再検証 →
 *              トランザクション(アトミック枠更新+予約作成) → コミット後メール送信。
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);

    // Origin/Referer 簡易チェック(8.3節)。MVP では多層防御の一環としてログのみ(未決事項6)。
    warnIfUntrustedOrigin(req);

    // レート制限(確定系は厳しめ: 5回/分 かつ 30回/時。8.2節)
    const rl = checkRateLimit(`reservation:${ip}`, [
      { limit: 5, windowMs: 60_000 },
      { limit: 30, windowMs: 60 * 60_000 },
    ]);
    if (!rl.ok) {
      throw new RateLimitError(rl.retryAfterSeconds);
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = CreateReservationSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ValidationError.fromZod(parsed.error);
    }
    const input = parsed.data;

    // ハニーポット発火(8.1節): 検知を悟らせないため見かけ上 201 を返しつつ永続化しない
    if (input.hpField && input.hpField.length > 0) {
      console.warn(`[abuse] honeypot triggered ip=${ip} place=${input.place}`);
      return NextResponse.json(buildDecoyResponse(input), { status: 201 });
    }

    const result = await createReservation(input);

    // コミット後にメール送信(7.1節)。失敗しても 201 に影響させない(await するが例外は投げない)。
    await sendReservationConfirmation({
      reservationId: result.reservationId,
      place: result.place,
      name: input.name,
      kana: input.kana,
      tel: input.tel,
      email: input.email,
      startAt: result.startAt,
      endAt: result.endAt,
    });

    return NextResponse.json(
      {
        reservationId: result.reservationId,
        place: result.place,
        typeId: result.typeId,
        durationMinutes: result.durationMinutes,
        startAt: result.startAt.toISOString(),
        endAt: result.endAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

/** ハニーポット発火時のダミー成功レスポンス(実際には永続化していない)。 */
function buildDecoyResponse(input: {
  place: "HYUGA" | "NOBEOKA";
  typeId: number;
  date: string;
  time: string;
}) {
  const duration = TYPE_DURATION_MINUTES[input.typeId];
  const startAt = jstDateStrToInstant(input.date, timeStrToMinutes(input.time));
  const endAt = new Date(startAt.getTime() + duration * 60 * 1000);
  return {
    reservationId: 0,
    place: input.place,
    typeId: input.typeId,
    durationMinutes: duration,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  };
}

/** Origin/Referer が自オリジンと一致しない場合に警告ログを出す(拒否はしない)。 */
function warnIfUntrustedOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // 非ブラウザ(curl等)は Origin 無し → チェック対象外
  const host = req.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost !== host) {
      console.warn(`[abuse] origin mismatch origin=${originHost} host=${host}`);
    }
  } catch {
    console.warn(`[abuse] invalid origin header: ${origin}`);
  }
}
