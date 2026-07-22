# API設計ドキュメント

対象: 公開予約API(Route Handlers)/ 管理画面API(Server Actions・Server Component)
参照要件: `docs/requirements/current-requirements.md`(特に A〜E 章、2章MVP範囲)
参照DB設計: `docs/design/db-schema.md`, `prisma/schema.prisma`
参照移行計画: `docs/design/data-migration.md`

本ドキュメントはAPIの**設計**を定めるものであり、`route.ts`/`actions.ts` 等の実装コードは含まない。Zodスキーマはリクエスト/レスポンスの型契約を示す設計用の記述であり、そのまま実装に貼り付けられることを意図したものではない。

---

## 背景

現行(Angular + CakePHP)は、予約枠取得・予約確定の両APIに実質機能しない固定認証情報を送信しており、公開/管理のスコープ分離もされていなかった(要件ドキュメント I章・J章)。また、キャンセル時の `fix` 無条件解除や `array_search()` の誤判定など、状態管理・同時実行制御に起因する実装バグが複数確認されている(要件ドキュメント 3-6, 3-7)。

新DB設計(`prisma/schema.prisma`)では `ReservationSlot.fix` を廃止し `count` と `BusinessHour.reservationLimit` の比較による都度判定に置き換えたが、これはAPI層のトランザクション設計が伴って初めて安全になる(`db-schema.md` 5章「リスク・技術的負債」で明記済み)。本ドキュメントはこの都度判定ロジックと、レースコンディションに強いトランザクション設計を確定させることを主目的とする。

---

## 要件との対応

| 要件ドキュメント該当章 | 本ドキュメントでの対応 |
|---|---|
| A章(予約枠取得・カレンダー表示) | 2.2節(空き状況取得API)、3章(判定ロジック設計) |
| B章(予約確定) | 2.3節(予約確定API)、4章(トランザクション設計) |
| C章(予約確認メール) | 7章(メール送信設計) |
| D章(予約キャンセル) | 5章(管理画面Server Actions) |
| E章(管理画面: 予約一覧) | 5章 |
| F章(管理画面: 基本設定) | 5章 |
| G章(管理画面: 不定休診管理) | 5章 |
| H章(祝日取込) | 5.5節(個別管理)+ 5.5.1節(CSV一括登録=全削除→再投入。US-010に追加、ADR 0002) |
| I章(認証・拠点管理) | 6章(認証・認可設計) |
| MVP範囲表(2章)推奨事項「濫用対策」 | 8章 |

---

## 1. 設計方針(全体)

- **公開予約フロー(空き状況取得・予約確定)は認証不要のRoute Handlers**として実装する。旧固定ID/PW認証は送信・検証とも廃止する(要件ドキュメント 3-4)。
- **管理画面の参照系はServer Component(直接Prisma参照)、更新系はServer Actions**として実装する。管理画面専用のRoute Handlers(`/api/admin/**`)は、本設計では原則設けない(理由は6章)。
- 空き状況は`ReservationSlot.count`と`BusinessHour.reservationLimit`から**都度計算**し、保存された可否フラグを持たない(DB設計の方針を踏襲)。
- 予約可否判定の順序は要件ドキュメントA章の「ラストオーダー制限 → 祝日判定 → 不定休・通常休診判定 → 予約枠使用状況判定」を厳守する。
- 営業時間9:00-18:30の外枠は、要件ドキュメント4章の確定事項どおり予約ロジック側でも維持する。
- `count`の増減は、予約確定・キャンセルの双方で**単一トランザクション内の条件付きアトミック更新**によって行い、行ロックの取得順序を固定してデッドロックを回避する(4章)。
- タイムゾーンは全処理でAsia/Tokyoを前提とする(移行計画ドキュメントの前提を踏襲)。

---

## 2. 公開API一覧(Route Handlers)

### 2.1 共通事項

| 項目 | 方針 |
|---|---|
| ベースパス | `/api/public/*`(管理画面用エンドポイントと明確に分離する。旧システムのJ章の問題(スコープ未分離)を再発させない) |
| 認証 | なし(6章で述べる濫用対策で保護する) |
| Content-Type | `application/json` |
| 日時表現 | リクエスト/レスポンスとも ISO 8601 文字列(例 `"2026-07-15T09:00:00+09:00"`)。日付単体は `"YYYY-MM-DD"` |
| 拠点指定 | `Place.code`(`"HYUGA"` / `"NOBEOKA"`)をクエリ/ボディで指定する。旧システムのように店舗別にURLを分けない(`RsvHyugaController`/`RsvNobeokaController`のような重複コントローラ構成を廃止し、`placeCode`パラメータで分岐する単一実装とする) |

#### 共通エラーレスポンス設計

```ts
// 型定義(設計用)
type ApiErrorCode =
  | "VALIDATION_ERROR"     // 400 リクエスト形式不正
  | "SLOT_UNAVAILABLE"     // 409 予約確定時、再検証の結果その枠が確保できなかった
  | "RATE_LIMITED"         // 429 レート制限超過
  | "NOT_FOUND"            // 404 存在しないリソースID指定
  | "INTERNAL_ERROR";      // 500 想定外エラー

type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;             // ユーザー向け・日本語の一般メッセージ
    reason?: string;             // SLOT_UNAVAILABLE時の内部理由(下記参照)。フロントは表示に使わずログ/デバッグ用途
    fieldErrors?: Record<string, string[]>; // VALIDATION_ERROR時のフィールド単位エラー(Zodのflatten相当)
  };
};
```

`SLOT_UNAVAILABLE` の `reason` は以下のいずれか(内部区分。フロントには一般文言「この時間帯は選択できなくなりました。再度お選びください。」のみ表示し、`reason`自体はログ/監視用):

`CAPACITY_FULL` / `LAST_ORDER_PASSED` / `HOLIDAY_CLOSED` / `CLOSURE` / `OUTSIDE_BUSINESS_HOURS`

HTTPステータスコード対応表:

| code | status |
|---|---|
| VALIDATION_ERROR | 400 |
| NOT_FOUND | 404 |
| SLOT_UNAVAILABLE | 409 |
| RATE_LIMITED | 429 |
| INTERNAL_ERROR | 500 |

---

### 2.2 空き状況取得 API

**`GET /api/public/availability`**

旧: `POST .../RsvHyuga/index.json`, `POST .../RsvNobeoka/index.json` に相当。GETに変更する(副作用のない取得操作のため。旧実装がPOSTだったのは固定認証情報をボディに載せる必要があったためで、認証廃止に伴い意味を持たない制約)。

#### リクエスト(クエリパラメータ)

```ts
const AvailabilityQuerySchema = z.object({
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.coerce.number().int().min(0).max(2), // 0=90分/1=60分/2=30分(要件3-2)
  // 省略時はJST当日。予約可能範囲は当日から21日先まで固定(要件A章)のためページングは設けない。
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
```

#### レスポンス

```ts
type SlotStatus = "AVAILABLE" | "FEW" | "UNAVAILABLE";
// AVAILABLE = 予約可能(○) / FEW = 残りわずか(△) / UNAVAILABLE = 予約不可

const AvailabilityResponseSchema = z.object({
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.number(),
  durationMinutes: z.number(), // typeIdから導出した所要時間(90/60/30)
  generatedAt: z.string(),     // このレスポンスを生成した時刻(ISO)。ラストオーダー判定の基準を明示するため
  days: z.array(
    z.object({
      date: z.string(),       // "2026-07-15"
      weekday: z.number(),    // 0(日)〜6(土)
      isPublicHoliday: z.boolean(),
      slots: z.array(
        z.object({
          time: z.string(),   // "09:00" (30分刻みの開始時刻)
          status: z.enum(["AVAILABLE", "FEW", "UNAVAILABLE"]),
        }),
      ),
    }),
  ),
});
```

備考:
- 旧レスポンスの `rsv`(生の数値)はフロントの3段階表示以外に用途がないため(要件3-1)、新設計では判定結果そのもの(`SlotStatus`)を返す。数値の残数そのものは業務上必要な情報として要件化されていないため返却しない(将来的に「残り◯件」等の表示要件が生じた場合は`remaining`フィールドの追加を検討。9章代替案参照)。
- 旧レスポンスの `fix`(日曜フラグ、CSS分岐用)は廃止し、`weekday`から表示側で判定する。

---

### 2.3 予約確定 API

**`POST /api/public/reservations`**

旧: `POST .../RsvHyuga/confirm.json`, `POST .../RsvNobeoka/confirm.json` に相当。

#### リクエスト

```ts
const CreateReservationSchema = z.object({
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.number().int().min(0).max(2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 開始日
  time: z.string().regex(/^\d{2}:\d{2}$/),        // 開始時刻 "09:00"(30分刻み)
  name: z.string().min(1).max(255),
  // 旧フロントの抜け(氏名系required未設定)は踏襲しない。氏名・カナとも必須とする(明示的な仕様改善。9章参照)。
  kana: z.string().min(1).max(255).regex(/^[ぁ-んァ-ン]+$/, "ひらがな/カタカナのみ"),
  tel: z.string().min(1).max(50).regex(/^[0-9]+$/, "数字のみ"),
  email: z.string().email().max(255),
  privacyAgreed: z.literal(true),
  // 濫用対策用ハニーポット。実在フォーム項目ではなく、bot埋め込み検知用の空フィールド(8章)。
  // 通常ユーザーには見えないUIとし、値が入っていた場合はbot疑いとして扱う。
  hpField: z.string().max(0).optional(),
});
```

#### レスポンス(成功時 201）

```ts
const CreateReservationResponseSchema = z.object({
  reservationId: z.number(),
  place: z.enum(["HYUGA", "NOBEOKA"]),
  typeId: z.number(),
  durationMinutes: z.number(),
  startAt: z.string(), // ISO
  endAt: z.string(),   // ISO
});
```

旧仕様の「`confirm.data === true` のときのみ完了画面へリダイレクト」という判定は、HTTPステータス(201=成功/4xx・5xx=失敗)に置き換える。旧固定リダイレクト先 `http://www.ozaki-contact.jp/rsvcomplate/` は新フロント側のルーティング設計に委ねる(本APIの関心事ではない)。

#### エラー時

- `400 VALIDATION_ERROR`: Zod検証失敗(必須未入力、カナ形式不正、メール形式不正等)。
- `409 SLOT_UNAVAILABLE`: 4章のトランザクション内で再検証した結果、当該区間が確保できなかった(満枠化・ラストオーダー超過・不定休登録・祝日設定変更など、GET取得後に状態が変化したケース)。
- `429 RATE_LIMITED`: 8章の制限超過。
- ハニーポット発火時: 8章の方針により、**見かけ上は成功(201)のレスポンスを返しつつ実際には永続化しない**(詳細は8章)。

---

## 3. 空き状況判定ロジック設計

### 3.1 事前準備(バッチ取得によるN+1回避)

21日 × 最大19枠(9:00〜18:00開始、30分刻み)= 最大399候補に対して枠ごとにDBへ問い合わせると重い。判定に必要なマスタ・実績データを**リクエスト単位で一括取得**し、以降は純粋な計算のみで判定する。

```ts
// 事前ロード(いずれもrangeは [today, today+20日])
const businessHours = await prisma.businessHour.findMany({ where: { placeId } }); // 全8曜日区分、高々8行
const holidays = await prisma.publicHoliday.findMany({ where: { date: { gte: rangeStart, lte: rangeEnd } } });
const closures = await prisma.closure.findMany({ where: { placeId, date: { gte: rangeStart, lte: rangeEnd } } });
const slots = await prisma.reservationSlot.findMany({ where: { placeId, startAt: { gte: rangeStart, lt: rangeEnd_plus_duration } } });
// slots は Map<startAtISO, count> に変換して以降O(1)参照する
```

### 3.2 1候補あたりの判定フロー(擬似コード)

要件A章の順序「ラストオーダー制限 → 祝日判定 → 不定休・通常休診判定 → 予約枠使用状況判定」を維持しつつ、候補生成段階での外枠フィルタを0番目の防御的チェックとして前置する。

```
function judgeCandidate(place, date, time, typeId, preloaded):
    startAt = toJst(date, time)
    duration = TYPE_DURATION[typeId]      // {0:90, 1:60, 2:30}
    endAt = startAt + duration分

    # 0. 候補生成範囲の外枠(要件4章 確定事項: 9:00-18:30を維持)
    #    BusinessHour.openTime/closeTime は業務設定上この範囲内に収まる想定だが、
    #    多枠またぎ(90分等)で終了時刻が範囲を超えるケースがあるため明示的に再チェックする。
    if startAt < OUTER_OPEN(date) or endAt > OUTER_CLOSE(date):
        return UNAVAILABLE(reason: OUTSIDE_BUSINESS_HOURS)

    # 1. ラストオーダー制限(拠点別: 日向5時間前 / 延岡1.5時間前)
    if startAt < preloaded.now + LAST_ORDER_HOURS[place]:
        return UNAVAILABLE(reason: LAST_ORDER_PASSED)

    # 2. 祝日判定(祝日マスタは拠点非依存、休診扱いにするかはBusinessHour(PUBLIC_HOLIDAY)側で拠点別)
    isHoliday = preloaded.holidays.has(date)
    bh = isHoliday
         ? preloaded.businessHours.find(weekday == PUBLIC_HOLIDAY)
         : preloaded.businessHours.find(weekday == dayOfWeek(date))
    if bh == null or bh.isOpen == false:
        return UNAVAILABLE(reason: HOLIDAY_CLOSED)  # 通常休診もこの分岐に含む(bh.isOpen=falseは両ケース共通)

    # 3. 不定休判定 + 通常営業時間・休憩時間判定
    for closure in preloaded.closures.where(date == date):
        if closure.isAllDay:
            return UNAVAILABLE(reason: CLOSURE)
        if overlaps([startAt, endAt), [closure.startTime, closure.endTime)):
            return UNAVAILABLE(reason: CLOSURE)

    if startAt < bh.openTime or endAt > bh.closeTime:
        return UNAVAILABLE(reason: OUTSIDE_BUSINESS_HOURS)
    if bh.breakStart != null and overlaps([startAt, endAt), [bh.breakStart, bh.breakEnd)):
        return UNAVAILABLE(reason: OUTSIDE_BUSINESS_HOURS)

    # 4. 予約枠使用状況判定(所要時間ぶんの複数30分枠すべてを判定)
    remaining = +Infinity
    for subSlotStart in stepBy30Min(startAt, duration):
        count = preloaded.slots.get(subSlotStart) ?? 0   # 行が無い = 未使用(count=0)
        r = bh.reservationLimit - count
        if r <= 0:
            return UNAVAILABLE(reason: CAPACITY_FULL)
        remaining = min(remaining, r)

    return remaining >= 4 ? AVAILABLE : FEW
```

### 3.3 3段階表示との対応、および旧仕様からの解釈変更点

要件3-1で確認された表示境界(`4以上`=予約可能、`1〜3`=残りわずか、`false`=予約不可)自体は維持するが、**判定に用いる値の意味を旧実装から変更する**。

- 旧実装 `rsvcheck()` は「区間内に `fix=true` の枠があれば不可」を判定した上で、表示用の数値としては**開始枠の`count`(生の使用数)をそのまま返す**か、枠が存在しなければ`rsvlimit`を返していた。この方式は「予約が入るほど数値が上がる(≒残数と直感的に逆方向になりうる)」「複数枠にまたがる場合でも開始枠1つの値しか見ていない」という2点で設計上わかりにくく、DB設計方針(`count`と`reservationLimit`の比較で都度判定)とも整合しない。
- 新設計では **`remaining = reservationLimit - count`(残数)を全対象サブ枠のうち最小値で算出**し、この残数に対して境界値(1-3/4以上)を適用する。これにより「表示上の境界ルール」は据え置きつつ、「複数枠のうち最も逼迫している枠を代表値とする」という、旧実装より安全側の判定に改める。
- この解釈変更は要件上の3段階表示の**境界値自体**(1-3/4以上)は変更しないため要件を満たすが、算出方法の変更が業務上許容範囲かどうかは11章「未決事項」に記載し、リリース前に業務側確認を推奨する。

### 3.4 パフォーマンス最適化(任意)

- 曜日全体が休診(`bh.isOpen=false`)、または終日不定休(`closure.isAllDay=true`)と判明した日は、その日の残り候補すべてを個別計算せず一括で`UNAVAILABLE`とする(3.2の2, 3を日単位に先出しして判定するショートサーキット)。MVPでは399候補程度であれば省略しても許容範囲だが、実装時の最適化候補として記載する。

---

## 4. 予約確定時のトランザクション設計

### 4.1 事前の方針

- **TOCTOU(検査から使用までの時間差)対策**: `GET /api/public/availability` で返した結果はクライアントの手元にある間に古くなりうる(他の利用者の予約確定、管理者による不定休追加等)。したがって `POST /api/public/reservations` では**クライアントの申告を信用せず、サーバー側で全判定ステップ(3章の0〜3)を送信時点のデータで再実行**する。
- 3章の判定のうち「祝日・不定休・営業時間」は管理者操作によってのみ変化し、変化頻度・同時実行の衝突可能性は低いため、**トランザクション開始前の通常のSELECTで再検証**すれば十分とする。
- 一方「予約枠の`count`(3章ステップ4)」は複数利用者が同時にリクエストしうる、衝突可能性が最も高い箇所であるため、**トランザクション内でのアトミックな条件付き更新**によって厳密に排他制御する。

### 4.2 処理フロー

```
1. リクエストのZod検証(2.3節) → 失敗なら400
2. ハニーポット検査(8章) → 発火時は永続化せず見かけ上success
3. レート制限検査(8章) → 超過なら429
4. 3章ステップ0〜3を再検証(祝日/不定休/営業時間/ラストオーダー) → 不可ならreasonを添えて409
5. Prisma インタラクティブトランザクションを開始
   for subSlotStart in stepBy30Min(startAt, duration) を startAt昇順で処理:
       # ON CONFLICT + WHERE句による単一アトミックSQLで「上限未満なら+1」を行う。
       # SELECT→比較→UPDATEの2ステップに分けないことで、チェックと更新の間の競合を構造的に排除する。
       affected = tx.$executeRaw`
         INSERT INTO reservation_slots (place_id, start_at, count, created_at, updated_at)
         VALUES (${placeId}, ${subSlotStart}, 1, now(), now())
         ON CONFLICT (place_id, start_at)
         DO UPDATE SET count = reservation_slots.count + 1, updated_at = now()
         WHERE reservation_slots.count < ${reservationLimit}
       `
       if affected == 0:
           throw SlotFullError(subSlotStart)  # トランザクション全体がロールバックされる
   tx.reservation.create({ ...予約者情報, startAt, endAt, durationMinutes })
6. コミット成功 → 201返却
7. コミット後(トランザクション外)にメール送信(7章)。メール失敗は201レスポンスに影響させない。
```

### 4.3 排他制御の選定根拠

| 選択肢 | 概要 | 採否 |
|---|---|---|
| **採用: `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` によるアトミック条件更新** | 単一SQL文でチェックと更新を不可分に行う。デフォルトのREAD COMMITTEDで安全に機能し、SERIALIZABLE特有のリトライ処理が不要 | 採用 |
| `SELECT ... FOR UPDATE` で行ロック後にアプリ側でカウント比較→UPDATE | Postgresの標準的な悲観ロック。動作はするが、行が存在しない(初回予約)ケースでは行ロック対象が無いため別途`INSERT ... ON CONFLICT DO NOTHING`との併用が必要になり実装が複雑化する | 不採用(採用案で同等以上の安全性をより単純に実現できるため) |
| `SERIALIZABLE`分離レベル + アプリ側リトライ | 最も強い一貫性保証だが、シリアライズ失敗(`40001`)時の再試行ループが必須になり複雑化する。多枠予約(最大3枠)の逐次更新と組み合わせるとリトライ設計がさらに煩雑になる | 不採用(9章) |
| 分散ロック(Redis等)による予約枠単位の明示ロック | インフラ追加コストが大きく、MVPの規模(2拠点・小規模同時アクセス)には過剰 | 不採用 |

### 4.4 デッドロック回避

90分予約は3つの連続する30分枠を占有する。2つの90分予約が異なる順序で枠を更新すると循環待ちが起こりうるため、**すべての予約確定・キャンセル処理は対象スロット群を`startAt`昇順で処理する**ことを設計上の必須ルールとする(4.2・5章キャンセル処理とも共通)。

### 4.5 `count`の非負制約

`db-schema.md`で推奨されている`CHECK (count >= 0)`をマイグレーションSQLに追加する方針を踏襲する。キャンセル時のデクリメントも「WHERE count > 0」を伴う条件付きUPDATEとし(5.2節)、CHECK制約は最終防衛ラインとして位置づける。

### 4.6 トランザクションタイムアウト

Prismaの`$transaction`はデフォルトタイムアウト(5秒)を持つ。最大3枠の逐次更新は通常この範囲に収まるが、DB負荷時の余裕を持たせるため`timeout`オプションの明示設定(例: 10秒)を実装時に検討する。

---

## 5. 管理画面: 参照系(Server Component)・更新系(Server Actions)

### 5.1 予約一覧参照(Server Component、更新系ではない)

Server Actionではなく、管理画面ページ(Server Component)内で直接Prismaを呼び出す。

```ts
// 入力
type GetReservationsByDateInput = { placeId: number; date: string /* YYYY-MM-DD (JST) */ };

// 出力(要件E章の表示項目に対応)
type ReservationListItem = {
  id: number;
  startAt: string;   // 表示: 予約時間
  endAt: string;
  name: string;      // 名前
  typeLabel: string; // 種別(typeIdからアプリ定数で導出。db-schema.md 3-7節方針)
  durationMinutes: number; // 予約詳細
  email: string;
  tel: string | null;
};
```

日付検索・前日/翌日移動は、ページのクエリパラメータ(`?date=YYYY-MM-DD`)としてURLに反映し、Server Componentが都度`placeId, date`で`Reservation.startAt`の範囲検索(`@@index([placeId, startAt])`を利用)を行う設計とする。

### 5.2 予約キャンセル(Server Action)

```ts
type CancelReservationInput = { reservationId: number };
type CancelReservationResult =
  | { ok: true; data: { reservationId: number } }
  | { ok: false; error: { code: "NOT_FOUND" | "UNAUTHORIZED" | "INTERNAL_ERROR"; message: string } };

async function cancelReservation(input: CancelReservationInput): Promise<CancelReservationResult>
```

処理方針:
1. `auth()`でセッション検証(6章)。未認証なら`UNAUTHORIZED`。
2. `Reservation`を`id`で取得。存在しなければ`NOT_FOUND`。
3. インタラクティブトランザクション内で、`startAt`/`endAt`から占有サブ枠を再計算し、**`startAt`昇順**で以下を実行:
   ```sql
   UPDATE reservation_slots SET count = count - 1, updated_at = now()
   WHERE place_id = $1 AND start_at = $2 AND count > 0
   ```
   影響行数が0(＝countがすでに0という理論上不整合な状態)の場合は、**キャンセル処理全体は中断せず**警告ログ(reservationId, placeId, startAtを含む構造化ログ)を出力した上で処理を継続する。旧実装のバグ(3-6)の再発防止が目的であり、万一データ不整合が起きても「予約を消せない」状態よりは「スタッフの目的(キャンセル)を達成しつつ異常を可観測にする」ことを優先する設計判断とする(11章に明記)。
4. `Reservation`行を削除。
5. コミット。
6. 対象ページを`revalidatePath`。

### 5.3 基本設定(BusinessHour)編集(Server Action)

「初期設定(全削除→0-7再投入)」はMVP対象外(要件2章)のため、**既存行の更新のみ**を対象とする。

```ts
const UpdateBusinessHourSchema = z.object({
  placeId: z.number().int(),
  weekday: z.enum(["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","PUBLIC_HOLIDAY"]),
  isOpen: z.boolean(),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  breakStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  breakEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reservationLimit: z.number().int().min(0),
}).refine(v => !v.isOpen || (v.openTime && v.closeTime), {
  message: "営業日の場合は開始・終了時刻が必須です",
}).refine(v => !v.openTime || v.openTime >= "09:00", {
  message: "開始時刻は9:00以降のみ設定できます", // 要件4章 確定事項(外枠9:00-18:30)をデータ入力時点でも強制する
}).refine(v => !v.closeTime || v.closeTime <= "18:30", {
  message: "終了時刻は18:30以前のみ設定できます",
});

async function updateBusinessHour(input: z.infer<typeof UpdateBusinessHourSchema>): Promise<ActionResult<{ id: number }>>
```

`@@unique([placeId, weekday])`があるため`upsert`で実装し、行が万一存在しない場合(データ不整合)でも編集操作から復旧可能にする。

外枠(9:00-18:30)を**入力時点のバリデーション**でも強制することで、3章判定ロジックのステップ0(防御的な再チェック)と二重に担保する設計とする。

### 5.4 不定休(Closure)登録・削除(Server Action)

```ts
const CreateClosureSchema = z.object({
  placeId: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isAllDay: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).refine(v => v.isAllDay || (v.startTime && v.endTime), {
  message: "終日休診でない場合は開始・終了時刻が必須です",
});

async function createClosure(input: z.infer<typeof CreateClosureSchema>): Promise<ActionResult<{ id: number }>>
async function deleteClosure(input: { closureId: number }): Promise<ActionResult<{ closureId: number }>>
```

### 5.5 祝日個別追加・削除(Server Action)— MVPスコープのギャップ対応

**設計判断: 祝日個別追加・削除のServer ActionをMVPスコープに含めることを推奨する。**

要件ドキュメント2章のMVP対象外表は「祝日CSV一括取込・全削除再投入」を明示的に対象外としているが、その代替として想定されている「UIでの個別追加編集」自体は、MVP対象表に独立した項目として明記されていない。しかし`PublicHoliday`をUIから一切編集する手段が無ければ、運用開始後に新しい祝日(例: 新設された祝日、閏年による移動祝日)が一件も登録できず、旧CSV運用より機能が後退する。これは「代替可能」という前提が崩れるギャップであり、単なる後回し可能な追加機能ではなく**MVPの前提条件**と判断する。

```ts
const CreatePublicHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().max(50).optional(),
});

async function createPublicHoliday(input: z.infer<typeof CreatePublicHolidaySchema>): Promise<ActionResult<{ id: number }>>
async function deletePublicHoliday(input: { holidayId: number }): Promise<ActionResult<{ holidayId: number }>>
```

`PublicHoliday.date`は`@unique`のため、重複登録時は`VALIDATION_ERROR`ではなく専用コード(`DUPLICATE_DATE`)を返す設計とする。拠点非依存(全拠点共有)である点は3-8節の確定事項どおりUI上も明示する(拠点セレクタを設けない)。

この判断自体は業務要件の追加であるため、正式なスコープ確定は製品オーナー確認が望ましい。11章「未決事項」に記載する。

### 5.5.1 祝日のCSV一括登録(全削除→再投入)— US-010 に追加(ADR 0002)

**設計判断: 祝日の CSV 一括登録を US-010 のスコープに追加する。挙動は旧 CakePHP 実装(`AdminController::holiday()`)と同一の「全削除→再投入(全置換)」とする。**

要件ドキュメント H 章(祝日 CSV 取込)は当初 MVP 対象外(user-stories.md US-022 = Won't「個別編集で代替」)としていたが、Product Owner の要望により US-010 に取り込む。年次の祝日をまとめて登録する運用を復活させるもので、対象 CSV は内閣府「国民の祝日・休日」フォーマット(ヘッダー行 `国民の祝日・休日月日,国民の祝日・休日名称`、データ行 `YYYY/M/D,名称`、UTF-8/CRLF、約 1067 行/26KB)。個別追加・削除(5.5 節)は残置し、本機能を追加する形とする。判断根拠・代替案は ADR 0002 参照。

#### 処理方式: Server Action(FormData で File を受け取る)

`/api/admin/**` の Route Handler は新設せず、5.5 節の 2 アクションと同じ層に Server Action を追加する(6 章「管理更新系は Server Action」方針を踏襲)。Next.js App Router の Server Action は `FormData` 経由で `File` を直接受け取れる。

```ts
// 設計用シグネチャ(実装コードではない)
async function importPublicHolidaysCsv(formData: FormData): Promise<ActionResult<{ importedCount: number }>>
// formData.get("file") が CSV File。requireAdminSession() を先頭で必須実行。
```

戻り値は既存 `ActionResult<T>` に統一。成功: `{ ok: true, data: { importedCount } }`。失敗: `VALIDATION_ERROR`(不正 CSV・上限超過・空ファイル。不正行の「行番号+理由」を `message` / `fieldErrors` 相当に集約)/ `UNAUTHORIZED` / `INTERNAL_ERROR`。CSV 固有の新規エラーコードは追加しない(全削除後に投入するため `DUPLICATE_DATE` は発生しない)。

#### CSV パース・検証方針(破壊前に全行検証=全か無か)

1. `File.text()` で UTF-8 として取得。先頭 BOM を除去。改行は CRLF/LF 双方許容。
2. 先頭行が既知ヘッダー、または 1 列目が日付として解釈できない行はヘッダーとしてスキップ。末尾空行は無視。
3. 日付 `YYYY/M/D`(0 埋めなし)を `^\d{4}/\d{1,2}/\d{1,2}$` で受理し、実在日(例 `2026/2/30` は不正)を検証のうえ `YYYY-MM-DD`(0 埋め)へ正規化。
4. 名称は 2 列目を `name`(50 文字上限、空は `null`)。
5. **全行を先に検証し、1 件でも不正(日付形式不正・実在しない日付・名称超過・ファイル内での日付重複)があれば DB を一切変更せず中断**し、不正行を報告する。部分投入・サイレントスキップは、全削除を伴い「祝日の静かな欠落」を招くため禁止。
6. ファイル内重複日付(`@unique` 違反要因)は検証段階で検出し中断(誤ファイルの兆候)。

#### トランザクション設計(全削除→再投入)

```ts
// 事前に全行検証済み・ファイル内重複排除済みの rows を投入する
await prisma.$transaction([
  prisma.publicHoliday.deleteMany({}),
  prisma.publicHoliday.createMany({ data: rows }),
]);
```

- 単一トランザクションのため `createMany` 失敗時は `deleteMany` もロールバックし、既存データは保持される。
- `skipDuplicates` は用いない(サイレントスキップを避ける。事前検証で重複は排除済み)。
- 成功後に `revalidatePath("/admin/holidays")`。
- **個別追加・削除(5.5 節)との整合性**: 同一 `PublicHoliday` テーブルの全置換。単一管理者・小規模運用のため一括取込中の個別操作との競合実害は低く、DB トランザクションの原子性により最終状態は一貫する(部分破損なし)。一括登録は排他的な破壊操作として UI に明示する(厳密な排他ロックは MVP では過剰とし未導入)。

#### 誤アップロード防御(上限)と UI 警告

- ファイルサイズ上限 1 MB、行数上限 10,000 行、空ファイル/データ 0 件は `VALIDATION_ERROR`(全削除のみ実行され祝日が空になる事故を防ぐ)。拡張子/Content-Type(`.csv`/`text/csv`)は補助チェック。
- UI: `/admin/holidays` に CSV 一括登録セクションを追加(別画面は設けない)。「既存の祝日データをすべて削除し CSV で置き換える」旨を常時警告表示し、実行前に確認ダイアログで現在件数・取込予定件数を提示して同意を取る。結果は取込件数 or 不正行一覧を表示する。

### 5.6 認可粒度(`AdminRole.ADMIN`/`AUTHOR`)

`db-schema.md`未決事項5で指摘されているとおり、旧実装での`role`使い分けの実態は不明である。本設計では**MVPでは`ADMIN`/`AUTHOR`を区別せず、認証済みAdminUserであれば全Server Actionを実行可能**とする。ただし将来の権限分離に備え、認可チェックは各Server Actionの先頭で呼び出す共通ヘルパー`requireAdminSession()`に集約し、将来的にロール別のガードを追加する際の変更点を1箇所に限定できる構成とする。11章に未決事項として記載する。

---

## 6. 認証・認可設計

### 6.1 構成

- Auth.js (NextAuth v5) を Credentials Provider + JWTセッションで構成する(`db-schema.md` 3-2節の方針どおり、DBアダプタ用テーブルは設けない)。
- ルート: `app/api/auth/[...nextauth]/route.ts` で`handlers.GET`/`handlers.POST`をエクスポートする。このルートのみ、公開APIのベースパス(`/api/public/*`)とは別に`/api/auth/*`として存在する。
- `authorize()`コールバックは`AdminUser`を`username`で検索し、`passwordHash`をbcrypt比較する。成功時は`{ id, username, role }`を返す。JWTコールバックで`role`をトークンに埋め込み、セッションオブジェクトにも公開する(ただしクライアント側のセッション情報は表示制御にのみ用い、認可の最終判断には使わない。6.3節)。

### 6.2 `middleware.ts` での保護範囲

```ts
// 設計方針の記述(実装コードではない)
matcher: ["/admin/:path*"]  // 管理画面ページ配下のみ保護対象とする
```

- 保護対象: `/admin/**`(ログインページ`/admin/login`自体は除外)。
- **保護対象外**: `/`、予約フロー用の利用者向けページ、`/api/public/**`(2章の公開API)、`/api/auth/**`。旧システムの「ルートURLが管理画面に直結している」という問題(要件J章)を踏まえ、公開/管理のスコープを`middleware.ts`のmatcherレベルで明示的に分離する。
- 未認証で`/admin/**`にアクセスした場合は`/admin/login`へリダイレクトする。

### 6.3 Server Action内での認可チェック方針

**`middleware.ts`のページ保護だけに依存しない。** Server Actionはページ遷移を経由せず直接呼び出される経路(例: フォームの再送、ブラウザの直接POST)が存在しうるため、**全てのServer Action(5.2〜5.5節)は関数本体の先頭で`auth()`を呼び出しセッションを検証する**ことを設計上の必須ルールとする。

```ts
async function requireAdminSession(): Promise<AdminSessionUser> {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  return session.user;
}
```

Server Component側の参照系(5.1節)も同様に、ページ自体が`/admin/**`配下でmiddleware保護されるが、直接データ取得を行う関数内でも念のため`auth()`を確認する二重防御を推奨する。

---

## 7. メール送信設計

### 7.1 タイミングと層

- 送信ロジックは`lib/mail/sendReservationConfirmation.ts`(仮称)としてRoute Handlerから分離した**サービス層関数**に切り出す。Route Handler(`POST /api/public/reservations`)は、4章のトランザクションが**コミットされた後**にこの関数を呼び出す。
- トランザクション内(DB操作の最中)でメール送信を行わない。メール送信の遅延・失敗がDBロックの保持時間に影響を与えないようにするため。

### 7.2 失敗時の扱い

- 要件C章「予約確定成功時のみメール送信する」は**送信条件**であり、「メール送信が失敗したら予約自体を失敗させる」ことを意味しない。
- **方針: メール送信は`try/catch`で保護し、失敗しても予約確定APIのレスポンス(201)には影響させない。** 失敗時は構造化ログ(reservationId、宛先ドメインなど個人情報を最小化した情報)を出力する。
- 予約データ自体は`Reservation`テーブルに確定保存されているため、管理画面の予約一覧(5.1節)が常に正となる。メール未達が疑われる場合はスタッフが一覧を確認し電話等でフォローする運用を前提とする(旧システムにも自動リトライ機構は無く、後退にはならない)。
- MVPでは自動リトライキュー(失敗メールの再送バッチ等)は設けない。将来的な拡張候補として11章に記載する。

### 7.3 送信内容・Bcc

- From/Bcc/件名は環境変数化する(`MAIL_FROM`, `MAIL_BCC`, `MAIL_SUBJECT`)。Bcc(`k-katsuki@menicon.co.jp`)は業務要件として継続必須(要件3-5)なため、環境変数の初期値として設定し、コード中にはハードコードしない。
- 本文には要件C章の記載項目(店舗名、予約日時、氏名、カナ、電話番号、メールアドレス、両店舗電話番号、キャンセル時の電話連絡案内)を含める。
- 実際に使用するメール配信手段(SMTP/Nodemailer、Resend、SESなど)は本ドキュメントのスコープ外とし、`sendReservationConfirmation(reservation): Promise<{ success: boolean }>`というインターフェース契約のみを定める(11章の未決事項)。

---

## 8. 濫用対策設計

対象は**認証を持たない公開API**(2.2, 2.3節)のみ。管理画面API(Server Actions)は6章の認証で保護されるため対象外とする。

### 8.1 ハニーポット(`POST /api/public/reservations`)

- フォームに実在の入力欄に見えない隠しフィールド(`hpField`)を設け、CSS等で視覚的に隠す(`display:none`ではなく`position:absolute; left:-9999px`等、単純なbot検出回避策への耐性を考慮した実装をフロント側で採用することを推奨)。
- 正規利用者はこの欄に入力しないため、値が入っていた場合はbotと推定する。
- **発火時の挙動**: 検知したことをbotに悟らせないため、**見かけ上は201 Createdの成功レスポンスを返しつつ、実際にはDBへの永続化・メール送信を一切行わない**(サイレントドロップ)。この判定と結果は構造化ログに記録し、後日の集計・チューニングに用いる。
- `GET /api/public/availability`は副作用のない参照APIのためハニーポットは設けない(8.2のレート制限のみで対応する)。

### 8.2 レート制限

| エンドポイント | 制限方針(目安。実運用時に調整) |
|---|---|
| `POST /api/public/reservations` | IPアドレス単位で厳しめ(例: 5回/分、30回/時間)。予約確定は業務上の実害(不正・迷惑データ)に直結するため優先度を高くする |
| `GET /api/public/availability` | IPアドレス単位で緩め(例: 60回/分)。通常のカレンダー操作でも複数回呼ばれうるため、UXを阻害しない範囲に設定する |

- 実装場所は`middleware.ts`ではなく**各Route Handler内**とする。理由: 対象を公開2エンドポイントに限定でき、認証済み管理画面へのアクセスにオーバーヘッド・誤爆リスクを与えないため。
- 制限超過時は`429 RATE_LIMITED`を返し、`Retry-After`ヘッダーを付与する。
- カウンタの保持先は、Vercel等のサーバーレス環境ではインスタンス間でメモリを共有できないため、**Redis等の外部ストアを前提とする設計**とする。具体的な実装ライブラリ(Upstash Redis + `@upstash/ratelimit`等)の選定は実装フェーズに委ねる。

### 8.3 その他の軽量対策

- `POST /api/public/reservations`では、`Origin`/`Referer`ヘッダーが自アプリのオリジンと一致するかを確認する簡易チェックを追加する(ブラウザ経由の単純なクロスサイト送信・スクリプト実行を阻止する補助策。ヘッダー偽装耐性は無いため主対策ではなく多層防御の一環と位置づける)。

---

## 9. 代替案(検討したが不採用のもの)

### 9-1. 空き状況APIのレスポンスに残数(`remaining`)を数値でそのまま含める案

3段階の`status`だけでなく、実際の残数(`remaining`件)をレスポンスに含める案も検討した。UIの表現力は上がるが、要件ドキュメントには「残数の具体的な数値表示」は業務要件として明記されておらず(3段階表示のみが確認済み仕様)、内部の予約上限運用のノウハウ(店舗が何件まで同時受付可能にしているか)が外部から推測可能になる懸念もある。MVPでは`status`の3値のみを返し、必要になれば後方互換的にフィールド追加できる設計としたため不採用とした。

### 9-2. `POST /api/public/reservations`の排他制御にSERIALIZABLE分離レベルを使う案

4.3節参照。実装がより複雑になる割に、採用案(`ON CONFLICT ... WHERE`によるアトミック更新)で同等の安全性をより単純に実現できるため不採用とした。

### 9-3. 予約確定・キャンセルを`/api/admin/*`のRoute Handlersとして統一実装する案

管理画面の更新系もRoute Handlersに統一し、公開APIと実装パターンを揃える案を検討した。しかし技術スタック決定時の方針(参照系Server Component/更新系Server Actions)に反し、Server Actionsで十分に要件を満たせるため不採用とした。ただし将来的に管理画面から外部システム連携(モバイルアプリ等)が必要になった場合は、Server Actionsのロジックをサービス層関数として共通化し、Route Handlersからも呼び出せる構成に拡張可能な設計としている(各Server Actionの本体をロジック層とAction本体に分離する実装方針を推奨)。

### 9-4. メール送信をキュー(外部ジョブ)経由にする案

Vercel等のサーバーレス環境での確実な非同期実行のために、キューサービス(例: QStash等)を導入し予約確定後に非同期でメール送信ジョブを積む案も検討した。信頼性は向上するが、MVPの規模ではインフラ追加コストに見合わないと判断し、7.2節の「同期実行+失敗ログ」方式を採用した。将来的にメール到達率が業務上の問題になった場合の拡張候補として残す。

---

## 10. リスク・技術的負債

- **判定ロジックの二重実装リスク**: 3章の判定ロジック(空き状況取得用)と4.2節の再検証ロジック(予約確定用)は、意図的に同一のルールセットを2箇所で評価する設計になっている。実装時にこの判定ロジックを共通の純粋関数(`judgeCandidate`)として1箇所に実装し、GET/POST両方から呼び出す設計にしないと、ロジックの乖離(片方だけ修正されるバグ)が発生しうる。実装フェーズでの徹底が必要。
- **レート制限用の外部ストア(Redis等)の追加**は、現時点でインフラ構成として確定していない。8.2節の設計はストアの存在を前提としており、選定・導入は別タスクとして残る。
- **祝日個別管理(5.5節)をMVPに含める判断**は、本ドキュメントでの設計判断であり、要件ドキュメントのMVP対象表を上書きする提案である。プロダクトオーナーの正式な承認を得るまでは暫定的な設計とする。
- **3.3節での`remaining`算出方法の変更**(旧実装の「開始枠のみのcount」から「区間内最小残数」への変更)は、表示境界値こそ維持するが算出過程は変更している。業務側が実際の残数体感と一致するかは運用開始後の確認が望ましい。
- **メール送信の到達性はMVPでは保証しない**(7.2節)。将来的に問い合わせ増加等の問題が顕在化した場合は9-4節のキュー方式を再検討する。

---

## 11. 未決事項

1. **祝日個別追加・削除(5.5節)をMVPスコープに正式に含めるかどうか**は、要件ドキュメントのMVP対象表と矛盾しない形でプロダクトオーナーの確認が必要。本設計では機能的な必要性から「含める」ことを推奨案として記載した。
2. **`AdminRole.ADMIN`/`AUTHOR`の権限差**(5.6節)は、旧実装での実態が不明なままMVPでは区別しないこととした。将来的に権限分離が必要になった場合の要件確認が別途必要(`db-schema.md`未決事項5から継続)。
3. **メール配信手段(SMTP/Resend/SES等)の選定**は本ドキュメントのスコープ外とし、サービス層のインターフェース契約のみ定義した。技術スタック決定タスクまたは実装フェーズでの確定が必要。
4. **レート制限の具体的なしきい値**(8.2節の「5回/分」等)は目安であり、実際の利用状況を見て運用調整が必要。
5. **空き状況判定の`remaining`算出方法変更(3.3節)が業務上許容されるか**は、リリース前に業務側への確認を推奨する。
6. **公開APIの`Origin`/`Referer`チェック(8.3節)を厳格化(例: 一致しない場合は拒否)するか、ログ記録のみに留めるか**は、正規のモバイルアプリ・外部連携等の将来利用を妨げないバランスを実装フェーズで検討する必要がある。
7. **祝日CSV一括登録(5.5.1節)の詳細**: 確認UIの強度(`window.confirm` か件数付きモーダル+同意)、文字コード自動判定(Shift_JIS対応)の要否、手動追加祝日を保持したい場合の差分マージ切替、上限値(1MB/10,000行)の運用調整は実装・運用フェーズで確定する(ADR 0002)。
