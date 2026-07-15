# ozaki-rsv-nextjs

Angular + CakePHP で構築された予約システムを Next.js フルスタック構成へ再構築するプロジェクト。
本リポジトリは **プロジェクト基盤フェーズ** までを実装済み(利用者向け画面・管理画面・API/Server Actions は後続タスクで実装)。

- 技術スタック: Next.js 16 (App Router) / TypeScript / Tailwind CSS / Prisma 6 + PostgreSQL / Auth.js (NextAuth v5)
- 設計ドキュメント: `docs/requirements/`, `docs/design/`
- DB スキーマ: `prisma/schema.prisma`(設計確定済み・変更不可)

## セットアップ手順

前提: Node.js 20+ / Docker

```bash
# 1. 依存インストール
npm install

# 2. 環境変数ファイルを用意
cp .env.example .env   # 開発用のダミー値がそのまま使える

# 3. ローカル PostgreSQL を起動
npm run db:up          # docker compose up -d

# 4. マイグレーション適用 + Prisma Client 生成
npm run db:migrate     # prisma migrate dev

# 5. シードデータ投入(拠点・営業時間・管理者・祝日)
npm run db:seed        # prisma db seed

# 6. 開発サーバー起動
npm run dev            # http://localhost:3000
```

## npm スクリプト

| スクリプト | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー起動 |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | PostgreSQL コンテナ起動 / 停止 |
| `npm run db:migrate` | マイグレーション作成・適用 |
| `npm run db:seed` | シード投入 |
| `npm run db:reset` | DB リセット(全マイグレーション再適用 + seed) |

## 開発用テスト管理者アカウント

シード(`prisma/seed.ts`)で投入される。管理画面 `/admin` は Auth.js で保護され、未認証時は `/admin/login` へリダイレクトされる。

| 項目 | 値 |
|---|---|
| username | `admin` |
| password | `password123` |
| role | `ADMIN` |

> パスワードは bcrypt でハッシュ化して保存される。平文は開発用のみ。`.env` の `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` で変更可能。

## 環境変数

`.env.example` を参照。主な変数:

- `DATABASE_URL` — PostgreSQL 接続文字列(`docker-compose.yml` と一致)
- `AUTH_SECRET` — Auth.js の署名鍵(本番では必ず差し替える)
- `MAIL_*` — メール送信設定(実送信は後続タスクで実装。Bcc `MAIL_BCC` は業務要件として継続必須)

## ディレクトリ構成(基盤フェーズ時点)

```
app/                          Next.js App Router
  api/auth/[...nextauth]/     Auth.js ルートハンドラ
lib/
  prisma.ts                   PrismaClient シングルトン
  auth.ts                     Auth.js 設定(Credentials + JWT、Node ランタイム)
auth.config.ts                Edge 安全な Auth.js 基本設定(middleware 用)
middleware.ts                 /admin/** の保護(/admin/login を除外)
types/next-auth.d.ts          セッション/JWT の型拡張(username, role)
prisma/
  schema.prisma               DB スキーマ(確定済み)
  migrations/                 マイグレーション(count >= 0 の CHECK 制約を手動追記済み)
  seed.ts                     シードスクリプト
docker-compose.yml            開発用 PostgreSQL
```
