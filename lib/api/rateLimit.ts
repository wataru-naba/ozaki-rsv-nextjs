import type { NextRequest } from "next/server";

/**
 * MVP 用の簡易レート制限(api-design.md 8.2 節)。
 *
 * 注意: これは単一プロセスのインメモリ実装であり、Vercel 等の複数インスタンス環境では
 * インスタンス間でカウンタを共有できない。8.2 節の設計どおり、本番運用では Redis 等の
 * 外部ストア(例: Upstash Redis + @upstash/ratelimit)への差し替えを前提とする。
 * ここでは MVP として「実際に動作する」ことを優先した最小実装にとどめる。
 */

type Bucket = { count: number; resetAt: number };

/** キー(例: "reservation:1.2.3.4:60000")→ 固定ウィンドウのカウンタ。 */
const store = new Map<string, Bucket>();

/** 制限ルール1件。 */
export type RateRule = { limit: number; windowMs: number };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * 複数の固定ウィンドウルールを AND 評価する(例: 5回/分 かつ 30回/時)。
 * いずれかを超えたら ok:false を返す。超過が無い場合のみ全ルールのカウンタを加算する。
 */
export function checkRateLimit(
  baseKey: string,
  rules: RateRule[],
  now: number = Date.now(),
): RateLimitResult {
  // まず全ルールについて超過が無いか確認(超過なら加算しない)
  for (const rule of rules) {
    const key = `${baseKey}:${rule.windowMs}`;
    const bucket = store.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= rule.limit) {
      return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }
  }

  // 超過が無ければ全ルールのカウンタを加算(ウィンドウ切れは初期化)
  for (const rule of rules) {
    const key = `${baseKey}:${rule.windowMs}`;
    const bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + rule.windowMs });
    } else {
      bucket.count += 1;
    }
  }

  return { ok: true };
}

/**
 * リクエストからクライアント IP を推定する。
 * リバースプロキシ配下では X-Forwarded-For 先頭、無ければ X-Real-IP。
 * いずれも無い場合は "unknown"(開発時の curl 等)。
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** テスト用: 内部ストアを初期化する。 */
export function __resetRateLimitStore(): void {
  store.clear();
}
