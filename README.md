# Claude Code Monitor

Claude.ai のサイドバーに Claude Code の使用状況をリアルタイム表示する Chrome 拡張機能です。

## 機能

| 項目 | 内容 |
|------|------|
| セッション使用率 | 5時間ウィンドウの使用済みパーセントをプログレスバーで表示 |
| 週間制限使用率 | 7日間・全モデル合計の使用済みパーセントをプログレスバーで表示 |
| リセット時刻 | 各制限のリセットまでの残り時間を自動計算・表示 |
| 警告色 | 70% 超でオレンジ、90% 超でレッド |
| ミニマイズ | ボタン1つでカードを折りたたみ（状態を記憶） |

## インストール

1. このリポジトリをクローンまたは ZIP でダウンロード
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を有効化
4. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択

## 動作環境

- Google Chrome（Manifest V3 対応）
- claude.ai にログイン済みであること

## 仕組み

```
interceptor.js  (MAIN world / document_start)
  └─ window.fetch と XHR をインターセプト
  └─ API レスポンスから rate_limits を抽出
  └─ CustomEvent で content.js へ通知

content.js  (ISOLATED world / document_idle)
  └─ Shadow DOM でオーバーレイカードを生成
  └─ 受信したデータをプログレスバーに反映
  └─ 初回ロード時に使用状況 API を能動的にプローブ
```

## プライバシー

外部サーバーへのデータ送信は一切行いません。すべての処理はブラウザ内で完結します。

## ライセンス

MIT
