# データ移行計画(旧MySQL/MariaDB → 新PostgreSQL/Prisma)

対象: `schema_ozdb.sql`(旧本番DBスキーマ、MySQL/MariaDB)→ `prisma/schema.prisma`(新DB、PostgreSQL)
参照: [docs/design/db-schema.md](db-schema.md)(新DB設計の根拠)、[docs/requirements/current-requirements.md](../requirements/current-requirements.md)(要件・確認済み事項)

---

## 前提(ユーザー確定回答)

- 本番DBの実際のタイムゾーン設定は **Asia/Tokyo**。
- 祝日マスタの拠点共有、営業時間9:00-18:30の外枠維持は業務要件として確定済み(詳細は要件ドキュメント参照)。

### タイムゾーンの扱い

旧システムは `strtotime()` で日時文字列をUNIXエポック秒(タイムゾーン非依存の絶対時刻)に変換して格納している。サーバーの実行タイムゾーンがAsia/Tokyoだったことが確定したため、格納されている整数値は**そのまま正しい絶対時刻**を表す。移行時は単純に `to_timestamp(epoch_seconds)` でPostgresの `timestamptz` に変換すればよく、手動のオフセット調整は不要。

---

## テーブル対応表

| 旧テーブル(MySQL) | 新モデル(Prisma) | 備考 |
|---|---|---|
| `rsv_datetime` | `ReservationSlot` | `fix`列は破棄(新設計では都度計算) |
| `rsv_holiday` | `PublicHoliday` | 日付のみへ変換 |
| `rsv_fix` | `Closure` | 3カラム→date+startTime/endTimeに再構成 |
| `rsv_inite` | `BusinessHour` | week(0-7)→Weekday enum |
| `rsv_users` | `Reservation` | address/sex/memo/time/type/datetime_idは破棄 |
| `users` | `AdminUser` | role→AdminRole enum |
| `oc_*`(WordPress関連) | 移行対象外 | 要件ドキュメントよりMVPスコープ外 |

移行順序は外部キー依存に従う: `Place`(シード)→`AdminUser`→`BusinessHour`→`PublicHoliday`→`Closure`→`ReservationSlot`→`Reservation`。

---

## 1. `Place`(シードデータ、移行元なし)

旧システムは `place=1`(日向)/`place=2`(延岡)をハードコードしていたため、移行スクリプト実行前に手動シードする。

```
code: "HYUGA",   name: "日向"   (旧 place=1)
code: "NOBEOKA", name: "延岡"   (旧 place=2)
```

以降のテーブルはこの `Place.id` を`placeId`として参照する。

---

## 2. `users` → `AdminUser`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `username` | `username` | そのまま |
| `email` | `email` | そのまま(NULL許容) |
| `password` | `passwordHash` | そのままコピー(CakePHP `DefaultPasswordHasher` = bcrypt) |
| `role` | `role` | 文字列 → `AdminRole` enum(`admin`→`ADMIN`, `author`→`AUTHOR`) |

**移行前チェック**:
- `email` に重複値がないか(新設計で`@unique`制約を追加したため)。重複があれば移行前に手動で解消する。
- `role` の値が `admin`/`author` 以外を含んでいないか確認する。
- bcryptハッシュのプレフィックス(`$2y$`等)がNode側の検証ライブラリ(実装フェーズで選定)と互換か実装時に確認する。移行自体は文字列コピーで完了するが、ログインが実際に通るかは実装フェーズでの検証が必要。

---

## 3. `rsv_inite` → `BusinessHour`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `place` | `placeId` | 1→HYUGA, 2→NOBEOKAのPlace.idに変換 |
| `week` | `weekday` | 0-6→SUNDAY〜SATURDAY, 7→PUBLIC_HOLIDAY |
| `opentime`/`closetime`/`breaktime_op`/`breaktime_cl` | `openTime`/`closeTime`/`breakStart`/`breakEnd` | `"H:i"`文字列 → `TIME`型にパース。NULL/空文字はNULLのまま |
| `rsvlimit` | `reservationLimit` | NULLの場合は`0`にフォールバック(新設計はNOT NULL化のため) |
| `open` | `isOpen` | tinyint(1) → Boolean |

**移行前チェック**: 同一`(place, week)`の重複行がないか確認する(新設計で`@@unique([placeId, weekday])`を追加したため)。旧「初期設定」機能は全削除→8行再投入という手続きだったため、通常は重複しないはずだが、運用中の手動編集で重複が生まれていないか要確認。

---

## 4. `rsv_holiday` → `PublicHoliday`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `datetime` | `date` | UNIX秒(日付0時)→ `to_timestamp(datetime)::date` |
| `name` | `name` | そのまま |

**移行前チェック**: `date` に重複がないか確認する(新設計で`@unique`制約を追加)。CSV再投入運用(全削除→再投入)だったため通常は重複しないはずだが要確認。

---

## 5. `rsv_fix` → `Closure`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `place` | `placeId` | Place.idに変換 |
| `allday` | `isAllDay` | tinyint(1) → Boolean |
| `start`/`end` | `startTime`/`endTime` | `isAllDay=false`の場合のみ、UNIX秒から時刻部分を抽出。`isAllDay=true`の場合はNULL |
| `start`(日付部分) または `datetime` | `date` | 下記「終日休診の日付導出」参照 |

**終日休診(`allday=1`)の日付導出について(要注意)**:
旧スキーマは `start`/`end` が `DEFAULT NULL` の nullable カラムであり、終日休診行では `start`/`end` がNULLになっている可能性がある。新設計の `Closure.date` は必須項目のため、以下の優先順位で導出する:

1. `start` が非NULLなら `to_timestamp(start)::date`
2. `start` がNULLなら、旧`datetime`列(日付のみのUNIX秒、判定ロジックには未使用だが値自体は保持されている)から `to_timestamp(datetime)::date`

**移行前チェック**: 実際のデータで `allday=1` の行の `start`/`end`/`datetime` がどう埋まっているか事前にサンプリングし、上記のフォールバックで全行の日付を復元できるか確認する。

---

## 6. `rsv_datetime` → `ReservationSlot`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `place` | `placeId` | Place.idに変換 |
| `datetime` | `startAt` | `to_timestamp(datetime)` |
| `count` | `count` | そのままコピー |
| `fix` | (破棄) | 新設計では`count`と`BusinessHour.reservationLimit`から都度計算するため移行不要 |

**移行前チェック**: 同一`(place, datetime)`の重複行がないか確認する(新設計で`@@unique([placeId, startAt])`を追加)。旧実装の`regect()`はfind-or-create処理にロックを伴わないため、理論上は同時アクセス時に重複行が作られ得た。重複が見つかった場合は`count`を合算して1行にマージする方針を推奨(ただし合算後の`count`が実際の予約数と整合するかは`rsv_users`側との突き合わせで検証する)。

---

## 7. `rsv_users` → `Reservation`

| 旧カラム | 新カラム | 変換 |
|---|---|---|
| `place` | `placeId` | Place.idに変換 |
| `typeid` | `typeId` | そのまま |
| `typeid` | `durationMinutes` | 0→90, 1→60, 2→30 に導出(要件ドキュメント3-2節のマッピング) |
| `datetime_id` → 参照先`rsv_datetime.datetime` | `startAt` | 対応する`rsv_datetime`行の`datetime`を`to_timestamp()`変換 |
| (導出) | `endAt` | `startAt + durationMinutes分` |
| `name` | `name` | そのまま |
| `furikana` | `kana` | そのまま(カラム名のみ変更) |
| `tel` | `tel` | そのまま |
| `email` | `email` | そのまま |
| `address`/`sex`/`memo`/`time`/`type`/`datetime_id`自体 | (破棄) | 未使用確定済み(要件ドキュメント3-3節)、または導出可能なため非保持 |

**移行前チェック(重要度高)**:
- **`datetime_id` がNULLの行**: 旧スキーマは`datetime_id`を`DEFAULT NULL`許容している。対応する`rsv_datetime`が特定できない不整合データが存在する可能性がある。該当行は個別調査が必要(移行対象外にするか、`time`列の表示文字列から`startAt`を復元するか)。件数が少なければ手動確認、多ければ復元ロジックの追加を検討する。
- **`typeid` が0-2の範囲外の行**: 要件ドキュメントで「サンプル画面系typeid 1〜3(実運用外)」の存在が示唆されている。`rsv_users`に実際にそのような値が混入していないか事前に集計する。範囲外の値は`durationMinutes`が導出できないため、移行前に扱いを決める(除外する/デフォルト値を仮置きする等)。
- **`datetime_id`が指す`rsv_datetime`行が存在しない(参照整合性が壊れている)場合**: 移行スクリプトでJOIN失敗として検出し、個別対応する。

---

## 実行方針

1. 移行はNode.jsスクリプト(Prisma Client使用)として実装する。旧DBからは読み取り専用で直接接続するか、CSVエクスポートを経由するかは実装時に決定する。
2. 上記「移行前チェック」の項目はすべて**移行スクリプト内の事前検証ステップ**として実装し、異常データを検出した場合は移行を中断してレポートを出す(サイレントに間違った変換をしない)。
3. 本番データへの実行は必ずステージング環境でのリハーサル後に行う。移行スクリプトは冪等(同じデータに対して複数回実行しても安全)に作ることを推奨する。
4. 移行後、件数照合(旧DB各テーブルの行数 vs 新DB各テーブルの行数、除外した行数の内訳)をレポートとして出力する。

---

## 未決事項

- 旧DBへの接続方法(本番DBへの直接アクセス可否、エクスポート経由か)は移行スクリプト実装時に確認が必要。
- `password`ハッシュのNode側での検証可否(認証実装フェーズで検証)。
- 重複データ(`BusinessHour`, `PublicHoliday`, `ReservationSlot`)の実際の有無と件数は、本番データを実際に確認するまで不明。
