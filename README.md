# amon-reviewer

GitHub Actions 用 PR レビューミドルウェア。

PR が作られると Claude Code のセッションをヘッドレス（`claude -p`）で起動し、レビューを丸ごと任せて、結果を PR にコメントします。
amon-reviewer がするのは、セッションへの受け渡し（観点MD・呼び出し元の前提・レビュー対象の範囲）と、結果の投稿だけです。

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
| `context` | なし | 呼び出し元の前提（テストランナー、スタイリング、既存の規約など） |
| `github_token` | `github.token` | PR にコメントするためのトークン |

安全のため、セッションに許可するのは読み取り系のツール（Read / Grep / Glob / `git diff`・`log`・`show`）だけです。コメントは PR ごとに1件で、再実行すると上書きされます。

## 手元で試す

```bash
DIFF_RANGE=main...HEAD /path/to/amon-reviewer/scripts/review.sh   # 結果は ./amon-review.md
```

`claude` と `jq` が必要です。
