# amon-reviewer

GitHub Actions 用 PR レビューミドルウェア。

PR が作られると Claude Code のセッションをヘッドレス（`claude -p`）で起動し、レビューを丸ごと任せて、結果を PR にコメントします。
amon-reviewer がするのは、セッションへの受け渡し（観点MD・呼び出し元の前提・過去の知見の置き場所・レビュー対象の範囲）と、結果の投稿、知見の保存だけです。

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
| `knowledge_branch` | `amon-reviewer-knowledge` | 知見を貯めるブランチ。空にすると知見を貯めない |
| `github_token` | `github.token` | PR にコメントするためのトークン |

安全のため、セッションに許可するのは読み取り系のツール（Read / Grep / Glob / `git diff`・`log`・`show`）だけです。コメントは PR ごとに1件で、再実行すると上書きされます。

## 知見の蓄積

レビュー後に同じセッションを再開して要約を作り、呼び出し元リポの専用ブランチに貯めます。マージされたPRの知見だけが、次回以降のレビューで使われます。
仕組み・導入時の設定・運用ルールは [`docs/knowledge.md`](docs/knowledge.md) を読んでください。

## 手元で試す

```bash
DIFF_RANGE=main...HEAD /path/to/amon-reviewer/scripts/review.sh   # 結果は ./amon-review.md
# 知見を渡す・要約を作る場合は KNOWLEDGE_DIR・SUMMARY_OUTPUT を指定する
```

`claude` と `jq` が必要です。
