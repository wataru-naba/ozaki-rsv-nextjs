// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { jstDateStrToInstant, formatJstDateTime } from "@/lib/reservation/time";
import { reservationTypeLabel } from "@/lib/admin/labels";

/**
 * US-007 受け入れ条件(予約詳細の確認):
 * - 予約ID・拠点・日時・種別(ラベル導出)・氏名・カナ・Email・TEL・申込日時が表示される。
 * - 存在しない予約ID(数値でない/0以下/DB に無い)は notFound() 相当になる。
 * - 認証ガード: 未認証(requireAdminSession が throw)ならデータ取得へ進まない。
 *
 * Server Component を Prisma / セッション / notFound をモックした状態で await 実行し、
 * 返される JSX をレンダリングして検証する。
 */

const requireAdminSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const reservationFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reservation: { findUnique: (...a: unknown[]) => reservationFindUnique(...a) },
  },
}));

// notFound() は特有の例外を throw して以降のレンダリングを止める(Next.js 実挙動を模す)。
class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}
const notFound = vi.fn(() => {
  throw new NotFoundSignal();
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

// キャンセルボタンは client component(server action を import する)。詳細表示テストでは
// props だけを覗くスタブに差し替える。
vi.mock("@/app/admin/(dashboard)/reservations/[id]/CancelReservationButton", () => ({
  CancelReservationButton: (p: { reservationId: number; backHref: string }) => (
    <div data-testid="cancel-button" data-id={p.reservationId} data-back={p.backHref} />
  ),
}));

import ReservationDetailPage from "@/app/admin/(dashboard)/reservations/[id]/page";

const DATE = "2026-07-15";

function reservation(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 42,
    placeId: 2,
    typeId: 0,
    durationMinutes: 90,
    startAt: jstDateStrToInstant(DATE, 10 * 60), // 10:00
    endAt: jstDateStrToInstant(DATE, 11 * 60 + 30), // 11:30
    name: "尾崎 太郎",
    kana: "オザキ タロウ",
    tel: "09012345678",
    email: "taro@example.com",
    createdAt: jstDateStrToInstant(DATE, 9 * 60), // 申込 09:00
    place: { id: 2, code: "NOBEOKA", name: "延岡" },
    ...over,
  };
}

async function renderPage(id: string) {
  const ui = await ReservationDetailPage({ params: Promise.resolve({ id }) });
  return render(ui);
}

beforeEach(() => {
  requireAdminSession.mockReset().mockResolvedValue({ id: "u1", username: "staff" });
  reservationFindUnique.mockReset().mockResolvedValue(null);
  notFound.mockClear();
});
afterEach(() => cleanup());

describe("ReservationDetailPage — 予約詳細の表示", () => {
  it("予約ID・拠点・種別・氏名・カナ・Email・TEL が正しく表示される", async () => {
    reservationFindUnique.mockResolvedValue(reservation());
    await renderPage("42");

    // findUnique は id 指定 + place を include。
    const arg = reservationFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: { place: boolean };
    };
    expect(arg.where.id).toBe(42);
    expect(arg.include.place).toBe(true);

    expect(screen.getByText("42")).toBeInTheDocument(); // 予約ID
    expect(screen.getByText("延岡")).toBeInTheDocument(); // 拠点
    expect(screen.getByText("尾崎 太郎")).toBeInTheDocument(); // 氏名
    expect(screen.getByText("オザキ タロウ")).toBeInTheDocument(); // カナ
    expect(screen.getByText("taro@example.com")).toBeInTheDocument(); // Email
    expect(screen.getByText("09012345678")).toBeInTheDocument(); // TEL
  });

  it("種別は typeId から導出したラベル(+所要時間)で表示される", async () => {
    reservationFindUnique.mockResolvedValue(reservation({ typeId: 0, durationMinutes: 90 }));
    await renderPage("42");

    const label = reservationTypeLabel(0);
    expect(screen.getByText(`${label}（約90分）`)).toBeInTheDocument();
  });

  it("予約日時・申込日時が JST 表記で表示される", async () => {
    const r = reservation();
    reservationFindUnique.mockResolvedValue(r);
    await renderPage("42");

    // 予約日時: "<開始 JST> 〜 <終了 HH:MM>"
    expect(
      screen.getByText(`${formatJstDateTime(r.startAt)} 〜 11:30`),
    ).toBeInTheDocument();
    // 申込日時
    expect(screen.getByText(formatJstDateTime(r.createdAt))).toBeInTheDocument();
  });

  it("キャンセルボタンへ reservationId と 一覧へ戻る href が渡る", async () => {
    reservationFindUnique.mockResolvedValue(reservation({ id: 42 }));
    await renderPage("42");

    const btn = screen.getByTestId("cancel-button");
    expect(btn.getAttribute("data-id")).toBe("42");
    // 一覧へ戻る href は拠点・当日を復元する。
    expect(btn.getAttribute("data-back")).toBe(
      `/admin/reservations?place=NOBEOKA&date=${DATE}`,
    );
  });
});

describe("ReservationDetailPage — 存在しない予約(NotFound 相当)", () => {
  it("DB に存在しない予約IDは notFound() を呼ぶ", async () => {
    reservationFindUnique.mockResolvedValue(null);

    await expect(renderPage("999")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(notFound).toHaveBeenCalled();
  });

  it("数値でない ID は DB を引かずに notFound() を呼ぶ", async () => {
    await expect(renderPage("abc")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(notFound).toHaveBeenCalled();
    expect(reservationFindUnique).not.toHaveBeenCalled();
  });

  it("0 以下の ID は DB を引かずに notFound() を呼ぶ", async () => {
    await expect(renderPage("0")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(reservationFindUnique).not.toHaveBeenCalled();
  });
});

describe("ReservationDetailPage — 認証ガード", () => {
  it("未認証(requireAdminSession が throw)ならデータ取得へ進まない", async () => {
    requireAdminSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(renderPage("42")).rejects.toThrow();
    expect(reservationFindUnique).not.toHaveBeenCalled();
  });
});
