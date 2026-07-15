import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "管理画面ログイン | 予約システム",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.callbackUrl;
  const callbackUrl = typeof raw === "string" ? raw : "/admin/reservations";

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900">予約システム 管理画面</h1>
        <p className="mb-6 text-sm text-zinc-500">スタッフ用ログイン</p>
        <LoginForm callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
