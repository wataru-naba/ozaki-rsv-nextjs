import { redirect } from "next/navigation";

/** /admin は予約一覧へリダイレクトする。 */
export default function AdminIndexPage() {
  redirect("/admin/reservations");
}
