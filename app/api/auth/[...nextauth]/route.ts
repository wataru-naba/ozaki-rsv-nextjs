import { handlers } from "@/lib/auth";

// Auth.js (NextAuth v5) の GET/POST ハンドラをエクスポートする(api-design.md 6.1節)。
export const { GET, POST } = handlers;
