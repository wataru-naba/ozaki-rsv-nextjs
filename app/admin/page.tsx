import type { Metadata } from "next";
import { requireAdminSession } from "@/lib/auth/session";
import { logoutAction } from "@/app/admin/_actions/auth";

export const metadata: Metadata = {
  title: "管理画面 | 予約システム",
};

/**
 * 管理トップの暫定プレースホルダ(US-005 スコープ)。
 *
 * 予約一覧・設定などの本体画面は他の US(US-006 以降)で実装する。
 * ここでは認証・認可(requireAdminSession によるセッションガード)と
 * ログアウト導線のみを提供し、ビルド可能な最小の /admin ページとする。
 */
export default async function AdminHomePage() {
  const user = await requireAdminSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900">予約システム 管理画面</h1>
        <p className="mb-6 text-sm text-zinc-500">
          ログイン中: {user.username ?? user.id}
        </p>
        <p className="mb-6 rounded-md bg-zinc-50 px-3 py-4 text-sm text-zinc-600">
          管理画面(準備中)。予約一覧・設定などの機能は今後のスプリントで追加されます。
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            ログアウト
          </button>
        </form>
      </div>
    </main>
  );
}
