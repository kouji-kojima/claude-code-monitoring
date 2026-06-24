# 実装ルール
## 仕様書に基づく実装と意思決定の記録
仕様書通りに実装すること。ユーザーからの指示も仕様書と同等に扱うこと。
`docs/implementation-notes` ファイルに以下を**すべて**残すこと。
### ユーザーの指示
- ユーザーからの指示をしっかりまとめて記録する
### 仕様書に書かれていなかった事項
- 判断・変更・妥協点・意思決定をすべて記録する
- 仕様書・指示から変更・逸脱した箇所とその理由
- 技術的な意思決定（ライブラリ選択、アルゴリズム選択など）
- 仕様・指示の曖昧さを解釈した箇所
`docs/implementation-notes` の形式は自由だが、後から見て経緯が分かるよう簡潔に残すこと。

# ストア説明文のルール
- 言語別ファイル：`docs/store/description_ja.txt` / `description_en.txt`
- 合体ファイル：`docs/store/description_all.txt`（日→英の順、`================================================================================` で区切り）
- 説明文を更新したときは **両方** 更新すること
## バージョン管理ルール
「バージョンを vX.Y.Z にして」と言われたら：
1. 現在のバージョンでタグを打つ
2. タグをプッシュ
3. manifest.json / README を新バージョンに更新
4. コミット・プッシュ
### 開発ブランチ運用
- **バージョンを上げたら、新バージョン名の `vX.Y.Z-features` ブランチを作成し、その後の開発はそのブランチで行う**（例：v6.1.0 にしたら `v6.1.0-features` ブランチを切って開発）。
## 仕様・指示の扱い方
- README.md に忠実に実装する
- 判断・変更はすべて docs/implementation-notes に追記
## サンプルデータのルール
- 人名はアメリカ人風英語名
- タスク名は架空のもの
## 画像・アイコン生成のルール
- 小サイズに日本語テキスト不可
- 英数字は DejaVu フォント
- 日本語大サイズは IPA ゴシック
---
紹介用 PPT にバージョン番号は載せない。
spPr に <a:effectLst> を重複させない。shape.shadow.inherit = False は空の <a:effectLst/> を1つ追加するので、その後に自前の outerShdw 入り effectLst を新規 append すると2個になり、CT_ShapeProperties のスキーマ違反で PowerPoint が「修復が必要／開けない」エラーを出す（python-pptx・zip 検証は通るので気づきにくい）。影は既存の effectLst を find して再利用し、無ければ作る方式にする（rect() 参照）。
検証のしかた：この環境の LibreOffice は壊れていて .txt すら変換できないため --convert-to pdf は使えない。代わりに pptx を unzip し、各 ppt/slides/slideN.xml の spPr 内 effectLst が1個以下・子要素順が xfrm→geom→fill→ln→effectLst であること、rPr 子要素順が fill→latin→ea→cs であること、全 XML パートが well-formed であることを xml.etree で機械チェックする。
