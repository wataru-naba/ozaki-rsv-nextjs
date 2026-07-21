import { describe, it, expect } from "vitest";
import { reservationTypeLabel, WEEKDAY_LABEL, WEEKDAY_ORDER } from "@/lib/admin/labels";
import { TYPE_OPTIONS } from "@/lib/reservation/publicTypes";

/**
 * US-006 受け入れ条件(種別ラベル):
 * 「種別(typeId)は、クライアント送信値ではなくアプリ定数から導出したラベルを表示する」
 * (db-schema.md 3-7 節: DB の自由文字列に依存しない)。
 */
describe("reservationTypeLabel: typeId → アプリ定数由来のラベル", () => {
  it("typeId 0/1/2 は TYPE_OPTIONS のラベルに一致する(DB自由文字列に依存しない)", () => {
    for (const opt of TYPE_OPTIONS) {
      expect(reservationTypeLabel(opt.typeId)).toBe(opt.label);
    }
  });

  it("typeId 0 は『はじめて(未来店)』相当のラベル(90分区分)", () => {
    const expected = TYPE_OPTIONS.find((t) => t.typeId === 0)!.label;
    expect(reservationTypeLabel(0)).toBe(expected);
  });

  it("定義外の typeId はフォールバック表記(種別 N)を返す", () => {
    expect(reservationTypeLabel(99)).toBe("種別 99");
  });
});

describe("曜日区分ラベルと表示順(一覧のヘッダ表示に使用)", () => {
  it("Weekday enum 全区分に日本語ラベルが定義されている", () => {
    for (const w of WEEKDAY_ORDER) {
      expect(WEEKDAY_LABEL[w]).toBeTruthy();
    }
  });

  it("表示順は 日→月→…→土→祝日 の固定順", () => {
    expect(WEEKDAY_ORDER).toEqual([
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "PUBLIC_HOLIDAY",
    ]);
  });
});
