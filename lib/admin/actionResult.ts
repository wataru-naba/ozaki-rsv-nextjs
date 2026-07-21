/**
 * 管理画面 Server Action の共通戻り値型(api-design.md 5章)。
 *
 * 例外を throw せず、成功/失敗を判別可能なユニオンとして返すことで、
 * クライアント側(useActionState / フォーム)でのハンドリングを単純化する。
 */

export type ActionErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ActionErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } };
}
