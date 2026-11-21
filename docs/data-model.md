# データモデル（サクズ）

サーバーにはデータを持たない（C-01）。

## 図面（Drawing）— IndexedDB と作業ファイルで同じ形

| 項目 | 型 | 説明 |
|---|---|---|
| appId | `"sakuzu"` | 別のアプリのファイルを取り違えないため（C-03） |
| schemaVersion | number | 最初は1 |
| appVersion | string | 例: `SZ-0.1.0` |
| id | string | UUID |
| name | string | 図面の名前（一覧に表示する） |
| updatedAt | string | 更新日時。UTCのISO 8601 |
| steps | Step[] | 手順の列（順番が計算の順番） |
| lines | {id, points: 点ID[], closed, closure?: {stepId, choice: "keep"\|"pending"}}[] | 線と閉合 |
| rooms | {id, name, points: 点ID[]}[] | 部屋 |
| roads | {id, edge: [点ID, 点ID], width, name, flip}[] | 道路 |
| dims | {id, a, b, offset, auto, stepId?}[] | 寸法 |
| texts | {id, x, y, text, size}[] | 文字（座標はm） |
| north | {x, y, angleDeg} \| null | 北の記号 |
| sheet | {paper: "A4"\|"A3", orientation: "portrait"\|"landscape", unit: "m"\|"mm", title, createdDate: "yyyy-MM-dd", author} | 図面の設定。作成日は日本時間の日付 |

### Step

| 種類 | 項目 |
|---|---|
| 共通 | id（点IDを兼ねる）、type、label（P1, P2…。自動で振る） |
| base | x, y |
| polar | from, ref: [id, id] \| null, turn: "L"\|"R"\|"S", angleDeg, d, isClosing?: boolean |
| circles | a, da, b, db, side: "L"\|"R"\|null（null は候補を選ぶ前） |

- 計算結果（座標・状態）は保存せず、読み込んだときに計算し直す。保存した値と計算結果が食い違わないようにするためである。
- 作業ファイル: 拡張子は `.sakuzu.json`【想定】。

## IndexedDB（DB名 `sakuzu`）

| ストア | キー | 内容 |
|---|---|---|
| drawings | id | 図面。変更のたびに、少し待って（500ms）保存する |
| prefs | `"defaults"` | 許容値（m、初期値0.03、範囲0〜0.10）、既定の表示単位、作成者名 |

- 図面の削除は、確認してから行う。端末の中では、削除した図面は戻せない（書き出したファイルからは戻せる）。
- 保存に失敗したら警告を出し、作業ファイルの書き出しを促す。
