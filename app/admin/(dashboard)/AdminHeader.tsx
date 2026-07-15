import Link from "next/link";
import { logoutAction } from "@/app/admin/_actions/auth";

/** 管理画面共通ヘッダー(ナビ + ログアウト)。 */
export function AdminHeader({ username }: { username?: string }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-zinc-900">予約システム 管理</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/reservations" className="text-zinc-600 hover:text-zinc-900">
              予約一覧
            </Link>
            <Link href="/admin/slots" className="text-zinc-600 hover:text-zinc-900">
              予約枠管理
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {username && <span className="text-sm text-zinc-500">{username}</span>}
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
