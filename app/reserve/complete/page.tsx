import type { Metadata } from "next";
import CompleteView from "./CompleteView";

export const metadata: Metadata = {
  title: "ご予約完了 | 尾崎コンタクト",
};

/**
 * 予約完了ページ(サーバーコンポーネント)。
 * 予約確定成功後のリダイレクト先。詳細表示はクライアントコンポーネントに委譲する。
 */
export default function ReserveCompletePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <CompleteView />
    </main>
  );
}
