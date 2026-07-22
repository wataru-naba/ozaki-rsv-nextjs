"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPublicHoliday,
  deletePublicHoliday,
  importPublicHolidaysCsv,
} from "@/app/admin/_actions/settings";

export type HolidayRow = {
  id: number;
  date: string; // "YYYY-MM-DD"
  name: string; // "" or 祝日名
};

/**
 * 祝日(PublicHoliday)の一覧・登録・削除(US-010 / api-design.md 5.5 節)。
 *
 * 祝日マスタは拠点非依存(全拠点共有)のため、拠点セレクタは設けない。
 * date は @unique のため、重複登録時は Server Action が DUPLICATE_DATE を返す。
 */
/** CSV のデータ行数を概算する(ヘッダー行と空行を除外)。確認ダイアログの取込予定件数表示用。 */
function estimateCsvRowCount(text: string): number {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return 0;
  // 先頭行の 1 列目が日付でなければヘッダーとみなして除外する。
  const firstCol = (lines[0].split(",")[0] ?? "").trim();
  const hasHeader = !/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(firstCol);
  return hasHeader ? lines.length - 1 : lines.length;
}

export function HolidayManager({ holidays }: { holidays: HolidayRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // CSV 一括登録用の状態。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvError, setCsvError] = useState<string[] | null>(null);
  const [csvSuccess, setCsvSuccess] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    if (!date) {
      setError("日付を指定してください。");
      return;
    }
    startTransition(async () => {
      const result = await createPublicHoliday({
        date,
        name: name.trim() === "" ? undefined : name.trim(),
      });
      if (result.ok) {
        setDate("");
        setName("");
        router.refresh();
      } else {
        const fieldMsg = result.error.fieldErrors
          ? Object.values(result.error.fieldErrors).flat().join(" / ")
          : "";
        setError(fieldMsg || result.error.message);
      }
    });
  }

  function onDelete(holidayId: number) {
    if (!window.confirm("この祝日を削除しますか?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePublicHoliday({ holidayId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  async function onImportCsv() {
    setCsvError(null);
    setCsvSuccess(null);
    if (!csvFile) {
      setCsvError(["CSV ファイルを選択してください。"]);
      return;
    }

    // 破壊的操作(全削除→全置換)の実行前確認。現在件数と取込予定件数を提示する。
    let plannedCount = 0;
    try {
      plannedCount = estimateCsvRowCount(await csvFile.text());
    } catch {
      plannedCount = 0;
    }
    const confirmed = window.confirm(
      `既存の祝日 ${holidays.length} 件をすべて削除し、CSV の ${plannedCount} 件で置き換えます。\n` +
        `この操作は取り消せません。よろしいですか?`,
    );
    if (!confirmed) return;

    const formData = new FormData();
    formData.append("file", csvFile);

    startTransition(async () => {
      const result = await importPublicHolidaysCsv(formData);
      if (result.ok) {
        setCsvSuccess(`${result.data.importedCount} 件の祝日を登録しました(既存データは置き換えました)。`);
        setCsvFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      } else {
        const detail = result.error.fieldErrors
          ? Object.values(result.error.fieldErrors).flat()
          : [];
        setCsvError([result.error.message, ...detail]);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 登録フォーム */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">名称(任意)</label>
            <input
              type="text"
              value={name}
              maxLength={50}
              placeholder="例: 建国記念の日"
              onChange={(e) => setName(e.target.value)}
              className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            追加
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* 一覧 */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">日付</th>
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {holidays.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-zinc-400">
                  登録された祝日はありません。
                </td>
              </tr>
            ) : (
              holidays.map((h) => (
                <tr key={h.id} className="border-b border-zinc-50 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-800">{h.date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {h.name === "" ? "—" : h.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(h.id)}
                      disabled={isPending}
                      className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* CSV 一括登録(全削除→再投入) */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-base font-semibold text-amber-900">CSV 一括登録</h2>
        <p className="mt-1 text-sm text-amber-800">
          内閣府「国民の祝日・休日」形式の CSV(ヘッダー行 + <code>YYYY/M/D,名称</code>)を取り込みます。
          <strong className="font-semibold">
            この操作は既存の祝日データをすべて削除し、CSV の内容で置き換えます。
          </strong>
          取り消しはできません。最新の CSV を使用してください。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setCsvError(null);
              setCsvSuccess(null);
              setCsvFile(e.target.files?.[0] ?? null);
            }}
            className="text-sm text-amber-900 file:mr-3 file:rounded-md file:border-0 file:bg-amber-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-amber-900 hover:file:bg-amber-300"
          />
          <button
            type="button"
            onClick={onImportCsv}
            disabled={isPending || !csvFile}
            className="rounded-md bg-amber-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
          >
            全削除して取り込む
          </button>
        </div>
        {csvSuccess && <p className="mt-2 text-sm text-green-700">{csvSuccess}</p>}
        {csvError && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-red-600">
            {csvError.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
