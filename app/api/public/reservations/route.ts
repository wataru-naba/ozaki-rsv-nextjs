import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { CreateReservationSchema } from "@/lib/reservation/schemas";
import { createReservation } from "@/lib/reservation/createReservation";
import { TYPE_DURATION_MINUTES } from "@/lib/reservation/constants";
import { jstDateStrToInstant, timeStrToMinutes } from "@/lib/reservation/time";
import { sendReservationConfirmation } from "@/lib/mail/sendReservationConfirmation";

/**
 * POST /api/public/reservations
 * 認証不要の公開API(api-design.md 2.3 / 4章)。予約を確定する。
 *
 * 順序(4.2節): Zod検証 → ハニーポット → ステップ0〜3再検証(createReservation 内) →
 *              トランザクション(アトミック枠更新+予約作成) → コミット後メール送信。
 *
 * スコープ外(本 US では持ち込まない):
 * - レート制限(8.2節): インメモリ実装は MVP 専用仮実装のため US-012(外部ストア化)で追加する。
 */
export async function POST(req: NextRequest) {
  try {
    // Origin/Referer 簡易チェック(8.3節)。多層防御の一環としてログのみ(未決事項6)。
    warnIfUntrustedOrigin(req);

    const rawBody = await req.json().catch(() => null);
    const parsed = CreateReservationSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ValidationError.fromZod(parsed.error);
    }
    const input = parsed.data;

    // ハニーポット発火(8.1節): 検知を悟らせないため見かけ上 201 を返しつつ永続化しない。
    if (input.hpField && input.hpField.length > 0) {
      console.warn(`[abuse] honeypot triggered place=${input.place}`);
      return NextResponse.json(buildDecoyResponse(input), { status: 201 });
    }

    const result = await createReservation(input);

    // 予約確認メール送信(US-004 / 7章)。createReservation の $transaction は
    // 既にコミット済みで、ここはトランザクションの **外** にあたる(DB ロック保持時間に影響しない)。
    // 送信サービスは失敗しても throw しない契約だが、想定外の例外でも予約結果(201)を
    // 損なわないよう防御的に握りつぶす(7.2節: メール失敗を予約失敗にしない)。
    await sendReservationConfirmation({
      reservationId: result.reservationId,
      place: result.place,
      name: input.name,
      kana: input.kana,
      tel: input.tel,
      email: input.email,
      startAt: result.startAt,
      endAt: result.endAt,
    }).catch((err) => {
      console.error(
        `[mail] 予約確認メール呼び出しで想定外エラー reservationId=${result.reservationId}:`,
        err instanceof Error ? err.message : err,
      );
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
