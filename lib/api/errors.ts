import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { UnavailableReason } from "@/lib/reservation/judge";

/**
 * 公開APIの共通エラー表現(api-design.md 2.1 節)。
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR" // 400 リクエスト形式不正
  | "SLOT_UNAVAILABLE" // 409 再検証の結果その枠が確保できなかった
  | "RATE_LIMITED" // 429 レート制限超過
  | "NOT_FOUND" // 404 存在しないリソース
  | "INTERNAL_ERROR"; // 500 想定外エラー

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    reason?: string; // SLOT_UNAVAILABLE の内部理由(ログ/デバッグ用)
    fieldErrors?: Record<string, string[]>; // VALIDATION_ERROR のフィールド別
  };
};

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** アプリ内で throw する共通エラー基底クラス。 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly reason?: string;
  readonly fieldErrors?: Record<string, string[]>;
  /** RATE_LIMITED 時に Retry-After ヘッダーへ載せる秒数。 */
  readonly retryAfterSeconds?: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: {
      reason?: string;
      fieldErrors?: Record<string, string[]>;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.reason = options?.reason;
    this.fieldErrors = options?.fieldErrors;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export class ValidationError extends ApiError {
  constructor(fieldErrors?: Record<string, string[]>, message = "入力内容に誤りがあります。") {
    super("VALIDATION_ERROR", message, { fieldErrors });
    this.name = "ValidationError";
  }

  /** Zod のエラーをフィールド別に整形して ValidationError にする。 */
  static fromZod(error: ZodError): ValidationError {
    const flattened = z_flatten(error);
    return new ValidationError(flattened);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "対象が見つかりません。") {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class SlotUnavailableError extends ApiError {
  constructor(reason: UnavailableReason) {
    super("SLOT_UNAVAILABLE", "この時間帯は選択できなくなりました。再度お選びください。", {
      reason,
    });
    this.name = "SlotUnavailableError";
  }
}

export class RateLimitError extends ApiError {
  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", "リクエストが多すぎます。しばらくしてから再度お試しください。", {
      retryAfterSeconds,
    });
    this.name = "RateLimitError";
  }
}

/** ZodError → Record<field, messages[]>(zod のバージョン差異に依存しない自前 flatten)。 */
function z_flatten(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * 例外を API エラーレスポンス(NextResponse)に変換する共通ハンドラ。
 * ApiError はそのまま、それ以外は 500 INTERNAL_ERROR に丸める。
 */
export function handleApiError(err: unknown): NextResponse<ApiErrorResponse> {
  if (err instanceof ApiError) {
    const body: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.reason ? { reason: err.reason } : {}),
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      },
    };
    const headers: Record<string, string> = {};
    if (err.code === "RATE_LIMITED" && err.retryAfterSeconds != null) {
      headers["Retry-After"] = String(err.retryAfterSeconds);
    }
    return NextResponse.json(body, { status: err.status, headers });
  }

  // 想定外エラーは詳細を漏らさず 500 に丸める(スタックはサーバーログにのみ出す)
  console.error("[api] unexpected error:", err);
  const body: ApiErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "サーバーでエラーが発生しました。時間をおいて再度お試しください。",
    },
  };
  return NextResponse.json(body, { status: 500 });
}
