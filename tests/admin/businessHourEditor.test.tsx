// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { WEEKDAY_LABEL } from "@/lib/admin/labels";
import { BusinessHourEditor, type BusinessHourRow } from "@/app/admin/(dashboard)/slots/BusinessHourEditor";

/**
 * US-008 曜日別営業設定の表示・操作(受け入れ条件)。
 *
 * 検証:
 * - 曜日区分ごとに 営業可否・開始/終了時刻・休憩開始/終了・予約上限が表示される。
 * - 休診(isOpen=false)の行は時刻・上限入力が無効化される。
 * - 保存ボタン押下で updateBusinessHour が編集値で呼ばれる。
 * - Server Action が VALIDATION_ERROR を返すとメッセージ表示される。
 *
 * updateBusinessHour はモックし、フォーム→Action の受け渡しのみを検証する
 * (Action 本体の整合性は updateBusinessHour.test.ts で担保)。
 */

const updateBusinessHour = vi.fn();
vi.mock("@/app/admin/_actions/settings", () => ({
  updateBusinessHour: (...a: unknown[]) => updateBusinessHour(...a),
}));

function row(over: Partial<BusinessHourRow> = {}): BusinessHourRow {
  return {
    weekday: "MONDAY",
    isOpen: true,
    openTime: "09:00",
    closeTime: "18:30",
    breakStart: "12:00",
    breakEnd: "13:00",
    reservationLimit: 2,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateBusinessHour.mockResolvedValue({ ok: true, data: { id: 1 } });
});
afterEach(() => cleanup());

describe("BusinessHourEditor: 各曜日区分の表示", () => {
  it("全曜日区分のラベルが表示される", () => {
    const rows: BusinessHourRow[] = (
      ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "PUBLIC_HOLIDAY"] as const
    ).map((weekday) => row({ weekday }));
    render(<BusinessHourEditor placeId={1} rows={rows} />);

    for (const w of rows) {
      expect(screen.getByText(WEEKDAY_LABEL[w.weekday])).toBeInTheDocument();
    }
  });

  it("営業日の行は営業可否(チェック)・開始/終了/休憩開始/終了・予約上限が値付きで表示される", () => {
    render(<BusinessHourEditor placeId={1} rows={[row({ weekday: "MONDAY" })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.MONDAY).closest("tr")!;
    const scope = within(tr);

    // 営業チェックボックス(ON)
    const checkbox = scope.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // 時刻入力(type=time)は開始/終了/休憩開始/休憩終了の4つ
    const times = tr.querySelectorAll('input[type="time"]');
    expect(times).toHaveLength(4);
    expect((times[0] as HTMLInputElement).value).toBe("09:00");
    expect((times[1] as HTMLInputElement).value).toBe("18:30");
    expect((times[2] as HTMLInputElement).value).toBe("12:00");
    expect((times[3] as HTMLInputElement).value).toBe("13:00");

    // 予約上限(type=number)
    const num = tr.querySelector('input[type="number"]') as HTMLInputElement;
    expect(num.value).toBe("2");
  });

  it("外枠 9:00-18:30 に対応する min/max が時刻入力に付与される", () => {
    render(<BusinessHourEditor placeId={1} rows={[row({ weekday: "MONDAY" })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.MONDAY).closest("tr")!;
    const times = tr.querySelectorAll('input[type="time"]');
    // 開始・終了に外枠が反映されている。
    expect((times[0] as HTMLInputElement).min).toBe("09:00");
    expect((times[0] as HTMLInputElement).max).toBe("18:30");
    expect((times[1] as HTMLInputElement).min).toBe("09:00");
    expect((times[1] as HTMLInputElement).max).toBe("18:30");
  });

  it("休診日(isOpen=false)の行は時刻・上限入力が無効化される", () => {
    render(<BusinessHourEditor placeId={1} rows={[row({ weekday: "SUNDAY", isOpen: false })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.SUNDAY).closest("tr")!;

    const checkbox = within(tr).getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    tr.querySelectorAll('input[type="time"]').forEach((el) => {
      expect((el as HTMLInputElement).disabled).toBe(true);
    });
    expect((tr.querySelector('input[type="number"]') as HTMLInputElement).disabled).toBe(true);
  });
});

describe("BusinessHourEditor: 保存操作で Server Action を呼ぶ", () => {
  it("保存ボタンで updateBusinessHour が placeId・weekday・編集値付きで呼ばれる", async () => {
    render(<BusinessHourEditor placeId={7} rows={[row({ weekday: "TUESDAY", reservationLimit: 3 })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.TUESDAY).closest("tr")!;

    fireEvent.click(within(tr).getByRole("button", { name: /保存/ }));

    // useTransition 経由で非同期に呼ばれるのを待つ。
    await vi.waitFor(() => expect(updateBusinessHour).toHaveBeenCalledTimes(1));
    const arg = updateBusinessHour.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.placeId).toBe(7);
    expect(arg.weekday).toBe("TUESDAY");
    expect(arg.isOpen).toBe(true);
    expect(arg.openTime).toBe("09:00");
    expect(arg.closeTime).toBe("18:30");
    expect(arg.reservationLimit).toBe(3);
  });

  it("保存成功で『保存しました』が表示される", async () => {
    render(<BusinessHourEditor placeId={1} rows={[row({ weekday: "WEDNESDAY" })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.WEDNESDAY).closest("tr")!;

    fireEvent.click(within(tr).getByRole("button", { name: /保存/ }));

    await screen.findByText("保存しました");
  });

  it("Server Action が VALIDATION_ERROR を返すとエラーメッセージを表示する", async () => {
    updateBusinessHour.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "入力内容に誤りがあります。",
        fieldErrors: { openTime: ["開始時刻は9:00以降のみ設定できます"] },
      },
    });
    render(<BusinessHourEditor placeId={1} rows={[row({ weekday: "THURSDAY" })]} />);
    const tr = screen.getByText(WEEKDAY_LABEL.THURSDAY).closest("tr")!;

    fireEvent.click(within(tr).getByRole("button", { name: /保存/ }));

    await screen.findByText(/9:00以降/);
  });
});
