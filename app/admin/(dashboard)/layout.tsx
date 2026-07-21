import { requireAdminSession } from "@/lib/auth/session";
import { AdminHeader } from "./AdminHeader";

/**
 * 管理画面(認証済みエリア)の共通レイアウト。
 *
 * middleware.ts でも保護されるが、6.3 節の二重防御としてレイアウトでも
 * セッションを検証する。ログイン画面(/admin/login)はこのレイアウト配下に
 * 含めないため、ここでの検証がログイン画面を巻き込むことはない。
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdminSession();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100">
      <AdminHeader username={user.username} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
