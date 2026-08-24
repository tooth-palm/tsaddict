---
category: ライブラリ
tags:
  - TypeScript
  - Zod
  - スキーマバリデーション
  - ランタイム型検査
date: 2026-08-24
---

# Zod――実行時のデータとTypeScriptの型をつなぐ

## 1. 概要

### Zodは何をするライブラリか

Zodは、**実行時にデータを検査するスキーマ**をTypeScriptで定義し、そのスキーマから**静的な型を推論する**ライブラリである。

TypeScriptが型を保証できるのは、コンパイラが把握しているプログラムの内側だけだ。HTTPレスポンス、フォーム入力、環境変数、JSONファイル、メッセージキューなど、外部から入ってくる値は実行時にはただのJavaScriptの値である。Zodは、そのような「まだ信用できない値」をアプリケーション内部で安全に扱える値へ変換する境界を作る。

```ts
import * as z from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  age: z.number().int().nonnegative(),
  role: z.enum(["admin", "member"]),
});

type User = z.infer<typeof UserSchema>;

const input: unknown = JSON.parse(`{
  "id": "2c1d9c0f-26f7-4a93-b12e-27659f3f0832",
  "name": "Ada",
  "age": 36,
  "role": "admin"
}`);

const result = UserSchema.safeParse(input);

if (!result.success) {
  console.error(result.error.issues);
} else {
  const user: User = result.data;
  console.log(user.name);
}
```

ここで重要なのは、`input as User`のような型アサーションとは違い、実際の値を検査している点である。`safeParse`の結果は成功と失敗の判別可能なユニオンになり、成功側の`data`だけが`User`として扱える。例外を使いたい場合は`parse`、分岐として扱いたい場合は`safeParse`を選べる。非同期のrefinementやtransformには`parseAsync`または`safeParseAsync`を使う。基本APIの詳細は[Zod公式のBasic usage](https://zod.dev/basics)で確認できる。

Zodを一言で表すなら、単なる「入力チェック関数集」ではなく、**データ境界の契約を実行可能な値として表現するライブラリ**である。

## 2. 歴史――なぜ実行時スキーマが必要になったのか

### TypeScriptの型は実行時には消える

出発点にあるのは、TypeScriptの意図的な設計である。型注釈はコンパイル後のJavaScriptから消え、実行時の振る舞いを変えない。[TypeScript公式Handbook](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch)も、型はコンパイル後に消去され、実行時の型情報としては残らないと説明している。

```ts
type User = { id: string };

const response = await fetch("/api/user");
const value = await response.json();

// 型注釈を書いても、サーバーが返した値の検査にはならない
const user: User = value;
```

静的型付けによってアプリケーション内部の多くの誤りは防げる。しかし、ネットワークや永続化層を越えて来た値が宣言どおりであることまでは保証できない。この隙間を埋めるため、いくつかの方法が使われてきた。

### 手書きのチェックと型ガード

最も直接的なのは、`typeof`や`Array.isArray`を組み合わせた関数を書く方法である。

```ts
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}
```

依存を増やさず、小さな型なら十分に明快である。一方、ネスト、union、任意項目、エラー位置、値の変換まで扱うとコード量が急増する。さらに`User`型と`isUser`の実装が別々に存在するため、片方だけを変更する不整合も起こり得る。

### 外部仕様を中心にするJSON Schema

JSONの構造を言語非依存の文書として記述し、validatorやコード生成器で利用する方法も以前からある。API契約を複数言語で共有したり、スキーマをネットワーク越しに交換したりする用途では現在も強い。

ただし、TypeScriptアプリケーションから見ると、JSON SchemaとTypeScript型のどちらを正とするか、生成物をどう同期するかという問題が残る。また、JavaScript固有の値や任意の変換関数は、そのままJSON Schemaで表現できるとは限らない。

### JavaScript向けvalidatorとTypeScript向けruntime type

JavaScriptの世界ではJoiやYupのようなオブジェクトスキーマ型validatorが、宣言的な入力検査を扱いやすくした。その後、TypeScriptでは「ランタイム表現から静的型も導出する」という方向が重要になる。たとえばio-tsはcodecを静的型の実行時表現とし、decode・encode・type guardを扱う。[io-ts公式ドキュメント](https://gcanti.github.io/io-ts/)が示すように、`TypeOf`でcodecから型を取り出せるため、型と検査を二重定義せずに済む。

io-tsは関数型プログラミングのモデルとよく統合される一方、結果の`Either`やpeer dependencyの`fp-ts`を含む抽象化を理解する必要がある。そこでZodは、同じ「一度スキーマを書き、型を推論する」という解決を、メソッドチェーンと`parse`/`safeParse`による親しみやすいAPIに寄せた。

Zodの初期リリース以降、`safeParse`、refinement、transform、非同期検査などが追加され、Zod 3ではパーサーの構成が発展した。2025年に安定版となったZod 4では、長年の設計上の制約を解消するため内部と型定義が再設計され、Core、通常版、Miniという層が導入された。経緯と変更点は[Zod 4のリリースノート](https://zod.dev/v4)にまとまっている。

この流れを整理すると、Zodが解決しようとしたペインは次の3点に集約できる。

1. TypeScriptの型が消える実行時にも、外部データを検査したい。
2. 静的型とvalidatorを二重に保守したくない。
3. 日常的なTypeScriptコードの延長で、複雑な検査や変換を組み立てたい。

## 3. 比較――どのライブラリを選ぶか

ここでは、どれが常に優れているかではなく、設計上の重心が異なる3つを比較する。

| ライブラリ | GitHub Stars | 設計の中心 | 強い場面 | 主なトレードオフ |
| --- | ---: | --- | --- | --- |
| [Zod](https://github.com/colinhacks/zod) | 約43.5k | 開発者体験と汎用性の均衡 | 一般的なWeb/API/フォーム、共有スキーマ、広いエコシステム | メソッド中心の通常版はtree-shakingしにくい。JSON Schemaそのものが内部表現ではない |
| [Valibot](https://github.com/open-circle/valibot) | 約9.0k | 小さな関数の合成とtree-shaking | ブラウザ配布量を厳しく抑えたいアプリ | パイプと関数を組み立てる記法はZodと異なり、移行時に書き換えが要る |
| [ArkType](https://github.com/arktypeio/arktype) | 約7.8k | TypeScriptに近い型構文 | 複雑な型をTS風に簡潔に表現したい領域 | 独自の文字列構文・scopeモデルをチームで学ぶ必要がある |
| [TypeBox](https://github.com/sinclairzx81/typebox) | 約6.9k | JSON Schemaを型の実行時表現にする | 言語間の契約、OpenAPI/JSON Schema、スキーマ交換 | 表現と検査が分離しており、Zodのような一体型parse体験とは設計が異なる |

GitHub Starsは2026年8月24日時点で各公式リポジトリに表示された概数であり、継続的に変動する。認知度、コミュニティ規模、情報の見つけやすさを推測する一つの参考にはなるが、品質、保守状況、実プロジェクトへの適合性を直接示す指標ではない。採用判断では、設計上の適合性、release履歴、issueへの対応、周辺ツールとの互換性も併せて確認する必要がある。

### Valibotを選ぶ理由

Valibotは、スキーマや検査を独立した関数として提供し、`pipe`で組み合わせるモジュラー設計を採る。

```ts
import * as v from "valibot";

const UserSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
});

const result = v.safeParse(UserSchema, input);
```

公式サイトは、モジュラーAPIによりバンドルサイズが700 bytes未満から始まるとしている（実際のサイズは利用機能とビルド条件に依存する）。[Valibot公式サイト](https://valibot.dev/)が説明する通り、Zodとの最大の違いはtree-shakingしやすい関数単位の設計である。

クライアント側のフォーム検証を多数の画面へ配布する場合や、エッジ環境でサイズ制約が厳しい場合はValibotを選ぶ理由が明確になる。一方、通常のZodのチェーンAPI、既存のZod統合、チーム内の習熟度が価値を持つなら、サイズ差だけで移行を決めるべきではない。なおZod 4には同じ課題へ対応する`zod/mini`もあり、比較時には通常版だけでなくMiniも候補に含める必要がある。

### ArkTypeを選ぶ理由

ArkTypeは、TypeScriptの型に近い構文を実行時スキーマとして記述することに重心がある。

```ts
import { type } from "arktype";

const User = type({
  name: "string > 0",
  role: "'admin' | 'member'",
  "nickname?": "string",
});

type User = typeof User.infer;
const output = User(input);
```

[ArkTypeの公式入門](https://arktype.io/docs/intro/your-first-type)にあるように、unionや配列、optionalをTypeScriptに近い表現で書ける。複雑なunionや再利用可能な型語彙を多用し、Zodのbuilder呼び出しより型構文に寄せたいチームには魅力がある。scopeを使えば独自キーワードや循環するデータも体系的に扱える。

一方、文字列リテラル内のDSLとscopeという独自モデルは、TypeScriptそのものではない。エディタ支援は型レベルで提供されるが、チームにとってZodの明示的な関数・メソッドの方が読みやすい場合もある。選択基準は「コード量が短いか」より、「ドメインの型をどの記法で考えたいか」である。

### TypeBoxを選ぶ理由

TypeBoxは、TypeScript型を推論できるJSON Schemaオブジェクトを生成する。スキーマ表現とvalidationの実行を分けるのが中心原則である。

```ts
import Type, { type Static } from "typebox";
import Value from "typebox/value";

const UserSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
});

type User = Static<typeof UserSchema>;
const valid = Value.Check(UserSchema, input);
```

JSON Schemaを別サービスや別言語へ渡す、保存して後から読み込む、既存のJSON Schema validatorと組み合わせる、といった要件ではTypeBoxを選ぶ意味が大きい。作者も[TypeBoxのDiscussion](https://github.com/sinclairzx81/typebox/discussions/602)で、型の表現をJSON Schemaとし、検査器とは明確に分離することを中心原則として説明している。

Zod 4もJSON Schemaへの変換を標準で提供するが、transformのような任意関数は完全には表現できない。契約の唯一の正本がJSON SchemaであるべきシステムではTypeBox、アプリケーション内のparse体験や値の変換までを中心にするならZod、という切り分けが実務的である。

## 4. 特徴――Zodらしさはどこにあるか

### 4.1 schema-firstで型と検査の重複をなくす

```ts
const ProductSchema = z.object({
  id: z.string(),
  price: z.number().nonnegative(),
});

type Product = z.infer<typeof ProductSchema>;
```

スキーマを正本にし、型をそこから導くため、「interfaceは更新したがvalidatorを更新し忘れた」というずれを減らせる。これはValibot、ArkType、TypeBoxにも共通する現代的なruntime schemaの特性であり、Zodだけの独自性ではない。

Zodらしさは、その方針をTypeScriptのメソッドチェーン、オートコンプリート、広範な組み込みスキーマで一貫して提供する点にある。反対に、既存の複雑なTypeScript型を正本としてスキーマを自動生成したい場合、schema-firstは制約にもなる。TypeScriptの全型表現が実行時に対応するわけではないため、型からスキーマへの完全な逆変換は一般にはできない。

### 4.2 「validate」より「parse」

Zodの`parse`は、真偽値を返すだけではない。検査に成功した**出力値**を返す。入力と出力は同じとは限らない。

```ts
const PortSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

type PortInput = z.input<typeof PortSchema>;   // string
type PortOutput = z.output<typeof PortSchema>; // number
```

これは外部表現を内部表現へ正規化する境界として強力である。環境変数の文字列を数値へ変える、日付文字列を`Date`へ変える、APIの古い形式を新しい形式へ寄せる、といった処理を契約に含められる。

ただしtransformを増やしすぎると、スキーマが「データ形状の宣言」から「隠れた処理パイプライン」へ変わり、JSON Schema化も難しくなる。Zod 4の`overwrite`は、出力型を変えない正規化を区別し、イントロスペクション可能性を保つための仕組みである。この区別は[Zod 4リリースノート](https://zod.dev/v4#overwrite)で説明されている。

### 4.3 イミュータブルなスキーマ合成

Zodの`optional`、`extend`、`pick`、`omit`などは元のスキーマを書き換えず、新しいスキーマを返す。

```ts
const BaseUser = z.object({
  id: z.string(),
  name: z.string(),
});

const CreateUser = BaseUser.omit({ id: true });
const PublicUser = BaseUser.pick({ id: true, name: true });
```

同じ基本モデルから、作成入力、更新入力、公開レスポンスなどを派生できる。共有スキーマを変更した副作用で別の利用箇所が壊れるリスクを抑えやすい。一方、派生を何層も重ねると最終形が読み取りづらくなるため、ドメイン境界ごとに明示的な名前を付けることが重要である。

### 4.4 構造化されたエラー

失敗は単一の文字列ではなく、`code`、`path`、`message`などを持つissueの配列として得られる。これにより、フォームの各フィールドへエラーを対応させたり、APIのエラーレスポンスへ整形したりできる。

```ts
const result = UserSchema.safeParse(input);

if (!result.success) {
  for (const issue of result.error.issues) {
    console.log(issue.path.join("."), issue.code, issue.message);
  }
}
```

エラーの構造化自体は他ライブラリにもあるため、それだけをZod固有の優位性とは言えない。実務上の価値は、Zodのissue形式をフォームやRPCフレームワークなど周辺ツールが理解するエコシステムにある。ただしライブラリ固有のエラー形式をアプリケーション全体へ漏らすと移行コストが上がるため、境界で自前のエラー型へ変換する設計も検討したい。

### 4.5 通常版・Mini・Coreの三層

Zod 4では用途別に三つの層がある。

- `zod`: チェーン可能で、通常のアプリケーションに推奨されるAPI。
- `zod/mini`: 同等の機能を関数型APIで提供し、tree-shakingを重視する版。
- `zod/v4/core`: スキーマライブラリや統合を作る作者向けの基盤。

これは「使いやすいメソッドAPIはtree-shakingしづらい」というZodの弱点に対し、通常版の体験を捨てず別の表面APIを提供する設計上の回答である。[Zod Mini公式ドキュメント](https://zod.dev/packages/mini)は、通常版とMiniが同じCoreを共有しつつ、Miniではメソッドの代わりに関数を使うと説明している。

## 5. 仕組み――スキーマが値をparseするまで

### 全体像

Zodの処理は、概念的には次の流れで理解できる。

```text
スキーマ定義
  ↓
ZodTypeの木（object、string、union、arrayなど）
  ↓ parse(input)
各ノードが入力を走査し、型を検査
  ↓
checks / refinementsを適用
  ↓
transform / pipeで出力へ変換
  ↓
成功: 型付きの出力値 / 失敗: ZodErrorとissues
```

たとえば次のスキーマは、`object`を根、二つの`string`を子に持つ木として考えられる。文字列ノードには長さや形式のcheckが結びつく。

```ts
const AccountSchema = z.object({
  username: z.string().min(3),
  email: z.email(),
});
```

### `$ZodType<Output, Input>`

Zod 4の基盤では、すべてのスキーマが`$ZodType<Output, Input>`を継承する。`Input`と`Output`が別の型引数になっているため、検査だけでなく変換を型安全に表現できる。実装は[`core/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/schemas.ts)にあり、`$ZodType`に続いて文字列、数値、object、unionなどの各schemaが定義されている。

各スキーマは内部に定義情報を持つ。objectならプロパティごとの子スキーマ、arrayなら要素スキーマ、unionなら候補スキーマというように、複合スキーマは別のスキーマを参照する。parse時にはこの木をたどって結果を組み立てる。

### schemaとcheckの分離

Coreでは、値の基本的な種類を扱うschemaと、追加条件を扱うcheckが分かれている。

```ts
const NameSchema = z.string().min(1).max(100);
```

概念上、`z.string()`が文字列をparseするschema、`min(1)`と`max(100)`がparse後に実行されるcheckである。checkは推論型を変えず、条件違反ならissueを追加する。基底となる`$ZodCheck`と組み込みcheckの実装は[`core/checks.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/checks.ts)、通常版のチェーンAPIとCoreのcheckをつなぐ層は[`classic/checks.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/checks.ts)で確認できる。内部構造とcheck配列の概説は[Zod Core公式ドキュメント](https://zod.dev/packages/core)にもある。

refinementは組み込みcheckでは表現できないドメインルールを追加する。

```ts
const PasswordSchema = z
  .object({
    password: z.string().min(12),
    confirmation: z.string(),
  })
  .refine(
    (value) => value.password === value.confirmation,
    { path: ["confirmation"], message: "パスワードが一致しません" },
  );
```

### parseとsafeParseは同じ結果モデルの異なる入口

内部の検査で集められたissueがなければ出力値が返り、あればエラーになる。公開APIでは、その失敗を例外として表すのが`parse`、`{ success: false, error }`として表すのが`safeParse`である。Core側の入口は[`core/parse.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/parse.ts)、通常版のschemaメソッドへ公開する薄いラッパーは[`classic/parse.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/parse.ts)に分かれている。issueと`$ZodError`の定義は[`core/errors.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/errors.ts)を参照すると、成功・失敗がどの情報で表現されるかを追いやすい。

したがって選択基準は検査能力ではなく、呼び出し側の制御フローである。

- 「不正ならその処理を即座に中断する」境界では`parse`。
- ユーザー入力のように、失敗が通常の分岐である場所では`safeParse`。
- 非同期checkを含むなら、それぞれのAsync版。

### イントロスペクションとJSON Schema

スキーマの定義がデータとして保持されるため、Zod自身や外部ツールはスキーマを走査できる。Zod 4はこの仕組みとmetadata registryを使ってJSON Schemaを生成する。

```ts
const UserSchema = z.object({
  name: z.string().meta({ description: "表示名" }),
});

const jsonSchema = z.toJSONSchema(UserSchema);
```

metadataをスキーマ本体とは別のregistryへ置くことで、イミュータブルなスキーマと付加情報を関連付ける。実装を追う場合、registryは[`core/registries.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/registries.ts)、変換処理は[`core/to-json-schema.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/to-json-schema.ts)が入口になる。[Metadata and registries](https://zod.dev/metadata)と[JSON Schema変換の公式ドキュメント](https://zod.dev/json-schema)にも、この関係が詳しく説明されている。

ただし、任意のtransform関数は外から中身を解釈できない。Zodのスキーマがイントロスペクション可能であっても、すべてを標準的な宣言形式へ損失なく変換できるわけではない。この限界が、JSON Schemaを中心に据えるTypeBoxとの重要な設計差になる。

ここで示したGitHubリンクは現行の`main`ブランチを指している。最新実装を読むには便利だが、将来の変更で内容や配置が変わる可能性がある。特定バージョンの挙動を調査するときは、URLの`main`を利用中のリリースタグまたはcommit SHAに置き換えるとよい。

## 6. 公開されている実務事例

Zodの価値は、スキーマの書き方よりも「どの境界へ置き、失敗をどう運用するか」に現れる。ここでは、実際のプロダクト導入について具体的な経緯、判断、結果が公開されている企業記事を紹介する。

### NAVITIME――複数プロダクトでAPIと設定ファイルの境界を検査する

[「スキーマバリデーションライブラリZod ～君がくれたもの～」](https://note.com/navitime_tech/n/n4fc1cf9b71bf)は、ナビタイムジャパンが社内3〜4プロダクトへスキーマバリデーションを導入した経験をもとに、なぜ開発速度と品質の向上につながったかを説明している。

記事の題材は、ランキングAPIの`rank`をTypeScript上では`number`としたのに、実際のJSONでは`string`が返り、文字列順にソートされてしまった不具合である。型アサーションや戻り値の型注釈は実データを検査しないため、接続部分で不整合を見逃した。Zodを外部データの取得直後に置けば、利用箇所から離れた場所で症状が出る前に、配列の何番目のどのフィールドが違うかを検出できる。

実務上の要点は次の通りである。

- REST APIや設定ファイルなど、実行するまで値が分からない場所で使う。
- TypeScriptがすでに保証する静的な内部データまで検査せず、責務を重複させない。
- スキーマから型を推論し、型定義とvalidation定義の二重管理を避ける。
- 不具合を完全に消すだけでなく、発生場所を境界へ寄せて原因特定を速くすることにも価値がある。

本記事はZod 3時代のAPI例を含むが、「どこで検査するか」という設計判断はZod 4でも変わらない。セクション2で述べた型消去の問題が、実際にどのような不具合になるかを理解するのに適している。

### ONE CAREER――Sentryの実行時エラーを信頼境界の設計へ変える

[「TypeScriptとZodバリデーションの適切な使い分け」](https://note.com/dev_onecareer/n/n3559d3c4414e)は、React Nativeアプリで`company`を必須と定義していた一方、APIが`null`または`undefined`を返したことで発生したSentryエラーから始まる導入記録である。

特徴的なのは、単にZodを追加した成功談ではなく、コードレビューを通じた修正過程まで公開している点である。

- 内部で型付けされて生成するAPIリクエストにまでZodを適用し、過剰な二重検査になった。
- レスポンス内の利用する配列だけをparseしようとしたが、そのプロパティへアクセスする前のレスポンス全体が`unknown`であると気づいた。
- interfaceとZod schemaを別々に書いた後、`z.infer`を使うschema-firstへ変更した。
- バックエンド完成前は、合意したスキーマでモック自体をparseし、実APIへの切り替え後も同じ境界を使った。

運用面では、`safeParse`失敗時にZodのissueとendpointをSentryへ送り、安全なフォールバック値を返す設計を採っている。記事によれば、対象となった型関連エラーは導入前の7か月で33件発生していたが、Zod導入後の2か月は0件になった。一方、公開時点でZod化済みなのは全110 APIファイル中9件であり、既存領域へどう段階導入するかという課題も明記されている。

この事例から学べるのは、「parseに失敗させれば安全」というだけではない。失敗を監視へ送り、ユーザー体験を維持し、観測結果からバックエンドとの不整合を直すまでが実務上のvalidation設計である。

### Commune――Zod 3から4を段階的に移行する

[「Zodをv3からv4へアップグレードしました」](https://zenn.dev/dev_commune/articles/a0de3ec5e6589b)は、CommuneがバックエンドのAPIリクエスト・レスポンスとOpenAPI生成にZodを利用する環境で、Zod 3から4へ移行した記録である。

バリデーションの変更は本番障害につながり得るため、一括置換ではなく、一部モジュールでZod 4を先行利用し、数日間確認してから全体を移行している。当時利用していたZod 3が`zod/v4` subpathを同梱する3.25.0未満だったため、npm aliasでZod 3と4を共存させた点も具体的である。

この事例で特に重要なのは、Zod本体だけを見ても移行が完結しないことである。チームはZod schemaからOpenAPIを生成する`zod-to-openapi`も利用しており、その更新で`z.date()`から生成されるformatが変化した。さらにOpenAPIからフロントエンドのZod schemaを生成するOrvalへ変更が伝播し、日時文字列がdateとして検査されて失敗した。最終的にはバックエンド側で`date-time`を明示して整合させている。

実務上の教訓は次の通りである。

- validationライブラリのmajor updateは、通常の型エラー修正だけでなく実行時の受理条件を変え得る。
- ZodをOpenAPI、フォーム、RPCなどと連携すると、周辺ライブラリとの互換性もシステムの一部になる。
- aliasやsubpathによる共存と段階リリースは、影響範囲を観測しながら移行する手段になる。
- schema変換を連鎖させる場合、日付のような「似ているが同じではない表現」を往復させるテストが必要になる。

セクション4で触れたエコシステムの広さは利点だが、同時に結合点を増やす。この事例は、そのpros/consを実際のupgrade作業から理解できる資料である。

## 7. リポジトリ構成とソースコードの読み方

### Zod 4の主要なディレクトリ

Zodはmonorepoであり、本体のZod 4実装は[`packages/zod/src/v4`](https://github.com/colinhacks/zod/tree/main/packages/zod/src/v4)にある。学習時には、まず次の三層だけを把握すればよい。

```text
packages/zod/src/v4/
├── core/       # schema、check、parse、errorなど共有エンジン
├── classic/    # 通常版「zod」のチェーン可能なAPI
├── mini/       # tree-shakingを重視した関数型API
├── locales/    # エラーメッセージのロケール
└── index.ts    # v4の入口
```

`core`がvalidationの仕組みを持ち、`classic`と`mini`が異なる開発者向けAPIを載せる関係である。最初から全ファイルを読むより、公開APIからCoreへ一つの処理を縦に追う方が理解しやすい。

### 推奨する読解順

#### 1. 公開されるものを確認する

最初に[`classic/external.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/external.ts)と[`classic/index.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/index.ts)を見る。ここでは細部を読まず、通常の`import * as z from "zod"`からどのモジュールが公開されるかだけを把握する。

#### 2. `z.string()`から一つのschemaを作る流れを追う

次に[`classic/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/schemas.ts)で、利用者が触る`ZodType`、`ZodString`、`string()`などを見る。その後、対応する[`core/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/schemas.ts)の`$ZodType`と`$ZodString`へ移る。

ここでは全schemaを読む必要はない。まず文字列だけを選び、次の関係を確認する。

```text
classicのstring() / ZodString
  ↓ Coreを利用して使いやすいメソッドを提供
coreの$ZodString
  ↓ 入力の種類を検査
$ZodType<Output, Input>の共通モデル
```

#### 3. `min()`を題材にcheckを追う

文字列schemaが分かったら、`z.string().min(3)`を題材にする。[`classic/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/schemas.ts)のメソッドから[`classic/checks.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/checks.ts)、さらに[`core/checks.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/checks.ts)の`$ZodCheckMinLength`へ進む。schemaが値の種類、checkが追加制約を担当する分離が見えてくる。

#### 4. `safeParse()`の成功・失敗を追う

続いて[`classic/parse.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/parse.ts)から[`core/parse.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/parse.ts)を読む。`parse`と`safeParse`、同期版と非同期版が、別々のvalidation engineではなく、同じschemaの実行結果を異なる制御フローで公開していることを確認する。

失敗時のデータ構造は[`core/errors.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/errors.ts)へ進み、`$ZodIssue`と`$ZodError`を中心に読む。エラー整形の全機能は後回しでよい。

#### 5. objectで再帰的なschemaの木を見る

基本の一往復を理解した後、[`core/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/schemas.ts)へ戻り、`$ZodObject`がshape内の子schemaをどう処理するかを見る。次にarray、union、pipeの順で対象を広げると、Zodを「多数の独立したvalidator」ではなく「合成可能なschemaの木」として理解できる。

#### 6. ClassicとMiniを比較する

最後に[`mini/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/mini/schemas.ts)とClassicの同名ファイルを比較する。両者がCoreを共有しながら、Classicはインスタンスメソッド、Miniは関数による合成を公開する違いを確認する。これにより、Zod Miniが別のvalidation実装ではなく、tree-shakingしやすい別のAPI層であることが分かる。

### 目的別に次に読むファイル

| 理解したいこと | ファイル |
| --- | --- |
| schemaと入出力型 | [`core/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/schemas.ts) |
| 組み込み制約 | [`core/checks.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/checks.ts) |
| parseの公開方法 | [`core/parse.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/parse.ts) |
| issueとerror | [`core/errors.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/errors.ts) |
| metadata registry | [`core/registries.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/registries.ts) |
| JSON Schema生成 | [`core/to-json-schema.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/to-json-schema.ts) |
| 通常版の利用者向けAPI | [`classic/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/schemas.ts) |
| Miniの関数型API | [`mini/schemas.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/mini/schemas.ts) |

実装を読むときは、隣接する`tests`ディレクトリも利用できる。関心のあるAPI名を[`classic/tests`](https://github.com/colinhacks/zod/tree/main/packages/zod/src/v4/classic/tests)または[`core/tests`](https://github.com/colinhacks/zod/tree/main/packages/zod/src/v4/core/tests)から検索すると、仕様の具体例と境界条件を実装より短いコードで確認できる。本文を上から読んだ後は、`z.string().min(3).safeParse(value)`の一本だけをこの順序で追うと、セクション5の全体像を実際のコードへ結びつけやすい。

## まとめ

Zodを理解する鍵は、「TypeScriptにバリデーションを追加する道具」とだけ捉えないことである。

Zodは、外部の`unknown`な値と、アプリケーション内部の信頼できる型付きデータとの境界を作る。スキーマを正本にして型を推論し、検査だけでなく正規化・変換後の出力まで表現する。そのうえで、Zod 4ではCoreを共有する通常版とMiniにより、開発者体験と配布サイズという相反する要求へ対応している。

実務での選択は次のように整理できる。

- 汎用性、読みやすいチェーンAPI、周辺統合を重視するならZod。
- ブラウザの配布サイズを最優先するならValibot、またはZod Mini。
- TypeScriptに近い型構文で複雑な型を表したいならArkType。
- JSON Schemaをシステム間の正本にするならTypeBox。

そして、どのライブラリを使う場合でも最も重要なのは、すべての値を無差別に検査することではない。ネットワーク、ユーザー入力、設定、永続化といった**信頼境界で一度parseし、その内側では推論された型を信頼する**ことが、設計を単純に保つ基本となる。
