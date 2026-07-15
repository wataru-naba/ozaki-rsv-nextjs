import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, RateLimitError, ValidationError } from "@/lib/api/errors";
import { checkRateLimit, getClientIp } from "@/lib/api/rateLimit";
import { AvailabilityQuerySchema } from "@/lib/reservation/schemas";
import { getAvailability } from "@/lib/reservation/availability";

/**
 * GET /api/public/availability
 * 認証不要の公開API(api-design.md 2.2節)。指定拠点・種別の空き状況(当日〜21日先)を返す。
 */
export async function GET(req: NextRequest) {
  try {
    // レート制限(参照系は緩め: 60回/分。8.2節)
    const ip = getClientIp(req);
    const rl = checkRateLimit(`availability:${ip}`, [{ limit: 60, windowMs: 60_000 }]);
    if (!rl.ok) {
      throw new RateLimitError(rl.retryAfterSeconds);
    }

    const { searchParams } = new URL(req.url);
    const parsed = AvailabilityQuerySchema.safeParse({
      place: searchParams.get("place") ?? undefined,
      typeId: searchParams.get("typeId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
    });
    if (!parsed.success) {
      throw ValidationError.fromZod(parsed.error);
    }

    const data = await getAvailability(parsed.data);
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
