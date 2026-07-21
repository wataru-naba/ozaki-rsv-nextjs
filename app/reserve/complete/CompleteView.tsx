"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  placeLabel,
  PLACE_OPTIONS,
  type CreateReservationResponse,
} from "@/lib/reservation/publicTypes";
import { clearResult, loadResult } from "../draft";

/**
 * 予約完了画面。予約確定後に sessionStorage 経由で受け取った結果を表示する。
 * 直接アクセス(結果なし)の場合は予約トップへ戻す。
 */
export default function CompleteView() {
  const router = useRouter();
  const [result, setResult] = useState<CreateReservationResponse | null>(null);
  const [checked, setChecked] = useState(false);
  // React Strict Mode(開発時)はマウント直後にeffectを2回実行するため、
  // 「読み取って即クリア」を1回のeffectに書くと2回目の実行で結果が消えており
  // 誤って /reserve へリダイレクトしてしまう。ref で初回実行済みかどうかを
  // 判定し、クリアは初回の実行でのみ行う。
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const r = loadResult();
    if (!r) {
      // 結果が無い(直接アクセス/リロード後の二重表示)場合は予約トップへ
      router.replace("/reserve");
      return;
    }
    // sessionStorage(外部ストア)から受け取った予約結果の初回ハイドレーション。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(r);
    setChecked(true);
    // 読み終えたら結果はクリアし、リロードでの二重表示や個人情報の残留を避ける
    clearResult();
  }, [router]);

  if (!checked || !result) {
    return <p className="py-12 text-center text-sm text-zinc-500">読み込み中…</p>;
  }

  const { dateLabel, timeLabel } = formatStartAt(result.startAt);

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">
        ✓
      </div>
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">ご予約が完了しました</h1>
        <p className="mt-2 text-sm text-zinc-600">
          ご入力のメールアドレス宛に確認メールを送信しました。
          <br />
          メールが届かない場合は、お手数ですが店舗までお電話ください。
        </p>
      </div>

      <dl className="mx-auto max-w-md divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-left">
        <Row label="予約番号" value={`No. ${result.reservationId}`} />
        <Row label="店舗" value={`${placeLabel(result.place)}店`} />
        <Row label="ご予約日時" value={`${dateLabel} ${timeLabel}`} />
        <Row label="所要時間" value={`約${result.durationMinutes}分`} />
      </dl>

      <div className="mx-auto max-w-md rounded-lg bg-zinc-50 p-4 text-left text-xs text-zinc-600">
        <p className="mb-1 font-medium text-zinc-700">キャンセル・変更について</p>
        <p>ご予約のキャンセルや変更は、下記の店舗までお電話にてご連絡ください。</p>
        <ul className="mt-2 space-y-0.5">
          {PLACE_OPTIONS.map((p) => (
            <li key={p.code}>
              {p.name}店: {p.tel}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Link
          href="/reserve"
          className="inline-block rounded-lg border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          続けて予約する
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-28 shrink-0 text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

/** ISO 文字列(+09:00 を含む)を Asia/Tokyo 固定で表示整形する。 */
function formatStartAt(iso: string): { dateLabel: string; timeLabel: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dateLabel = `${get("year")}年${get("month")}月${get("day")}日（${get("weekday")}）`;
  const timeLabel = `${get("hour")}:${get("minute")}`;
  return { dateLabel, timeLabel };
}
