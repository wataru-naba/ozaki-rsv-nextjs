import { beforeEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * US-003 予約確定 API(POST /api/public/reservations)のルートテスト。
 *
 * createReservation はロジック側のテスト(createReservation.test.ts)で網羅するため、
 * ここではモックし、ルートの責務(検証 → ハニーポット → 呼び出し → ステータス整形)を検証する:
 * - 正常系: 201 と正しい JSON。
 * - ハニーポット: 見かけ上 201 を返しつつ永続化(createReservation)を呼ばない(サイレントドロップ)。
 * - バリデーションエラー: 400。
 * - 枠確保失敗(SLOT_UNAVAILABLE): 409。
 */

const createReservationMock = vi.fn();
vi.mock("@/lib/reservation/createReservation", () => ({
  createReservation: (...a: unknown[]) => createReservationMock(...a),
}));

// US-004: メール送信はコミット後・トランザクション外で呼ばれる。ロジックは
// sendReservationConfirmation.test.ts で網羅するため、ここではモックし
// 「呼ばれ方(引数・回数)」と「失敗してもレスポンスに影響しないこと」を検証する。
const sendReservationConfirmationMock = vi.fn();
vi.mock("@/lib/mail/sendReservationConfirmation", () => ({
  sendReservationConfirmation: (...a: unknown[]) =>
    sendReservationConfirmationMock(...a),
}));

import { POST } from "@/app/api/public/reservations/route";
import { SlotUnavailableError, ValidationError } from "@/lib/api/errors";

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as NextRequest;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    place: "NOBEOKA",
    typeId: 2,
    date: "2030-06-03",
    time: "10:00",
    name: "尾崎 太郎",
    kana: "オザキタロウ",
    tel: "09012345678",
    email: "taro@example.com",
    privacyAgreed: true,
    hpField: "",
    ...overrides,
  };
}

const okResult = {
  reservationId: 42,
  place: "NOBEOKA" as const,
  typeId: 2,
  durationMinutes: 30,
  startAt: new Date("2030-06-03T01:00:00.000Z"),
  endAt: new Date("2030-06-03T01:30:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // 既定はメール送信成功。個別テストで上書きする。
  sendReservationConfirmationMock.mockResolvedValue({ success: true });
});

describe("POST /api/public/reservations", () => {
  it("正常系: 有効なリクエストで 201 と予約情報(ISO文字列)を返す", async () => {
    createReservationMock.mockResolvedValueOnce(okResult);

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json).toMatchObject({
      reservationId: 42,
      place: "NOBEOKA",
      typeId: 2,
      durationMinutes: 30,
      startAt: "2030-06-03T01:00:00.000Z",
      endAt: "2030-06-03T01:30:00.000Z",
    });
    expect(createReservationMock).toHaveBeenCalledTimes(1);
  });

  it("予約確定成功後にメール送信関数が正しい引数で 1 回だけ呼ばれる(US-004)", async () => {
    createReservationMock.mockResolvedValueOnce(okResult);

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(201);

    // トランザクション(createReservation)完了後に 1 回だけ呼ばれる
    expect(sendReservationConfirmationMock).toHaveBeenCalledTimes(1);
    // 予約結果(result)+ 申込者情報(input)から組んだ引数が渡る
    expect(sendReservationConfirmationMock).toHaveBeenCalledWith({
      reservationId: 42,
      place: "NOBEOKA",
      name: "尾崎 太郎",
      kana: "オザキタロウ",
      tel: "09012345678",
      email: "taro@example.com",
      startAt: okResult.startAt,
      endAt: okResult.endAt,
    });
  });

  it("メール送信が失敗(reject)しても予約レスポンスは 201 のまま(7.2節)", async () => {
    createReservationMock.mockResolvedValueOnce(okResult);
    sendReservationConfirmationMock.mockRejectedValueOnce(new Error("SMTP down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.reservationId).toBe(42);
    errorSpy.mockRestore();
  });

  it("メール送信が { success: false } を返しても予約レスポンスは 201 のまま", async () => {
    createReservationMock.mockResolvedValueOnce(okResult);
    sendReservationConfirmationMock.mockResolvedValueOnce({ success: false });

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(201);
  });

  it("ハニーポット発火: 見かけ上 201 を返しつつ createReservation を呼ばず永続化しない(メールも送らない)", async () => {
    const res = await POST(makeRequest(validBody({ hpField: "i am a bot" })));

    expect(res.status).toBe(201);
    const json = await res.json();
    // ダミー応答(reservationId=0)であり、実際の永続化は行われていない。
    expect(json.reservationId).toBe(0);
    expect(createReservationMock).not.toHaveBeenCalled();
    // 永続化していないので確認メールも送らない
    expect(sendReservationConfirmationMock).not.toHaveBeenCalled();
  });

  it("バリデーションエラー: 不正なカナ/電話/メールは 400 VALIDATION_ERROR", async () => {
    const res = await POST(
      makeRequest(
        validBody({ kana: "yamada", tel: "090-1234-5678", email: "not-an-email" }),
      ),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.fieldErrors).toBeTruthy();
    expect(createReservationMock).not.toHaveBeenCalled();
  });

  it("必須項目欠落(プライバシー未同意)は 400", async () => {
    const res = await POST(makeRequest(validBody({ privacyAgreed: false })));
    expect(res.status).toBe(400);
    expect(createReservationMock).not.toHaveBeenCalled();
  });

  it("枠確保失敗: createReservation が SlotUnavailableError を投げると 409 SLOT_UNAVAILABLE", async () => {
    createReservationMock.mockRejectedValueOnce(new SlotUnavailableError("CAPACITY_FULL"));

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("SLOT_UNAVAILABLE");
  });

  it("30分刻み違反(ロジック側 ValidationError)は 400", async () => {
    createReservationMock.mockRejectedValueOnce(
      new ValidationError({ time: ["予約時刻は30分刻みで指定してください"] }),
    );
    const res = await POST(makeRequest(validBody({ time: "10:00" })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("不正な JSON ボディ(null)は 400", async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
    expect(createReservationMock).not.toHaveBeenCalled();
  });
});
