# 実装ノート

## ユーザーの指示

- ルーティン数は公式APIから取れないため表示を削除
- 左サイドバーの隙間（名前・Slackアプリを試すの上）に表示 → bottom:275px, left:8px
- v1.0.0 でストア説明文・README・リリースノート・アイコン・ストア画像を作成
- グラフをオシャレにしてほしい（モデル別色、スパイク表示）
- 履歴は1週間（20,160ポイント）
- Y軸上限を110%に（スパイクが見切れないよう）
- グラフ画面を大きく（780px→1500px試行→Chrome上限で断念）
- 土日・夜間（22:00〜07:00 JST）はグラフから除外
- アイコンクリックで全画面タブを開く
- 文字色を白くしてほしい

---

## 仕様書に書かれていなかった事項 / 判断・意思決定

### グラフの表示

**非線形タイムスケール**
- 土日・夜間(22:00-07:00 JST)を weight=0 でスキップ
- 活動時間(07:00-22:00)の15時間を1.0単位として仮想座標に変換
- ギャップをまたぐ線セグメント（x差 < 1px）は stroke をスキップして途切れを表現

**Chromeポップアップの幅制限**
- CSS で 1500px 指定しても Chrome が ~800px にキャップ
- 解決策：background.js の `chrome.action.onClicked` でタブとして開く
- タブモードでは `window.innerWidth - 40` を canvas 幅に適用

**スパイク閾値**
- delta ≥ 3% でドット表示、delta ≥ 5% でラベル表示
- 仕様に記載なし → ユーザー確認なしで判断

### パーサーロジックの重複

interceptor.js（MAIN world）と content.js（ISOLATED world）に同じ抽出ロジックが二重存在。
世界が異なるためモジュール共有不可（manifest の content_scripts は別ファイル必須）。
重複は許容し、変更時は両方に反映することとする。

---

## バグ修正の記録

### toPercent(1) = 100% バグ
- 原因：`v <= 1` を fraction 判定していたため、整数の `1` が `100%` に化けた
- 修正：`v < 1`（interceptor.js）、`n < 1`（content.js toPct2 文字列分岐）

### resetAt が undefined で自動再取得が無効だったバグ
- 原因：content.js の `parseS2` が `resetAt` を返していなかった
  （ISOLATED world の fetch は interceptor.js のパッチ対象外なので
  ポーリング結果に resetAt が入らなかった）
- 修正：`parseS2` に `rstAt2(rv)` を追加して `resetAt` を返すよう変更

### injected.js の放置（2026-06-22 削除）
- manifest.json に記載がなくどこからも読み込まれていないデッドコード
- 古い toPercent バグ・ルーティンロジックが残っており混乱の元
- → `git rm injected.js` で削除

### 二重イベント発火の無駄（2026-06-22 修正）
- `__cco_raw` → `__cco_probe_data` と CustomEvent を2段経由していた
- content.js 内部だけで完結する処理なので1つのハンドラに統合

---

## 技術的意思決定

| 項目 | 決定 | 理由 |
|------|------|------|
| Shadow DOM | 使用 | claude.ai の CSS に汚染されないよう |
| IndexedDB | 不使用、chrome.storage.local を使用 | 20,160件程度なら storage.local で十分 |
| canvas 2D API | 使用 | Chart.js 等は不要な大きさ、軽量実装優先 |
| 30秒ポーリング | 採用 | WebSocket は claude.ai の構造上難しい |
| JST (UTC+9) | ハードコード | ユーザーの日本語環境前提、Intl 未使用 |
| WEEKEND_W 削除 | 削除 | 土日完全スキップに変更したため定数不要に |
