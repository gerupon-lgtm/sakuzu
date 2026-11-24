# サクズ（sakuzu）実装ガイド（共通本文）

AGENTS.md（Codex）と CLAUDE.md（Claude Code）は、どちらもこのファイルを参照する。

## 概要

基準点から「距離と方向（直角の折れ点を含む）」と「二円交点」で点を決め、寸法の入った図面（車庫証明の配置図、店内の概要図）を作るPWA。点の求め方を手順として記録し、数値を直すと依存する点がすべて計算し直される。処理はすべてブラウザの中で行う。

## 前提（仮置き）

- 1つの図面で快適に扱える点の数は200点程度。数値を直してから描き直すまで100ms以内（docs/requirements.md の9章）
- 道路の線は、選んだ辺の両端から1mずつ延ばして描く（logic-design.md の SZ-L06）
- 図面の縮尺の候補は 1/20, 1/30, 1/50, 1/100, 1/150, 1/200, 1/250, 1/300, 1/500（SZ-L08）
- 「測り直す箇所の目安」は、ずれの向きとの角度の差が20°以内の辺とする（SZ-L05）
- アイコンは暫定値を使う

## 技術スタック

- 素のJavaScript（ES Modules）、SVG、CSS。ビルドの工程は入れない
- 共通にする候補の部品（幾何の計算、丸め、日付、印刷、寸法線、画面の部品、保存、PWA）は `src/shared/` に作る。仕様は sikumi-draw-core の設計書（docs/implementation-guide.md・tasks.md）に従い、あとで切り出せる形にする（C-04b）
- 保存: IndexedDB（図面は複数）。公開先: GitHub Pages（リポジトリ sakuzu、`sakuzu.sikumilab.com`）
- 書体: BIZ UDPゴシックを `fonts/` に同梱（docs/screens.md のデザイントークン）。CDNから読み込まない（C-01）
- テスト: `TZ=UTC node --test tests/`

## ディレクトリ構成

```
index.html / manifest.webmanifest / sw.js / CNAME
src/version.js      版の正典（APP_VERSION = "SZ-0.4.1"）
src/model/          図面のデータと再計算エンジン（DOMに触らない。テストする）
  document.js solver.js edit.js elements.js annot.js history.js
src/ui/             画面（一覧、作図、プレビュー、設定）
src/shared/         共通にする候補の部品（サクズ固有の処理を混ぜない。C-04b）
scripts/build-preview.mjs  動作確認用に1ファイルのHTMLへまとめる
tests/
docs/
```

## 規約

- 座標は数学の向き（x は右、y は上、単位はm）で持つ。画面への変換は共通モジュールの viewport だけで行う
- 計算と状態の変化は `src/model/` に置き、純粋な関数としてテストする。UIは model を呼ぶだけにする
- 長さは倍精度のまま計算し、表示するときだけ `util/round.js` で丸める
- エラーはコードで扱い、文言は `src/ui/messages.js` にまとめる
- コミットメッセージに、タスクID（`S-T05` など）を入れる

## バージョン管理

- 形式: `SZ-MAJOR.MINOR.PATCH`（現在 `SZ-0.4.1`）。PATCHは小さな修正、MINORは互換性のある機能の追加、MAJORは作業ファイルの互換性が壊れる変更。上位の数字を上げたら、下位は0に戻す
- 正典: `src/version.js`。反映先: フッタの表示、`sw.js` のキャッシュ名、作業ファイルの `appVersion`
- CI: `node scripts/check-version.mjs`（src/version.js と sw.js の版の一致、sw.js の事前キャッシュに src のファイルがすべて入っていること）を実行する。src にファイルを追加したら sw.js の FILES にも足す

## 日時・タイムゾーン

- 作成日: 日本時間のローカル日付を `yyyy-MM-dd` で保持し、`yyyy/MM/dd` で表示する（共通モジュールの `util/date.js`）
- 図面の更新日時（`updatedAt`）: UTCのISO 8601で保存する。一覧画面では、日本時間の `yyyy/MM/dd HH:mm` で表示する（`Intl.DateTimeFormat` に `timeZone: 'Asia/Tokyo'` を指定する）
- やってはいけないこと: 端末のローカル時刻で日付を決めること、文字列の日時を暗黙に解釈させること、`+09:00` を直接書き込むこと
- テスト: CIは `TZ=UTC` で実行し、UTCの14:59/15:00をまたぐケースを入れる

## 実装上の注意

- 手順は「前の手順だけを参照する」ように並べる。手順の並べ替えは、この制約を守る範囲でだけ許可する
- 数値を直したら、その手順より後ろだけを計算し直す（SZ-L03）
- 二円交点で選んだ側（左・右）は手順の中に保存し、数値を直しても変えない
- スマホでの選択: 当たり判定は半径24px。候補が重なったら、一覧から選べるようにする（共通モジュールの viewport）

## 変更禁止事項（根拠つき）

docs/requirements.md の0章に従う。
- A（画面の配置・文言・色など）は、発案者の指示ですぐに変えてよい。
- B（機能・既定値・許容値など）は、変えてよいが、requirements.md の改訂履歴に記録する。
- 次のCだけは、文書を改訂して合意してからでないと変えない。

| ID | 内容 | 理由 |
|---|---|---|
| C-01 | 図面のデータを外部へ送らない。CDNやアクセス解析を入れない。CSPに `connect-src 'self'` を設定する | 車庫証明の住所や店舗の情報を含むため |
| C-02 | 図面のデータをURLに入れない | 閲覧履歴やチャットのログに残るのを防ぐため |
| C-03 | 作業ファイルに `schemaVersion` と `appId: "sakuzu"` を持たせる。知らない版や別のアプリのファイルは読み込まず、既存の図面を変えない | データの消失を防ぐため |
| C-04b | `src/shared/` にサクズ固有の処理を混ぜず、`src/model/`・`src/ui/` を参照しない | ざっくり地積に着手するとき、そのまま切り出せるようにするため |

## 検証済みの事実

| 事実 | 確認方法 | 根拠 | 確認日 |
|---|---|---|---|
| GitHub Pages は、1つのリポジトリに独自ドメインを1つしか設定できない | 公式ドキュメント | GitHub Docs「Troubleshooting custom domains」（CNAMEファイルには1つのドメインだけ） | 2026-11-21 |

## 参照

- 要件: docs/requirements.md（機能IDの正典）
- 設計: docs/logic-design.md、docs/data-model.md、docs/screens.md、docs/tasks.md
- 共通モジュール: vendor/sikumi-draw-core/ と、そのリポジトリの docs/implementation-guide.md
