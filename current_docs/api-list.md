# API一覧

この一覧はフロントエンド実装から読み取れる内容を整理したものです。定義元は主に [src/app/rsv.service.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/rsv.service.ts:1) です。

## 概要

|用途|拠点|メソッド|URL|
|---|---|---|---|
|予約枠取得|延岡|`POST`|`http://www.ozaki-contact.jp/rsvadmin/RsvNobeoka/index.json`|
|予約枠取得|日向|`POST`|`http://www.ozaki-contact.jp/rsvadmin/rsvHyuga/index.json`|
|予約確認メール送信|延岡|`POST`|`http://www.ozaki-contact.jp/rsvadmin/RsvNobeoka/confirm.json`|
|予約確認メール送信|日向|`POST`|`http://www.ozaki-contact.jp/rsvadmin/RsvHyuga/confirm.json`|

## 共通仕様

- HTTP クライアントは Angular `HttpClient` を使用。
- ヘッダは `Content-Type: application/json` を指定する実装です。
- 認証情報はすべての API に固定値で送信されています。
  - `username: "admin"`
  - `password: "yash7208"`
- 拠点の切り替えは `placeSet(place)` で行われます。
  - `place === "nobeoka"` のとき延岡向け URL
  - それ以外は日向向け URL

## 1. 予約枠取得 API

### URL

- 延岡: `http://www.ozaki-contact.jp/rsvadmin/RsvNobeoka/index.json`
- 日向: `http://www.ozaki-contact.jp/rsvadmin/rsvHyuga/index.json`

### 利用箇所

- [src/app/calender-form/calender-form.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/calender-form/calender-form.component.ts:31)
- [src/app/rsv.service.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/rsv.service.ts:85)

### リクエスト

`POST`

```json
{
  "username": "admin",
  "password": "yash7208",
  "typeid": "0"
}
```

### `typeid` の意味

`typeid` は来店経験の選択値で、画面から以下の値が設定されます。

|画面|値|表示文言|
|---|---|---|
|入口画面|`0`|一度も来店したことがない・わからない|
|入口画面|`1`|今月ははじめて来店する|
|入口画面|`2`|今月に来店した事がある|
|サンプル画面|`1`|新患|
|サンプル画面|`2`|準患|
|サンプル画面|`3`|再来|

実運用で使われているのは [src/app/entrance/entrance.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/entrance/entrance.component.ts:29) の `0` から `2` の系統です。`1` から `3` の系統は [src/app/sample-form/sample-form.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/sample-form/sample-form.component.ts:21) に残っています。

### レスポンス

実装上の型は `{"data": any[][]}` です。

```json
{
  "data": [
    [
      {
        "date": "7/7",
        "year": "2026年",
        "week": 2,
        "fix": false,
        "param": {
          "time": "09:00",
          "rsv": 5
        }
      }
    ]
  ]
}
```

### フロント側で参照している項目

|項目|用途|
|---|---|
|`data`|日ごとの配列|
|`items[0].week`|曜日表示、土日用 CSS 分岐|
|`items[0].date`|日付表示|
|`items[0].fix`|日曜扱いの CSS 分岐|
|`item.year`|予約日時文字列の生成|
|`item.param.time`|時間枠表示、予約日時文字列の生成|
|`item.param.rsv`|予約可否と残数表示判定|

### `param.rsv` の扱い

|値|画面上の扱い|
|---|---|
|`false`|予約不可|
|`1` から `3`|残りわずか|
|`4` 以上|予約可能|

選択時は `item.param.rsv !== false` のときだけ予約フォームへ進みます。

## 2. 予約確認メール送信 API

### URL

- 延岡: `http://www.ozaki-contact.jp/rsvadmin/RsvNobeoka/confirm.json`
- 日向: `http://www.ozaki-contact.jp/rsvadmin/RsvHyuga/confirm.json`

### 利用箇所

- [src/app/mailform/mailform.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/mailform/mailform.component.ts:70)
- [src/app/rsv.service.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/rsv.service.ts:102)

### リクエスト

`POST`

```json
{
  "username": "admin",
  "password": "yash7208",
  "typeid": "0",
  "typename": "一度も来店したことがない・わからない",
  "datetime": "2026年7/7 09:00",
  "name": "山田 太郎",
  "kana": "ヤマダ タロウ",
  "tel": "09012345678",
  "email": "example@ozaki.com"
}
```

### リクエスト項目

|項目|内容|入力元|
|---|---|---|
|`username`|固定認証値|サービス内固定|
|`password`|固定認証値|サービス内固定|
|`typeid`|来店経験コード|`HttpParams` の `type`|
|`typename`|来店経験の表示文言|フォーム `type`|
|`datetime`|予約日時|フォーム `datetime`|
|`name`|姓名を半角スペース結合|`name1 + " " + name2`|
|`kana`|セイメイを半角スペース結合|`kana1 + " " + kana2`|
|`tel`|電話番号|フォーム `tel`|
|`email`|メールアドレス|フォーム `email`|

### フロント側バリデーション

|項目|バリデーション|
|---|---|
|`kana1`, `kana2`|`^[ぁ-んァ-ン]+$`|
|`tel`|`^[0-9]+$`|
|`email`|Angular `Validators.email`|
|`privacy_check`|必須チェック|

注意点として、氏名系フィールドには `required` 属性はありますが、TypeScript 側で `Validators.required` は設定されていません。

### レスポンス

実装上は `{"data": any}` として保持され、完了画面では `confirm.data === true` のとき成功扱いです。

```json
{
  "data": true
}
```

`true` の場合は `http://www.ozaki-contact.jp/rsvcomplate/` にリダイレクトされます。`true` 以外は完了画面で失敗表示になります。

## 画面フローと API の対応

1. [src/app/entrance/entrance.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/entrance/entrance.component.ts:1) で拠点と来店経験を選択
2. [src/app/calender-form/calender-form.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/calender-form/calender-form.component.ts:1) で予約枠取得 API を呼ぶ
3. 時間枠選択後、[src/app/mailform/mailform.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/mailform/mailform.component.ts:1) で予約確認メール送信 API を呼ぶ
4. [src/app/result/result.component.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/app/result/result.component.ts:1) で送信結果を判定

## 補足

- 開発環境と本番環境で API の切り替えはしていません。[src/environments/environment.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/environments/environment.ts:1) と [src/environments/environment.prod.ts](/home/tlid042-kawano/projects/ozakicontact-reservation-ui/src/environments/environment.prod.ts:1) は `production` フラグのみです。
- `RsvHyuga` の予約枠取得 URL だけパスが `rsvHyuga` になっており、他は `Rsv...` です。実装上はこの文字列がそのまま使われています。
