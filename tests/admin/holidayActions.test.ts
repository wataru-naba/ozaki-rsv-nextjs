import { beforeEach, describe, it, expect, vi } from "vitest";

/**
 * US-010 祝日(PublicHoliday)個別追加・削除(Server Action)のテスト(api-design.md 5.5 節)。
 *
 * 検証対象:
 * - createPublicHoliday: 日付のみ(name 任意)で登録できる / name 付きでも登録できる。
 *   @db.Date は UTC 0時として保存されるため、create に渡る Date の UTC 値で検証する。
 * - 重複日付: Prisma のユニーク制約違反(P2002)を DUPLICATE_DATE に変換し、二重登録しない。
 * - バリデーション: 日付未指定・不正フォーマットは VALIDATION_ERROR、name 50文字超過も VALIDATION_ERROR。
 * - deletePublicHoliday: 指定祝日を削除し revalidatePath される。存在しない ID は NOT_FOUND。
 * - 未認証で各 Action を直接呼ぶと UNAUTHORIZED(ページ保護に依存しない)。
 * - 登録・削除後に revalidatePath("/admin/holidays") される。
 *
 * 祝日マスタは拠点非依存(全拠点共有)のため placeId を扱わない。
 */

// --- 認可(requireAdminSession)のモック ---
const requireAdminSession = vi.fn();
const { UnauthorizedErrorMock } = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {
    constructor(message = "認証が必要です。") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }
  return { UnauthorizedErrorMock };
});
vi.mock("@/lib/auth/session", () => ({
  requireAdminSession: (...a: unknown[]) => requireAdminSession(...a),
  UnauthorizedError: UnauthorizedErrorMock,
}));

// --- revalidatePath のモック ---
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// --- Prisma のモック ---
const holidayCreate = vi.fn();
const holidayFindUnique = vi.fn();
const holidayDelete = vi.fn();
const holidayDeleteMany = vi.fn();
const holidayCreateMany = vi.fn();
const prismaTransaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicHoliday: {
      create: (...a: unknown[]) => holidayCreate(...a),
      findUnique: (...a: unknown[]) => holidayFindUnique(...a),
      delete: (...a: unknown[]) => holidayDelete(...a),
      deleteMany: (...a: unknown[]) => holidayDeleteMany(...a),
      createMany: (...a: unknown[]) => holidayCreateMany(...a),
    },
    $transaction: (...a: unknown[]) => prismaTransaction(...a),
  },
}));

import {
  createPublicHoliday,
  deletePublicHoliday,
  importPublicHolidaysCsv,
} from "@/app/admin/_actions/settings";

type CreateArg = { data: Record<string, unknown> };

/** @db.Date 用 Date から "YYYY-MM-DD"(UTC)を得る。 */
function dateColToYMD(v: unknown): string {
  const d = v as Date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Prisma のユニーク制約違反(P2002)を模した Error。 */
function makeP2002(): Error {
  const e = new Error("Unique constraint failed on the fields: (`date`)") as Error & {
    code?: string;
  };
  e.code = "P2002";
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminSession.mockResolvedValue({ id: "u1", username: "staff" });
  holidayCreate.mockResolvedValue({ id: 100 });
  holidayFindUnique.mockResolvedValue({ id: 5 });
  holidayDelete.mockResolvedValue({ id: 5 });
  // deleteMany/createMany は PrismaPromise 相当。$transaction はそれらを受けて解決する。
  holidayDeleteMany.mockResolvedValue({ count: 3 });
  holidayCreateMany.mockResolvedValue({ count: 0 });
  prismaTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("createPublicHoliday — 登録正常系", () => {
  it("日付のみ(name 省略)で登録でき、name は null で保存される", async () => {
    const result = await createPublicHoliday({ date: "2027-01-01" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(100);
    expect(holidayCreate).toHaveBeenCalledTimes(1);
    const arg = holidayCreate.mock.calls[0][0] as CreateArg;
    expect(dateColToYMD(arg.data.date)).toBe("2027-01-01");
    expect(arg.data.name).toBeNull();
    // 拠点非依存: placeId を渡さない。
    expect(arg.data).not.toHaveProperty("placeId");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/holidays");
  });

  it("name 付きで登録でき、name が保存される", async () => {
    const result = await createPublicHoliday({ date: "2027-02-11", name: "建国記念の日" });

    expect(result.ok).toBe(true);
    const arg = holidayCreate.mock.calls[0][0] as CreateArg;
    expect(dateColToYMD(arg.data.date)).toBe("2027-02-11");
    expect(arg.data.name).toBe("建国記念の日");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/holidays");
  });

  it("name が空文字なら null に正規化される", async () => {
    await createPublicHoliday({ date: "2027-03-20", name: "" });
    const arg = holidayCreate.mock.calls[0][0] as CreateArg;
    expect(arg.data.name).toBeNull();
  });

  it("name が空白のみなら null に正規化される", async () => {
    await createPublicHoliday({ date: "2027-03-21", name: "   " });
    const arg = holidayCreate.mock.calls[0][0] as CreateArg;
    expect(arg.data.name).toBeNull();
  });
});

describe("createPublicHoliday — 重複日付(DUPLICATE_DATE)", () => {
  it("P2002 発生時は DUPLICATE_DATE を返し、二重登録しない(revalidate しない)", async () => {
    holidayCreate.mockRejectedValue(makeP2002());

    const result = await createPublicHoliday({ date: "2027-01-01" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_DATE");
    // create は1回試行されるが、成功はしていない(=DB に重複行は残らない)。
    expect(holidayCreate).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createPublicHoliday — バリデーション(DB を触らない)", () => {
  it("日付未指定は VALIDATION_ERROR で create しない", async () => {
    // @ts-expect-error 日付未指定の不正入力を意図的に渡す。
    const result = await createPublicHoliday({ name: "テスト" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(holidayCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("不正な日付フォーマットは VALIDATION_ERROR", async () => {
    const result = await createPublicHoliday({ date: "2027/01/01" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(holidayCreate).not.toHaveBeenCalled();
  });

  it("name が50文字超過は VALIDATION_ERROR", async () => {
    const result = await createPublicHoliday({ date: "2027-01-01", name: "あ".repeat(51) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(holidayCreate).not.toHaveBeenCalled();
  });

  it("name が50文字ちょうどは許可(境界値)", async () => {
    const result = await createPublicHoliday({ date: "2027-01-01", name: "あ".repeat(50) });
    expect(result.ok).toBe(true);
    expect(holidayCreate).toHaveBeenCalledTimes(1);
  });

  it("VALIDATION_ERROR は fieldErrors を返す", async () => {
    const result = await createPublicHoliday({ date: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors).toBeTruthy();
  });
});

describe("createPublicHoliday — 認可", () => {
  it("未認証なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const result = await createPublicHoliday({ date: "2027-01-01" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(holidayCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createPublicHoliday — DB エラー", () => {
  it("create が P2002 以外で失敗したら INTERNAL_ERROR を返し revalidate しない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    holidayCreate.mockRejectedValue(new Error("DB down"));

    const result = await createPublicHoliday({ date: "2027-01-01" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(revalidatePath).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("deletePublicHoliday — 正常系", () => {
  it("指定した祝日を削除し、成功を返して revalidatePath される", async () => {
    const result = await deletePublicHoliday({ holidayId: 5 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.holidayId).toBe(5);
    expect(holidayFindUnique).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(holidayDelete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/holidays");
  });
});

describe("deletePublicHoliday — NOT_FOUND", () => {
  it("存在しない祝日 ID は NOT_FOUND を返し delete しない", async () => {
    holidayFindUnique.mockResolvedValue(null);

    const result = await deletePublicHoliday({ holidayId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(holidayDelete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("不正な ID(0 以下・非整数)は VALIDATION_ERROR で DB を触らない", async () => {
    const result = await deletePublicHoliday({ holidayId: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(holidayFindUnique).not.toHaveBeenCalled();
    expect(holidayDelete).not.toHaveBeenCalled();
  });
});

describe("deletePublicHoliday — 認可", () => {
  it("未認証なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const result = await deletePublicHoliday({ holidayId: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(holidayFindUnique).not.toHaveBeenCalled();
    expect(holidayDelete).not.toHaveBeenCalled();
  });
});

/**
 * US-010 追加 / ADR 0002: importPublicHolidaysCsv(CSV 一括登録=全削除→再投入)。
 *
 * データ整合性が必須テスト対象:
 * - 正常系: 全削除→全件挿入を単一トランザクション($transaction([deleteMany, createMany]))で実行。
 * - 不正行が 1 件でもあれば DB を一切変更しない(deleteMany も createMany も呼ばれない)。
 * - createMany 失敗($transaction reject)時はロールバックされ、INTERNAL_ERROR を返し revalidate しない。
 * - サイズ上限・空ファイル拒否。
 * - 未認証は UNAUTHORIZED。
 */

const HEADER = "国民の祝日・休日月日,国民の祝日・休日名称";

/** テスト用 CSV File を生成する(実ファイルは同梱しない。同形式の小規模サンプルを用いる)。 */
function csvFile(content: string, name = "holidays.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

/** 指定バイト数の File を生成する(サイズ上限テスト用。中身の妥当性は問わない)。 */
function oversizedFile(bytes: number): File {
  return new File(["a".repeat(bytes)], "big.csv", { type: "text/csv" });
}

function formDataWith(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return fd;
}

/** @db.Date 用 Date から "YYYY-MM-DD"(UTC)を得る。 */
function ymd(v: unknown): string {
  const d = v as Date;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

describe("importPublicHolidaysCsv — 正常系(全削除→全件挿入)", () => {
  it("検証済み CSV を単一トランザクションで全置換し、importedCount を返す", async () => {
    const fd = formDataWith(
      csvFile([HEADER, "2026/1/1,元日", "2026/2/11,建国記念の日"].join("\r\n")),
    );

    const result = await importPublicHolidaysCsv(fd);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.importedCount).toBe(2);

    // 全削除→全件挿入が「1 つの」$transaction 呼び出しにまとめられていること。
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    const ops = prismaTransaction.mock.calls[0][0] as unknown[];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);

    // deleteMany は全件対象(空 where)、createMany は正規化済みデータ。
    expect(holidayDeleteMany).toHaveBeenCalledWith({});
    expect(holidayCreateMany).toHaveBeenCalledTimes(1);
    const createArg = holidayCreateMany.mock.calls[0][0] as { data: Array<{ date: unknown; name: string | null }> };
    expect(createArg.data.map((r) => ymd(r.date))).toEqual(["2026-01-01", "2026-02-11"]);
    expect(createArg.data.map((r) => r.name)).toEqual(["元日", "建国記念の日"]);

    expect(revalidatePath).toHaveBeenCalledWith("/admin/holidays");
  });

  it("ヘッダー無し・BOM 付き・LF でも取り込める", async () => {
    const fd = formDataWith(csvFile("﻿2026/5/3,憲法記念日\n2026/5/4,みどりの日"));
    const result = await importPublicHolidaysCsv(fd);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.importedCount).toBe(2);
  });
});

describe("importPublicHolidaysCsv — 不正 CSV は DB を一切変更しない", () => {
  it("不正行が 1 件でもあれば deleteMany/createMany/$transaction を呼ばず VALIDATION_ERROR", async () => {
    const fd = formDataWith(
      csvFile([HEADER, "2026/1/1,元日", "2026/2/30,存在しない日"].join("\n")),
    );

    const result = await importPublicHolidaysCsv(fd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      // 不正行の詳細(行番号 + 理由)を fieldErrors に載せる。
      expect(result.error.fieldErrors).toBeTruthy();
    }
    expect(prismaTransaction).not.toHaveBeenCalled();
    expect(holidayDeleteMany).not.toHaveBeenCalled();
    expect(holidayCreateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("空ファイル(サイズ 0)は VALIDATION_ERROR で DB を触らない", async () => {
    const result = await importPublicHolidaysCsv(formDataWith(csvFile("")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(prismaTransaction).not.toHaveBeenCalled();
    expect(holidayDeleteMany).not.toHaveBeenCalled();
  });

  it("データ行が無い(ヘッダーのみ)CSV は VALIDATION_ERROR で DB を触らない", async () => {
    const result = await importPublicHolidaysCsv(formDataWith(csvFile(HEADER)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(holidayDeleteMany).not.toHaveBeenCalled();
  });

  it("file が無い FormData は VALIDATION_ERROR", async () => {
    const result = await importPublicHolidaysCsv(formDataWith(null));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(prismaTransaction).not.toHaveBeenCalled();
  });
});

describe("importPublicHolidaysCsv — トランザクションのロールバック", () => {
  it("createMany 失敗($transaction reject)なら INTERNAL_ERROR を返し revalidate しない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // createMany が失敗 → Promise.all(=$transaction) が reject → 全体ロールバック。
    holidayCreateMany.mockRejectedValue(new Error("createMany failed"));

    const fd = formDataWith(csvFile([HEADER, "2026/1/1,元日"].join("\n")));
    const result = await importPublicHolidaysCsv(fd);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    // 全削除と全件挿入は 1 トランザクションに束ねられているため、失敗時は削除も無効化される。
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("importPublicHolidaysCsv — 上限・防御", () => {
  it("1MB を超えるファイルは VALIDATION_ERROR で DB を触らない", async () => {
    const result = await importPublicHolidaysCsv(formDataWith(oversizedFile(1024 * 1024 + 1)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(prismaTransaction).not.toHaveBeenCalled();
    expect(holidayDeleteMany).not.toHaveBeenCalled();
  });
});

describe("importPublicHolidaysCsv — 認可", () => {
  it("未認証なら UNAUTHORIZED を返し DB へ触れない", async () => {
    requireAdminSession.mockRejectedValue(new UnauthorizedErrorMock());

    const fd = formDataWith(csvFile([HEADER, "2026/1/1,元日"].join("\n")));
    const result = await importPublicHolidaysCsv(fd);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
    expect(prismaTransaction).not.toHaveBeenCalled();
    expect(holidayDeleteMany).not.toHaveBeenCalled();
    expect(holidayCreateMany).not.toHaveBeenCalled();
  });
});
