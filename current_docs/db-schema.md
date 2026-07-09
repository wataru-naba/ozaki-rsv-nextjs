# DB構成

`schema_ozdb.sql` をもとに、このリポジトリで扱うデータベース構成を整理したものです。  
DB には大きく分けて以下の 4 系統があります。

- WordPress 本体テーブル群: `oc_*`
- 予約システム本体: `rsv_*`
- 管理ユーザー: `users`
- マイグレーション管理: `phinxlog`

外部キー制約は定義されておらず、テーブル間の関連はカラム名とアプリケーション実装で管理される構成です。

## 全体像

### 予約システム

|テーブル|用途|主な関連|
|---|---|---|
|`rsv_datetime`|30分単位の予約枠。日時ごとの空き数・満枠状態を保持|`rsv_users.datetime_id` から参照される|
|`rsv_users`|予約者情報|`datetime_id` -> `rsv_datetime.id`|
|`rsv_inite`|曜日別・店舗別の営業設定|`place` で店舗識別、曜日ごとの営業可否や上限を保持|
|`rsv_fix`|臨時休診・特定時間帯の予約停止設定|`place` と `datetime` / `start` / `end` で制御|
|`rsv_holiday`|祝日マスタ|予約可否判定に利用|
|`users`|管理画面ログインユーザー|単独利用|

### WordPress

|テーブル|用途|主な関連|
|---|---|---|
|`oc_posts`|投稿・固定ページ・添付ファイルなどの本体|`oc_postmeta`, `oc_comments`, `oc_term_relationships`|
|`oc_postmeta`|投稿メタ情報|`post_id` -> `oc_posts.ID`|
|`oc_comments`|コメント本体|`comment_post_ID` -> `oc_posts.ID`, `user_id` -> `oc_users.ID`|
|`oc_commentmeta`|コメントメタ情報|`comment_id` -> `oc_comments.comment_ID`|
|`oc_terms`|用語マスタ|`oc_term_taxonomy`|
|`oc_term_taxonomy`|カテゴリ・タグなどの分類定義|`term_id` -> `oc_terms.term_id`|
|`oc_term_relationships`|投稿と分類の紐付け|`object_id` -> `oc_posts.ID`, `term_taxonomy_id` -> `oc_term_taxonomy.term_taxonomy_id`|
|`oc_termmeta`|分類メタ情報|`term_id` -> `oc_terms.term_id`|
|`oc_users`|WordPress ユーザー|`oc_usermeta`, `oc_posts`, `oc_comments`|
|`oc_usermeta`|WordPress ユーザーメタ|`user_id` -> `oc_users.ID`|
|`oc_options`|WordPress 設定値|単独利用|
|`oc_links`|旧来のリンク管理|単独利用|

### その他

|テーブル|用途|
|---|---|
|`phinxlog`|Phinx マイグレーションの実行履歴|

## 予約システム詳細

### `rsv_datetime`

予約枠テーブルです。1 レコードが 1 つの時刻枠を表します。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`datetime`|`int`|予約枠の基準日時。UNIX 時刻相当の整数運用と見られる|
|`fix`|`tinyint(1)`|満枠または使用不可フラグ|
|`count`|`int`|その枠を使用している予約件数|
|`place`|`int`|店舗ID|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

補足:

- 同じ予約が複数の 30 分枠を占有する前提です。
- `place` により店舗別の枠を分離しています。

### `rsv_users`

予約者テーブルです。1 件の予約申込を 1 レコードで保持します。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`datetime_id`|`int`|開始枠ID。`rsv_datetime.id` を参照|
|`time`|`varchar(255)`|表示用の予約日時文字列|
|`typeid`|`int`|予約種別ID|
|`type`|`varchar(255)`|予約種別名|
|`name`|`varchar(255)`|氏名|
|`furikana`|`varchar(255)`|フリガナ|
|`tel`|`varchar(50)`|電話番号|
|`address`|`varchar(255)`|住所|
|`email`|`varchar(255)`|メールアドレス|
|`sex`|`varchar(50)`|性別|
|`memo`|`text`|備考|
|`place`|`int`|店舗ID|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

### `rsv_inite`

曜日ごとの営業設定です。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`week`|`int`|曜日コード|
|`opentime`|`varchar(50)`|営業開始時刻|
|`closetime`|`varchar(50)`|営業終了時刻|
|`breaktime_op`|`varchar(50)`|休憩開始時刻|
|`breaktime_cl`|`varchar(50)`|休憩終了時刻|
|`rsvlimit`|`int`|同時予約上限|
|`open`|`tinyint(1)`|営業可否|
|`place`|`int`|店舗ID|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

### `rsv_fix`

臨時休診または一時的な予約停止枠です。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`datetime`|`int`|対象日|
|`start`|`int`|停止開始時刻|
|`end`|`int`|停止終了時刻|
|`allday`|`tinyint(1)`|終日停止フラグ|
|`place`|`int`|店舗ID|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

### `rsv_holiday`

祝日マスタです。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`datetime`|`int`|祝日の日付|
|`name`|`varchar(50)`|祝日名|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

### `users`

予約システム管理画面のユーザーです。

|カラム|型|内容|
|---|---|---|
|`id`|`int`|主キー|
|`username`|`varchar(50)`|ログインID|
|`email`|`varchar(50)`|メールアドレス|
|`password`|`varchar(255)`|ハッシュ化パスワード|
|`role`|`varchar(50)`|権限種別|
|`created`|`datetime`|作成日時|
|`modified`|`datetime`|更新日時|

## WordPress 詳細

### 投稿系

|テーブル|主キー|概要|
|---|---|---|
|`oc_posts`|`ID`|投稿、固定ページ、添付ファイルなどの本体|
|`oc_postmeta`|`meta_id`|投稿ごとの追加属性|
|`oc_comments`|`comment_ID`|投稿へのコメント|
|`oc_commentmeta`|`meta_id`|コメント追加属性|

主要な参照関係:

- `oc_postmeta.post_id` -> `oc_posts.ID`
- `oc_comments.comment_post_ID` -> `oc_posts.ID`
- `oc_commentmeta.comment_id` -> `oc_comments.comment_ID`
- `oc_posts.post_author` -> `oc_users.ID`
- `oc_comments.user_id` -> `oc_users.ID`

### 分類系

|テーブル|主キー|概要|
|---|---|---|
|`oc_terms`|`term_id`|分類語の基本情報|
|`oc_term_taxonomy`|`term_taxonomy_id`|分類種別ごとの定義|
|`oc_term_relationships`|`object_id`, `term_taxonomy_id`|投稿と分類の中間テーブル|
|`oc_termmeta`|`meta_id`|分類メタ情報|

主要な参照関係:

- `oc_term_taxonomy.term_id` -> `oc_terms.term_id`
- `oc_term_relationships.object_id` -> `oc_posts.ID`
- `oc_term_relationships.term_taxonomy_id` -> `oc_term_taxonomy.term_taxonomy_id`
- `oc_termmeta.term_id` -> `oc_terms.term_id`

### ユーザー・設定系

|テーブル|主キー|概要|
|---|---|---|
|`oc_users`|`ID`|WordPress ユーザー|
|`oc_usermeta`|`umeta_id`|ユーザーメタ情報|
|`oc_options`|`option_id`|サイト設定|
|`oc_links`|`link_id`|リンク管理|

主要な参照関係:

- `oc_usermeta.user_id` -> `oc_users.ID`

## エンジンと文字コード

- `oc_*` テーブルの多くは `MyISAM` / `utf8`
- 予約系テーブル `rsv_*` と `users` は主に `InnoDB` / `utf8mb4`
- `phinxlog` は `InnoDB` / `utf8`

このため、予約系と WordPress 系でトランザクション特性や文字コード設定が分かれている点に注意が必要です。
