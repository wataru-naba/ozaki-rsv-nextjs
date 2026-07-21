// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * 予約枠管理ページ(/admin/slots)の Server Component テスト。
 *
 * 検証:
 * - AdminHeader の「予約枠管理」リンク先(/admin/slots)がページとして機能する。
 * - 拠点ごとに全曜日区分(DB 未登録は休診行で補完)を BusinessHourEditor へ渡す(US-008)。
 * - 拠点セレクタで拠点を切り替えられる。
 * - 認証ガード: 未認証ならデータ取得へ進まない。
 * - 不定休(Closure)セクションを表示し、拠点別・日付昇順で ClosureManager へ渡す(US-009)。
 */

const requireAdminSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const placeFindMany = vi.fn();
const businessHourFindMany = vi.fn();
const closureFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    place: { findMany: (...a: unknown[]) => placeFindMany(...a) },
    businessHour: { findMany: (...a: unknown[]) => businessHourFindMany(...a) },
    closure: { findMany: (...a: unknown[]) => closureFindMany(...a) },
  },
}));

// BusinessHourEditor は client component。受け取った rows を data 属性で覗く。
type EditorProps = { placeId: number; rows: Array<{ weekday: string; isOpen: boolean; reservationLimit: number }> };
vi.mock("@/app/admin/(dashboard)/slots/BusinessHourEditor", () => ({
  BusinessHourEditor: (p: EditorProps) => (
    <div
      data-testid="bh-editor"
      data-place-id={p.placeId}
      data-weekdays={p.rows.map((r) => r.weekday).join(",")}
      data-open-flags={p.rows.map((r) => (r.isOpen ? "1" : "0")).join(",")}
    />
  ),
}));

// ClosureManager も client component。受け取った closures を data 属性で覗く。
type ClosureManagerProps = {
  placeId: number;
  closures: Array<{ id: number; date: string; isAllDay: boolean }>;
};
vi.mock("@/app/admin/(dashboard)/slots/ClosureManager", () => ({
  ClosureManager: (p: ClosureManagerProps) => (
    <div
      data-testid="closure-manager"
      data-place-id={p.placeId}
      data-dates={p.closures.map((c) => c.date).join(",")}
      data-allday-flags={p.closures.map((c) => (c.isAllDay ? "1" : "0")).join(",")}
    />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

import SlotsPage from "@/app/admin/(dashboard)/slots/page";

const PLACES = [
  { id: 1, code: "HYUGA", name: "日向" },
  { id: 2, code: "NOBEOKA", name: "延岡" },
];

/** @db.Time 用の Date(1970-01-01 UTC の時刻)。 */
function timeCol(h: number, m: number): Date {
  return new Date(Date.UTC(1970, 0, 1, h, m, 0));
}

/** @db.Date 用の Date(UTC 0時)。 */
function dateCol(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

async function renderPage(params: Record<string, string>) {
  const ui = await SlotsPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

beforeEach(() => {
  requireAdminSession.mockReset().mockResolvedValue({ id: "u1", username: "staff" });
  placeFindMany.mockReset().mockResolvedValue(PLACES);
  businessHourFindMany.mockReset().mockResolvedValue([]);
  closureFindMany.mockReset().mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("SlotsPage: 基本設定(営業時間)の表示", () => {
  it("見出し『予約枠管理』と基本設定セクションを表示する", async () => {
    await renderPage({ place: "HYUGA" });
    expect(screen.getByRole("heading", { name: "予約枠管理" })).toBeInTheDocument();
    expect(screen.getByText(/基本設定/)).toBeInTheDocument();
    expect(screen.getByTestId("bh-editor")).toBeInTheDocument();
  });

  it("指定拠点の businessHour を取得し、選択拠点の id を Editor へ渡す", async () => {
    await renderPage({ place: "NOBEOKA" });
    expect(businessHourFindMany).toHaveBeenCalledWith({ where: { placeId: 2 } });
    expect(screen.getByTestId("bh-editor").getAttribute("data-place-id")).toBe("2");
  });

  it("全曜日区分(固定順)を Editor へ渡す。DB 未登録の区分は休診(isOpen=false)で補完する", async () => {
    businessHourFindMany.mockResolvedValue([
      { weekday: "MONDAY", isOpen: true, openTime: timeCol(9, 0), closeTime: timeCol(18, 30), breakStart: null, breakEnd: null, reservationLimit: 2 },
    ]);
    await renderPage({ place: "HYUGA" });
    const editor = screen.getByTestId("bh-editor");
    expect(editor.getAttribute("data-weekdays")).toBe(
      "SUNDAY,MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY,PUBLIC_HOLIDAY",
    );
    // MONDAY のみ営業(1)、他は補完された休診(0)。
    expect(editor.getAttribute("data-open-flags")).toBe("0,1,0,0,0,0,0,0");
  });

  it("不正/未指定の拠点は先頭拠点(HYUGA)へフォールバックする", async () => {
    await renderPage({ place: "UNKNOWN" });
    expect(businessHourFindMany).toHaveBeenCalledWith({ where: { placeId: 1 } });
  });

  it("拠点セレクタに全拠点のリンクが表示される", async () => {
    await renderPage({ place: "HYUGA" });
    expect(screen.getByRole("link", { name: "日向" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "延岡" })).toBeInTheDocument();
  });
});

describe("SlotsPage: 不定休(Closure)の表示(US-009)", () => {
  it("不定休セクションの見出しと ClosureManager を表示する", async () => {
    await renderPage({ place: "HYUGA" });
    expect(screen.getByText(/不定休/)).toBeInTheDocument();
    expect(screen.getByTestId("closure-manager")).toBeInTheDocument();
  });

  it("選択拠点の closure を日付昇順で取得し、選択拠点の id を ClosureManager へ渡す", async () => {
    await renderPage({ place: "NOBEOKA" });
    expect(closureFindMany).toHaveBeenCalledWith({
      where: { placeId: 2 },
      orderBy: { date: "asc" },
    });
    expect(screen.getByTestId("closure-manager").getAttribute("data-place-id")).toBe("2");
  });

  it("取得した不定休を日付・終日フラグとともに ClosureManager へ渡す", async () => {
    closureFindMany.mockResolvedValue([
      { id: 1, date: dateCol("2026-08-01"), isAllDay: true, startTime: null, endTime: null },
      { id: 2, date: dateCol("2026-08-05"), isAllDay: false, startTime: timeCol(10, 0), endTime: timeCol(12, 0) },
    ]);
    await renderPage({ place: "HYUGA" });
    const cm = screen.getByTestId("closure-manager");
    expect(cm.getAttribute("data-dates")).toBe("2026-08-01,2026-08-05");
    expect(cm.getAttribute("data-allday-flags")).toBe("1,0");
  });

  it("不定休が無い場合も ClosureManager を空リストで表示する", async () => {
    closureFindMany.mockResolvedValue([]);
    await renderPage({ place: "HYUGA" });
    const cm = screen.getByTestId("closure-manager");
    expect(cm.getAttribute("data-dates")).toBe("");
  });
});

describe("SlotsPage: 認証ガード", () => {
  it("未認証(requireAdminSession が throw)ならデータ取得へ進まない", async () => {
    requireAdminSession.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(SlotsPage({ searchParams: Promise.resolve({ place: "HYUGA" }) })).rejects.toThrow();
    expect(businessHourFindMany).not.toHaveBeenCalled();
  });
});
