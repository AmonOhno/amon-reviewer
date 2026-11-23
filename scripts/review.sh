#!/usr/bin/env bash
# 観点MDを選び、Claude Code をヘッドレス（claude -p）で起動してレビュー結果を Markdown に書き出す。
#
# 環境変数:
#   DIFF_RANGE      レビュー対象の範囲（例: origin/main...HEAD）。必須
#   PERSPECTIVE     観点MDの名前（既定: ui-react）
#   OUTPUT          結果の出力先（既定: ./amon-review.md）
#   ACTION_DIR      amon-reviewer のルート（既定: このスクリプトの親ディレクトリ）
#   REPO_DIR        レビュー対象リポのルート（既定: カレントディレクトリ）
#   PROJECT_CONTEXT 呼び出し元の前提（省略可）
#   KNOWLEDGE_DIR   過去のレビューで得た知見のディレクトリ（省略可）。置き場所だけをセッションに伝える
#   SUMMARY_OUTPUT  指定すると、レビュー後に同じセッションを再開して知見の要約をここに書き出す（省略可）
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
DIFF_RANGE=${DIFF_RANGE:-}
PROJECT_CONTEXT=${PROJECT_CONTEXT:-}
KNOWLEDGE_DIR=${KNOWLEDGE_DIR:-}
SUMMARY_OUTPUT=${SUMMARY_OUTPUT:-}

# 安全のため、セッションには読み取り系のツールだけを許可する。
# PRの本文やコードに仕込まれた指示で、書き込み・push・トークンの持ち出しをされないようにするため。
ALLOWED_TOOLS='Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*)'
DISALLOWED_TOOLS='Edit,Write,NotebookEdit,WebFetch,WebSearch'

[[ -n $DIFF_RANGE && $DIFF_RANGE != origin/...* ]] ||
  die "DIFF_RANGE が空です（pull_request イベント以外から呼ばれていませんか）"
[[ $PERSPECTIVE =~ ^[A-Za-z0-9_-]+$ ]] ||
  die "PERSPECTIVE には英数字・_・- だけを使えます: $PERSPECTIVE"
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

has_knowledge=false
if [[ -n $KNOWLEDGE_DIR && -d $KNOWLEDGE_DIR ]] && find "$KNOWLEDGE_DIR" -name '*.md' -print -quit | grep -q .; then
  has_knowledge=true
fi

# レビューの進め方はセッションに任せる。渡すのは観点MD・呼び出し元の前提・過去の知見の置き場所・レビュー対象の範囲だけ。
prompt=$(
  cat "$perspective_file"
  if [[ -n ${PROJECT_CONTEXT//[[:space:]]/} ]]; then
    printf '\n\n## このリポジトリの前提\n\n%s\n' "$PROJECT_CONTEXT"
  fi
  if [[ $has_knowledge == true ]]; then
    printf '\n\n## 過去のレビューで得た知見\n\n`%s`\n' "$KNOWLEDGE_DIR"
  fi
  printf '\n\n## レビュー対象\n\n`git diff %s`\n' "$DIFF_RANGE"
)

session_args=(
  --output-format json
  --allowedTools "$ALLOWED_TOOLS"
  --disallowedTools "$DISALLOWED_TOOLS"
)
if [[ $has_knowledge == true ]]; then
  session_args+=(--add-dir "$KNOWLEDGE_DIR")
fi
args=(-p "$prompt" "${session_args[@]}")

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

# 知見の要約。レビューは済んでいるので、失敗してもレビュー自体は失敗させない。
if [[ -n $SUMMARY_OUTPUT ]]; then
  : > "$SUMMARY_OUTPUT"
  session_id=$(jq -r '.session_id // ""' "$raw")
  summary_raw=$(mktemp)
  summary_prompt='このレビューのやり取りで分かったことのうち、今後このリポジトリをレビューするときに役立つ知見を Markdown で要約してください。特になければ「なし」とだけ書いてください。'
  if [[ -z $session_id ]]; then
    echo "amon-reviewer: セッションIDが取れないため、知見の要約を省略します" >&2
  elif ! claude -p "$summary_prompt" --resume "$session_id" "${session_args[@]}" > "$summary_raw"; then
    echo "amon-reviewer: 知見の要約に失敗しました（レビューは完了しています）" >&2
  elif [[ $(jq -r '.is_error // false' "$summary_raw") == true ]]; then
    echo "amon-reviewer: 知見の要約に失敗しました（レビューは完了しています）" >&2
  else
    summary=$(jq -r '.result // ""' "$summary_raw")
    if [[ -n ${summary//[[:space:]]/} && $summary != なし ]]; then
      printf '%s\n' "$summary" > "$SUMMARY_OUTPUT"
      echo "amon-reviewer: 知見の要約を $SUMMARY_OUTPUT に書き出しました"
    else
      echo "amon-reviewer: 残す知見はありませんでした"
    fi
  fi
  rm -f "$summary_raw"
fi
