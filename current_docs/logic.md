# 予約システム API ロジック解析

## 概要

このシステムは、店舗別コントローラが共通の予約ロジックを継承する構成です。

- 日向店舗: `src/Controller/RsvHyugaController.php`
- 延岡店舗: `src/Controller/RsvNobeokaController.php`
- 共通予約ロジック: `src/Controller/RsvController.php`
- 共通管理ロジック: `src/Controller/AdminController.php`
- 店舗別管理画面: `src/Controller/AdminHyugaController.php`, `src/Controller/AdminNobeokaController.php`

予約データは主に以下のテーブルで管理されています。

- `rsv_datetime`: 30分単位の予約枠。`datetime`, `count`, `fix`, `place` を保持
- `rsv_users`: 予約者情報。開始枠を `datetime_id` で参照
- `rsv_inite`: 曜日ごとの営業設定、休憩時間、予約上限
- `rsv_fix`: 不定休診日・不定休診時間
- `rsv_holiday`: 祝日マスタ

`rsv_datetime` と `rsv_users` の関連は `RsvDatetimeTable` の `hasMany('users')` で構成されています。

## 1. 予約枠の計算ロジック

### 入口

予約枠取得APIの入口は店舗別 `index()` です。

- `RsvHyugaController::index()`
- `RsvNobeokaController::index()`

どちらも最終的に `RsvController::get_rsv()` を呼び、予約枠一覧をJSONレスポンスとして返します。

### 基本パラメータ

`RsvController` では以下の基本値を持ちます。

- 営業時間の基準: `9:00` から `18:30`
- 枠の粒度: 30分
- 予約種別ごとの所要時間: `[90, 60, 30]`
- 取得対象日数: 21日先まで

店舗別差分は以下です。

- 日向: `_place = 1`, ラストオーダー制限 `_LO_TIME = 5時間`
- 延岡: `_place = 2`, ラストオーダー制限 `_LO_TIME = 1.5時間`

### 枠生成の流れ

`get_rsv()` は対象日から21日分、30分刻みの全候補時刻を順に評価します。

評価順は以下です。

1. ラストオーダー制限
2. 祝日判定
3. 不定休・通常休診判定
4. 予約枠使用状況判定

返却される各枠には以下の情報が含まれます。

- 日付
- 年
- 曜日
- 時刻
- `rsv`: 予約可否または現在の埋まり数相当の値

### ラストオーダー制限

`loCheck()` では現在時刻に `_LO_TIME` を加算し、その時刻より前の候補枠を予約不可とします。

つまり、当日直前の予約を店舗ごとの締切時間で制御しています。

### 祝日判定

祝日データは `rsv_holiday` から取得されます。祝日の営業可否は `rsv_inite` の `week = 7` 設定を使用します。

- 祝日設定が休診なら予約不可
- 営業設定なら通常判定へ進む

### 不定休・通常休診判定

`judgefix()` では `rsv_fix` を参照して不定休診を判定します。

- `allday = true`: 当日終日を予約不可
- `allday = false`: `start` から `end` の時間帯のみ予約不可

該当する不定休が無い場合は、曜日ごとの通常設定 `rsv_inite.open` を見て休診日を判定します。

### 通常の予約枠使用判定

`rsvcheck()` は予約種別ごとの所要時間を使って、開始枠から終了枠までの使用状況を確認します。

まず以下を満たす場合は予約不可です。

- 営業開始前
- 営業終了後
- 休憩時間帯の内部

その上で `rsv_datetime` から対象区間の枠を取得し、以下の判定を行います。

- 区間内に `fix = true` の枠が1つでもあれば予約不可
- 開始時刻の枠があればその `count` を返す
- 開始時刻の枠が無ければ `rsv_inite.rsvlimit` を返す

この `fix` は「その枠が満枠扱いか」を表すフラグとして使われています。

## 2. 予約確定処理

### 入口

予約確定APIの入口は店舗別 `confirm()` です。

- `RsvHyugaController::confirm()`
- `RsvNobeokaController::confirm()`

POST時に `RsvController::save_data()` を呼び出します。

### 入力値の処理

`save_data()` では以下を行います。

- `typeid` から所要時間を決定
- `datetime` を開始時刻として解釈
- 所要時間を加算して終了時刻を算出
- `rsv_users` 登録用の予約者データを生成

保存用データには以下が含まれます。

- 氏名
- 種別ID
- 種別名
- 表示用予約時間
- カナ
- 電話番号
- メールアドレス
- 店舗ID
- 開始枠ID (`datetime_id`)

### 登録処理本体

登録処理は `regect()` で行われます。

処理の流れは以下です。

1. 開始から終了までを30分刻みで走査
2. 各時刻の `rsv_datetime` を検索
3. 既存枠があれば `count` を加算
4. 曜日設定の `rsvlimit` に達したら `fix = true`
5. 枠が無ければ新規作成
6. 全区間で問題なければ `rsv_datetime` を保存
7. 最後に `rsv_users` を1件保存

既存枠が `fix = true` の場合は、その時点で登録中断となります。

### データ更新の意味

この設計では、1件の予約者が複数の30分枠を占有します。たとえば90分予約なら3枠を連続で使用します。

- `rsv_users` は予約者を1件保持
- `rsv_datetime` は占有された各時刻枠ごとの利用数を保持

開始時刻に対応する `rsv_datetime.id` が `rsv_users.datetime_id` に保存されるため、管理画面からキャンセル対象の開始枠を辿れます。

## 3. キャンセル処理

### 入口

キャンセル処理は利用者向けAPIではなく管理画面から実行されます。

- 予約一覧の「キャンセル」ボタン
- `AdminHyugaController::delete()`
- `AdminNobeokaController::delete()`

共通処理は `AdminController::delete_rsv()` です。

### 処理内容

`delete_rsv($id, $uid)` では以下を行います。

1. `rsv_datetime` から開始枠を取得
2. `rsv_users` から対象予約者を取得
3. `typeid` から所要時間を算出
4. 開始時刻から終了時刻までの全枠を再取得
5. `rsv_users` を削除
6. 各 `rsv_datetime.count` を `-1`
7. `fix = true` の枠は `false` に戻す

結果として、キャンセル時は以下が同時に更新されます。

- 予約者レコード削除
- 使用中だった各30分枠の利用数減算
- 満枠フラグ解除

### 注意点

現在の実装では `fix` を無条件で `false` に戻しています。別の予約が残っていて本来まだ満枠である場合でも解除される可能性があります。

## 4. メール通知

### 実際に使われている通知処理

予約登録成功後、`save_data()` から `sedding()` が呼ばれます。

メール送信条件:

- `regect()` が成功し、戻り値が `_OK` の場合のみ送信

送信内容:

- From: `norepry@ozaki-contact.jp`
- To: 予約者のメールアドレス
- Bcc: `k-katsuki@menicon.co.jp`
- Subject: `予約確認メール | おざきコンタクト`

本文には以下を含みます。

- 店舗名
- 予約日時
- 氏名
- カナ
- 電話番号
- メールアドレス
- 両店舗の電話番号
- キャンセル時は電話連絡する案内

### 使われていないメール処理

別途 `MailController` と `MailComponent` が存在しますが、現在の予約確定フローからは参照されていません。

そのため、運用上の予約通知本体は `RsvController::sedding()` です。

## 5. 管理画面機能

### 予約一覧

店舗別管理画面の `index()` では対象日の予約一覧を表示します。

機能:

- 日付検索
- 前日/翌日の移動
- 予約者情報の一覧表示
- キャンセル実行

表示項目:

- 予約時間
- 名前
- 種別
- 予約詳細
- Email
- TEL

### 基本設定

`setting()` では `rsv_inite` を表示し、曜日ごとの営業設定を確認できます。

`settingEdit()` および `edit_inite()` では以下を編集します。

- 曜日
- 営業日/休診日
- 診察時間
- 休憩時間
- 各時間帯の予約上限

### 初期設定

`initSetting()` から `init()` を呼ぶと、対象店舗の `rsv_inite` を一度削除してから0から7までの曜日設定を再投入します。

`week` の意味:

- `0-6`: 日曜から土曜
- `7`: 祝日

### 不定休診日管理

`irregularDate()` で `rsv_fix` の一覧を表示します。

`irregularDateAdd()` と `add_fix()` では以下を登録できます。

- 終日休診
- 時間帯休診

`irregularDateDelete()` と `delete_fix()` で削除できます。

### 祝日取込

`holiday()` では `csv/syukujitsu.csv` を読み込み、`rsv_holiday` を全削除したうえで再投入します。

このため、祝日マスタはCSV主導で再生成する設計です。

## 6. 店舗別の差分

日向と延岡で管理・予約の機能構造は同一です。主な差分は以下です。

- `place` の値
- ラストオーダー制限時間
- メール本文中に参照する店舗名表示

## 7. ルーティング

`config/routes.php` では `/` が `AdminHyuga::index` に接続されています。

そのため、このリポジトリは現状以下の性質を持ちます。

- ルートURLは管理画面トップ
- 予約APIはコントローラ名ベースのURLに依存
- 公開API専用のスコープ分離は未実施

## 8. 実装上の懸念点

### `array_search()` の戻り値判定

`array_search()` の戻り値 `0` を偽扱いしている箇所があります。

- 祝日判定
- 開始枠検索

先頭要素ヒット時に誤判定する可能性があります。

### キャンセル時の `fix` 解除

キャンセル時に `fix` を無条件で `false` に戻しており、他予約が残るケースで満枠状態を正しく維持できない可能性があります。

### `rsv_users` バリデーションが緩い

`RsvUsersTable` の主要バリデーションがコメントアウトされており、入力値品質の担保が弱い状態です。

## 9. 参照ファイル

- `src/Controller/RsvController.php`
- `src/Controller/RsvHyugaController.php`
- `src/Controller/RsvNobeokaController.php`
- `src/Controller/AdminController.php`
- `src/Controller/AdminHyugaController.php`
- `src/Controller/AdminNobeokaController.php`
- `src/Controller/Component/RsvcalcComponent.php`
- `src/Model/Table/RsvDatetimeTable.php`
- `src/Model/Table/RsvUsersTable.php`
- `src/Model/Table/RsvIniteTable.php`
- `src/Model/Table/RsvFixTable.php`
- `src/Model/Table/RsvHolidayTable.php`
- `src/Template/AdminHyuga/index.ctp`
- `src/Template/AdminHyuga/setting.ctp`
- `src/Template/AdminHyuga/irregular_date.ctp`
- `config/routes.php`
