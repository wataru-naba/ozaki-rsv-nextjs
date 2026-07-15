import type { Metadata } from "next";
import ReserveWizard from "./ReserveWizard";

export const metadata: Metadata = {
  title: "ご予約 | 尾崎コンタクト",
  description: "店舗・ご相談内容・日時を選んでご予約いただけます。",
};

/**
 * 利用者向け予約フローのエントリページ(サーバーコンポーネント)。
 * インタラクティブなウィザード本体はクライアントコンポーネントに委譲する。
 */
export default function ReservePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">ご予約</h1>
        <p className="mt-2 text-sm text-zinc-500">
          店舗・ご相談内容・日時を選び、お客様情報をご入力ください。
        </p>
      </header>
      <ReserveWizard />
    </main>
  );
}
