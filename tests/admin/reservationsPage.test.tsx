// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { jstDateStrToInstant } from "@/lib/reservation/time";
import { TYPE_OPTIONS } from "@/lib/reservation/publicTypes";

/**
 * US-006 受け入れ条件(予約一覧):
 * - 拠点・日付を指定すると、その日の予約が予約時間・氏名・種別・所要時間・メール・電話とともに表示される。
 * - 種別(typeId)はアプリ定数由来のラベルで表示される(DB自由文字列に依存しない)。
 * - 前日/翌日/今日移動用の日付がフィルタへ正しく渡る。
 * - 予約0件の日は空状態を表示する。
 * - 認証ガード: 未認証(requireAdminSession が throw)ならデータ取得へ進まない。
 *
 * Server Component を Prisma / セッションをモックした状態で await 実行し、
 * 返される JSX をレンダリングして検証する。
 */

const requireAdminSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const placeFindMany = vi.fn();
const reservationFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    place: { findMany: (...a: unknown[]) => placeFindMany(...a) },
    reservation: { findMany: (...a: unknown[]) => reservationFindMany(...a) },
  },
}));

// フィルタは client component。ここでは受け取った props を data 属性で覗く。
type FilterProps = {
  placeCode: string;
  date: string;
  prevDate: string;
  nextDate: string;
  todayDate: string;
};
vi.mock("@/app/admin/(dashboard)/reservations/ReservationFilters", () => ({
  ReservationFilters: (p: FilterProps) => (
    <div
      data-testid="filters"
      data-place={p.placeCode}
      data-date={p.date}
      data-prev={p.prevDate}
      data-next={p.nextDate}
      data-today={p.todayDate}
    />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

import ReservationsPage from "@/app/admin/(dashboard)/reservations/page";

const PLACES = [
  { id: 1, code: "HYUGA", name: "日向" },
  { id: 2, code: "NOBEOKA", name: "延岡" },
];

function reservationRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    placeId: 2,
    typeId: 0,
    durationMinutes: 90,
    // 2026-07-15 10:00 JST 開始 / 11:30 終了
    startAt: jstDateStrToInstant("2026-07-15", 10 * 60),
    endAt: jstDateStrToInstant("2026-07-15", 11 * 60 + 30),
    name: "尾崎 太郎",
    kana: "オザキ タロウ",
    tel: "09012345678",
    email: "taro@example.com",
    ...over,
  };
}

async function renderPage(params: Record<string, string>) {
  const ui = await ReservationsPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

beforeEach(() => {
  requireAdminSession.mockReset().mockResolvedValue({ id: "u1", username: "staff" });
  placeFindMany.mockReset().mockResolvedValue(PLACES);
  reservationFindMany.mockReset().mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("ReservationsPage: 対象日(拠点別)の範囲検索", () => {
  it("指定拠点・指定日の [00:00, 翌00:00) 範囲で startAt を検索する", async () => {
    reservationFindMany.mockResolvedValue([reservationRow()]);
    await renderPage({ place: "NOBEOKA", date: "2026-07-15" });

    expect(reservationFindMany).toHaveBeenCalledTimes(1);
    const arg = reservationFindMany.mock.calls[0][0] as {
      where: { placeId: number; startAt: { gte: Date; lt: Date } };
      orderBy: { startAt: "asc" };
    };
    expect(arg.where.placeId).toBe(2); // NOBEOKA
    expect(arg.where.startAt.gte.getTime()).toBe(
      jstDateStrToInstant("2026-07-15", 0).getTime(),
    );
    expect(arg.where.startAt.lt.getTime()).toBe(
      jstDateStrToInstant("2026-07-15", 24 * 60).getTime(),
    );
    expect(arg.orderBy).toEqual({ startAt: "asc" });
  });

  it("予約が予約時間・氏名・所要時間・メール・電話とともに表示される", async () => {
    reservationFindMany.mockResolvedValue([reservationRow()]);
    await renderPage({ place: "NOBEOKA", date: "2026-07-15" });

    expect(screen.getByText("尾崎 太郎")).toBeInTheDocument();
    expect(screen.getByText("10:00–11:30")).toBeInTheDocument();
    expect(screen.getByText("90分")).toBeInTheDocument();
    expect(screen.getByText("taro@example.com")).toBeInTheDocument();
    expect(screen.getByText("09012345678")).toBeInTheDocument();
  });

  it("複数予約が startAt 昇順取得の順で全件描画される", async () => {
    reservationFindMany.mockResolvedValue([
      reservationRow({ id: 1, name: "朝一 花子", startAt: jstDateStrToInstant("2026-07-15", 9 * 60) }),
      reservationRow({ id: 2, name: "午後 次郎", startAt: jstDateStrToInstant("2026-07-15", 14 * 60) }),
    ]);
    await renderPage({ place: "NOBEOKA", date: "2026-07-15" });

    const rows = screen.getAllByRole("row").filter((r) => within(r).queryByText(/花子|次郎/));
    expect(rows).toHaveLength(2);
    expect(screen.getByText("朝一 花子")).toBeInTheDocument();
    expect(screen.getByText("午後 次郎")).toBeInTheDocument();
  });
});

describe("ReservationsPage: 種別ラベルはアプリ定数から導出", () => {
  it("typeId から TYPE_OPTIONS のラベルを表示する(DB 送信値に依存しない)", async () => {
    reservationFindMany.mockResolvedValue([reservationRow({ typeId: 2 })]);
    await renderPage({ place: "NOBEOKA", date: "2026-07-15" });

    const expected = TYPE_OPTIONS.find((t) => t.typeId === 2)!.label;
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe("ReservationsPage: 前日/翌日/今日移動の日付がフィルタへ渡る", () => {
  it("prevDate/nextDate/todayDate が正しく算出されてフィルタに渡る", async () => {
    vi.useFakeTimers();
    // JST 2026-07-21 12:00 を「今日」とする(UTC では 03:00)
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));
    try {
      await renderPage({ place: "HYUGA", date: "2026-07-15" });
    } finally {
      vi.useRealTimers();
    }

    const filters = screen.getByTestId("filters");
    expect(filters.getAttribute("data-place")).toBe("HYUGA");
    expect(filters.getAttribute("data-date")).toBe("2026-07-15");
    expect(filters.getAttribute("data-prev")).toBe("2026-07-14");
    expect(filters.getAttribute("data-next")).toBe("2026-07-16");
    expect(filters.getAttribute("data-today")).toBe("2026-07-21");
  });
});

describe("ReservationsPage: 拠点・日付の解決(不正/未指定)", () => {
  it("不正な拠点コードは先頭拠点(HYUGA)へフォールバックする", async () => {
    await renderPage({ place: "UNKNOWN", date: "2026-07-15" });
    const arg = reservationFindMany.mock.calls[0][0] as { where: { placeId: number } };
    expect(arg.where.placeId).toBe(1); // 先頭拠点
    expect(screen.getByTestId("filters").getAttribute("data-place")).toBe("HYUGA");
  });

  it("不正な日付は JST 当日へフォールバックする", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));
    try {
      await renderPage({ place: "HYUGA", date: "not-a-date" });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId("filters").getAttribute("data-date")).toBe("2026-07-21");
  });
});

describe("ReservationsPage: 空状態(予約0件)", () => {
  it("予約が無い日は『この日の予約はありません。』を表示し、テーブルを描画しない", async () => {
    reservationFindMany.mockResolvedValue([]);
    await renderPage({ place: "NOBEOKA", date: "2026-07-15" });

    expect(screen.getByText("この日の予約はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/延岡 \/ 2026-07-15/)).toBeInTheDocument();
  });
});

describe("ReservationsPage: 認証ガード", () => {
  it("未認証(requireAdminSession が throw)ならデータ取得へ進まない", async () => {
    requireAdminSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(
      ReservationsPage({ searchParams: Promise.resolve({ place: "HYUGA", date: "2026-07-15" }) }),
    ).rejects.toThrow();

    expect(reservationFindMany).not.toHaveBeenCalled();
  });
});
