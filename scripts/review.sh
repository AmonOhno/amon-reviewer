#!/usr/bin/env bash
# 観点MDを選び、Claude Code をヘッドレス（claude -p）で起動してレビュー結果を Markdown に書き出す。
#
# 環境変数:
#   DIFF_RANGE      レビュー対象の範囲（例: origin/main...HEAD）。必須
#   PERSPECTIVE     観点MDの名前（既定: ui-react）
#   OUTPUT          結果の出力先（既定: ./amon-review.md）
#   MAX_TURNS       セッションの最大ターン数（既定: 30）
#   ACTION_DIR      amon-reviewer のルート（既定: このスクリプトの親ディレクトリ）
#   REPO_DIR        レビュー対象リポのルート（既定: カレントディレクトリ）
#   PROJECT_CONTEXT 呼び出し元の前提（テストランナー・スタイリング・既存の規約など）。省略可
#                   省略した点は、Claude がリポジトリを読んで確認する
#
# 観点MDは「対象リポの .amon-reviewer/<名前>.md」→「amon-reviewer の perspectives/<名前>.md」の順に探す。
set -euo pipefail

die() {
  echo "amon-reviewer: $*" >&2
  exit 1
}

ACTION_DIR=${ACTION_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
REPO_DIR=${REPO_DIR:-$PWD}
PERSPECTIVE=${PERSPECTIVE:-ui-react}
OUTPUT=${OUTPUT:-$PWD/amon-review.md}
MAX_TURNS=${MAX_TURNS:-30}
DIFF_RANGE=${DIFF_RANGE:-}
PROJECT_CONTEXT=${PROJECT_CONTEXT:-}

# Claude に許可するのは読み取り系のツールだけ。書き込み・push・外部アクセスはさせない。
ALLOWED_TOOLS='Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*)'
DISALLOWED_TOOLS='Edit,Write,NotebookEdit,WebFetch,WebSearch'

[[ -n $DIFF_RANGE && $DIFF_RANGE != origin/...* ]] ||
  die "DIFF_RANGE が空です（pull_request イベント以外から呼ばれていませんか）"
[[ $PERSPECTIVE =~ ^[A-Za-z0-9_-]+$ ]] ||
  die "PERSPECTIVE には英数字・_・- だけを使えます: $PERSPECTIVE"
[[ $MAX_TURNS =~ ^[1-9][0-9]*$ ]] || die "MAX_TURNS は正の整数で指定してください: $MAX_TURNS"
command -v claude > /dev/null || die "claude コマンドが見つかりません"
command -v jq > /dev/null || die "jq コマンドが見つかりません"

if [[ -f $REPO_DIR/.amon-reviewer/$PERSPECTIVE.md ]]; then
  perspective_file=$REPO_DIR/.amon-reviewer/$PERSPECTIVE.md
elif [[ -f $ACTION_DIR/perspectives/$PERSPECTIVE.md ]]; then
  perspective_file=$ACTION_DIR/perspectives/$PERSPECTIVE.md
else
  die "観点MDが見つかりません: .amon-reviewer/$PERSPECTIVE.md / perspectives/$PERSPECTIVE.md"
fi

cd "$REPO_DIR"

# 差分がなければ何もしない（出力を空にして、投稿側でスキップさせる）。
set +e
git diff --quiet "$DIFF_RANGE" --
diff_status=$?
set -e
case $diff_status in
  0)
    echo "amon-reviewer: $DIFF_RANGE に差分がないため、レビューしません"
    : > "$OUTPUT"
    exit 0
    ;;
  1) ;;
  *) die "差分を取得できません: $DIFF_RANGE（actions/checkout で fetch-depth: 0 を指定していますか）" ;;
esac

# 観点MDの末尾に、呼び出し元の前提とレビュー対象の範囲だけを付け足す。調べ方はモデルに任せる。
prompt=$(
  cat "$perspective_file"
  printf '\n\n---\n\n## このリポジトリの前提\n\n'
  if [[ -n ${PROJECT_CONTEXT//[[:space:]]/} ]]; then
    printf '%s\n\n' "$PROJECT_CONTEXT"
    printf '上記に書かれていない点（テストランナー、スタイリングの方法、既存コンポーネントの規約など）は、リポジトリを読んで確認してください。\n'
  else
    printf 'レビューの前に、package.json・設定ファイル・既存の類似コンポーネント・CLAUDE.md などを読んで、テストランナー、スタイリングの方法、既存コンポーネントの規約を確認してください。\n'
  fi
  printf '指摘は、一般論ではなくこのリポジトリの前提と規約に照らして行ってください。\n'
  printf '\n## レビュー対象\n\n`git diff %s` で確認できる変更をレビューしてください。\n' "$DIFF_RANGE"
)

args=(
  -p "$prompt"
  --output-format json
  --max-turns "$MAX_TURNS"
  --allowedTools "$ALLOWED_TOOLS"
  --disallowedTools "$DISALLOWED_TOOLS"
)

raw=$(mktemp)
trap 'rm -f "$raw"' EXIT

echo "amon-reviewer: 観点 $perspective_file で $DIFF_RANGE をレビューします"
if ! claude "${args[@]}" > "$raw"; then
  cat "$raw" >&2 || true
  die "claude の実行に失敗しました"
fi

jq -e . "$raw" > /dev/null 2>&1 || die "claude の出力が JSON ではありません"
is_error=$(jq -r '.is_error // false' "$raw")
result=$(jq -r '.result // ""' "$raw")
if [[ $is_error == true || -z $result ]]; then
  die "レビュー結果を取得できませんでした（subtype: $(jq -r '.subtype // "?"' "$raw")、内容: ${result:-なし}）"
fi

turns=$(jq -r '.num_turns // "?"' "$raw")
cost=$(jq -r 'if .total_cost_usd then (.total_cost_usd * 100 | round / 100 | tostring) else "?" end' "$raw")

printf '## amon-reviewer\n\n%s\n' "$result" > "$OUTPUT"

echo "amon-reviewer: 結果を $OUTPUT に書き出しました（ターン数: $turns、コスト: \$$cost）"
