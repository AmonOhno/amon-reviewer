# amon-reviewer

GitHub Actions 用 PR レビューミドルウェア。

観点MD（レビュー観点を書いた Markdown）を渡して Claude Code をヘッドレス（`claude -p`）で起動し、PR をレビューさせて結果をコメントします。
どのファイルを読みどう深掘りするかはモデルに任せ、権限と投稿はスクリプト側で固定します。

## 使い方

対象リポの Secrets に `ANTHROPIC_API_KEY` を登録し、[`examples/workflow.yml`](examples/workflow.yml) を `.github/workflows/` に置きます。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: AmonOhno/amon-reviewer@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

| 入力 | 既定値 | 説明 |
| --- | --- | --- |
| `anthropic_api_key` | （必須） | Anthropic の APIキー |
| `perspective` | `ui-react` | 観点MDの名前。対象リポの `.amon-reviewer/<名前>.md` があればそれを、なければ `perspectives/<名前>.md` を使う |
| `context` | なし | 呼び出し元の前提（テストランナー、スタイリング、既存の規約など）。書かなかった点は Claude がリポジトリを読んで確かめる |
| `max_turns` | `30` | Claude Code セッションの最大ターン数 |
| `github_token` | `github.token` | PR にコメントするためのトークン |

Claude に許可するのは読み取り系のツール（Read / Grep / Glob / `git diff`・`log`・`show`）だけです。コメントは PR ごとに1件で、再実行すると上書きされます。

## 手元で試す

```bash
DIFF_RANGE=main...HEAD /path/to/amon-reviewer/scripts/review.sh   # 結果は ./amon-review.md
scripts/eval.sh                                                    # 精度検証（eval/README.md）
```

`claude` と `jq` が必要です。
