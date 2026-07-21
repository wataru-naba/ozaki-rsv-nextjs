import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { AvailabilityQuerySchema } from "@/lib/reservation/schemas";
import { getAvailability } from "@/lib/reservation/availability";

/**
 * GET /api/public/availability
 * 認証不要の公開API(api-design.md 2.2節)。指定拠点・種別の空き状況(当日〜21日先)を返す。
 *
 * NOTE (US-002 スコープ): レート制限は US-012(外部ストア化)の担当範囲。
 * ADR 0001 の決定どおり Sprint 1 では MVP のインメモリ実装(lib/api/rateLimit.ts)を
 * main に持ち込まない。公開参照系のレート制限は US-012 で共通アダプタとして導入する。
 */
export async function GET(req: NextRequest) {
  try {
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
