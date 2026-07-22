// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * 祝日管理ページ(/admin/holidays)の Server Component テスト(US-010)。
 *
 * 検証:
 * - AdminHeader の「祝日管理」リンク先(/admin/holidays)がページとして機能する。
 * - 祝日を日付昇順(orderBy: { date: "asc" })で取得し HolidayManager へ渡す。
 * - 拠点非依存(全拠点共有): 拠点セレクタ(拠点リンク)が存在しないこと。
 *   Prisma へも placeId を含む where を渡さないこと(拠点で絞り込まない)。
 * - 認証ガード: 未認証ならデータ取得へ進まない。
 */

const requireAdminSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const holidayFindMany = vi.fn();
const placeFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicHoliday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    // 拠点非依存の確認用。ページが誤って place を引かないことを検証する。
    place: { findMany: (...a: unknown[]) => placeFindMany(...a) },
  },
}));

// HolidayManager は client component。受け取った holidays を data 属性で覗く。
type HolidayManagerProps = {
  holidays: Array<{ id: number; date: string; name: string }>;
};
vi.mock("@/app/admin/(dashboard)/holidays/HolidayManager", () => ({
  HolidayManager: (p: HolidayManagerProps) => (
    <div
      data-testid="holiday-manager"
      data-dates={p.holidays.map((h) => h.date).join(",")}
      data-names={p.holidays.map((h) => h.name).join(",")}
      data-ids={p.holidays.map((h) => h.id).join(",")}
    />
  ),
}));

import HolidaysPage from "@/app/admin/(dashboard)/holidays/page";

/** @db.Date 用の Date(UTC 0時)。 */
function dateCol(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

async function renderPage() {
  const ui = await HolidaysPage();
  return render(ui);
}

beforeEach(() => {
  requireAdminSession.mockReset().mockResolvedValue({ id: "u1", username: "staff" });
  holidayFindMany.mockReset().mockResolvedValue([]);
  placeFindMany.mockReset().mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("HolidaysPage: 表示", () => {
  it("見出し『祝日管理』と HolidayManager を表示する", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "祝日管理" })).toBeInTheDocument();
    expect(screen.getByTestId("holiday-manager")).toBeInTheDocument();
  });

  it("祝日を日付昇順で取得して HolidayManager へ渡す", async () => {
    holidayFindMany.mockResolvedValue([
      { id: 1, date: dateCol("2027-01-01"), name: "元日" },
      { id: 2, date: dateCol("2027-02-11"), name: null },
      { id: 3, date: dateCol("2027-05-03"), name: "憲法記念日" },
    ]);
    await renderPage();

    expect(holidayFindMany).toHaveBeenCalledWith({ orderBy: { date: "asc" } });
    const hm = screen.getByTestId("holiday-manager");
    expect(hm.getAttribute("data-dates")).toBe("2027-01-01,2027-02-11,2027-05-03");
    // name が null の祝日は "" として渡される。
    expect(hm.getAttribute("data-names")).toBe("元日,,憲法記念日");
    expect(hm.getAttribute("data-ids")).toBe("1,2,3");
  });

  it("祝日が無い場合も HolidayManager を空リストで表示する", async () => {
    holidayFindMany.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByTestId("holiday-manager").getAttribute("data-dates")).toBe("");
  });
});

describe("HolidaysPage: 拠点非依存(全拠点共有)", () => {
  it("拠点セレクタ(拠点リンク)を表示しない", async () => {
    await renderPage();
    // 拠点切り替え用のリンクが一切存在しないこと。
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("祝日取得の where に placeId を含めない(拠点で絞り込まない)", async () => {
    await renderPage();
    const arg = holidayFindMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("where");
  });

  it("拠点マスタ(place)を参照しない", async () => {
    await renderPage();
    expect(placeFindMany).not.toHaveBeenCalled();
  });
});

describe("HolidaysPage: 認証ガード", () => {
  it("未認証(requireAdminSession が throw)ならデータ取得へ進まない", async () => {
    requireAdminSession.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(HolidaysPage()).rejects.toThrow();
    expect(holidayFindMany).not.toHaveBeenCalled();
  });
});
