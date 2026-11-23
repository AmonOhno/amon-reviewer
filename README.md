# amon-reviewer

GitHub Actions 用 PR レビューミドルウェア。

レビュー観点を書いた Markdown（観点MD）を渡して Claude Code をヘッドレス（`claude -p`）で起動し、PR をレビューさせて結果をコメントします。
観点MDには観点と最低限の依頼だけを書き、どのファイルを読みどう深掘りするかはモデルに任せます。権限・投稿・上限はスクリプト側で固定します。

## 仕組み

1. 対象リポの workflow から `AmonOhno/amon-reviewer` を呼ぶ
2. `scripts/review.sh` が観点MDを選び、`claude -p` を起動する
    - Claude に許可するのは読み取り系のツール（Read / Grep / Glob / `git diff` / `git log` / `git show`）だけ
    - 差分だけでなく、仕様書や呼び出し元のコードも Claude が自分で読みに行く
3. `scripts/post-comment.sh` が結果を `gh` で PR にコメントする
    - 2回目以降は、新しく増やさずに前回のコメントを上書きする

## 使い方

1. 対象リポの Secrets に `ANTHROPIC_API_KEY` を登録する
2. [`examples/workflow.yml`](examples/workflow.yml) を対象リポの `.github/workflows/amon-reviewer.yml` に置く

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: AmonOhno/amon-reviewer@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    perspective: ui-react
```

### 入力

| 名前 | 既定値 | 説明 |
| --- | --- | --- |
| `anthropic_api_key` | （必須） | Anthropic の APIキー |
| `github_token` | `github.token` | PR にコメントするためのトークン |
| `perspective` | `ui-react` | 使う観点MDの名前 |
| `max_turns` | `30` | Claude Code セッションの最大ターン数 |
| `max_budget_usd` | なし | 1回のレビューにかけてよい上限金額（USD） |
| `model` | Claude Code の既定 | 使うモデル |
| `claude_code_version` | `latest` | インストールする Claude Code のバージョン |

### 観点MDの上書き

対象リポに `.amon-reviewer/<名前>.md` があれば、`perspectives/<名前>.md` より優先して使います。
アプリ固有の観点は、amon-reviewer ではなく各アプリのリポに置いてください。

## 手元で試す

```bash
# 今いるリポの main との差分をレビューする
DIFF_RANGE=main...HEAD PERSPECTIVE=ui-react /path/to/amon-reviewer/scripts/review.sh
cat amon-review.md
```

`claude` コマンドと `jq` が必要です。`ANTHROPIC_API_KEY` を設定するか、`claude` にログインしておいてください。

## 精度の検証

`eval/<観点>/<ケース名>/` に、問題を仕込んだ小さなサンプルPR（`fixture/`）と期待される指摘（`expected.md`）を置いています。
ui-react には、種類の違う部品（テキスト入力、ダイアログ、選択肢リスト、トースト通知）のケースがあり、観点MDの必須観点を分担して扱っています。

```bash
scripts/eval.sh            # すべてのケース
scripts/eval.sh ui-react   # 観点MDごと
```

結果は各ケースの `runs/<日時>.md` に保存されます。`expected.md` と見比べて、見逃しとノイズの件数を数えます。
ケースの書き方と、観点ごとの対応表は [`eval/README.md`](eval/README.md) にあります。

## 構成

```
amon-reviewer/
├─ action.yml                 # Composite Action の入口
├─ perspectives/
│   └─ ui-react.md            # 観点＋最低限の依頼
├─ scripts/
│   ├─ review.sh              # 観点MDを選んで claude -p を起動
│   ├─ post-comment.sh        # 結果を gh で PR に投稿
│   └─ eval.sh                # 精度検証ケースを手元で実行
├─ eval/
│   ├─ README.md              # ケースの書き方と観点の対応表
│   └─ ui-react/
│       └─ <ケース名>/         # 精度検証用のサンプルPRと期待される指摘
└─ examples/
    └─ workflow.yml           # 対象リポに置く workflow の見本
```
