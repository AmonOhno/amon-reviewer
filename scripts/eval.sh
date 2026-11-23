#!/usr/bin/env bash
# 精度検証ケースを手元でレビューさせる。
#
# 使い方:
#   scripts/eval.sh                        すべてのケース
#   scripts/eval.sh <観点>                  その観点MDのケースすべて（例: ui-react）
#   scripts/eval.sh <観点>/<ケース名>        1ケースだけ（例: ui-react/dialog）
#
# ケースごとに、一時ディレクトリへ「main（base/ の中身）→ sample-pr（fixture/ を追加）」の Git リポジトリを作り、
# review.sh でレビューさせた結果を eval/<観点>/<ケース名>/runs/<日時>.md に保存する。
# ケースに context.md があれば、その内容を呼び出し元の前提（PROJECT_CONTEXT）として渡す。
# ない場合は、Claude がリポジトリ（base/ の内容）を読んで前提を確認する。
# 正解は同じフォルダの expected.md。何件拾えたか（見逃し）と、的外れな指摘の件数を見比べる。
#
# ANTHROPIC_API_KEY（または claude にログイン済みであること）が必要。
# MAX_TURNS・MAX_BUDGET_USD・CLAUDE_MODEL は review.sh にそのまま渡る。
set -euo pipefail

die() {
  echo "amon-reviewer: $*" >&2
  exit 1
}

ACTION_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EVAL_DIR=$ACTION_DIR/eval
target=${1:-}

[[ -z $target || $target =~ ^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?$ ]] ||
  die "使い方: scripts/eval.sh [<観点>[/<ケース名>]]"

# 対象のケース（eval/<観点>/<ケース名>）を集める。
cases=()
for dir in "$EVAL_DIR"/${target:-*}/ "$EVAL_DIR"/${target:-*}/*/; do
  [[ -f $dir/case.yml && -d $dir/fixture ]] || continue
  cases+=("${dir%/}")
done
((${#cases[@]} > 0)) || die "ケースが見つかりません: eval/${target:-*}"

tmp_root=$(mktemp -d)
trap 'rm -rf "$tmp_root"' EXIT

run_case() {
  local case_dir=$1
  local case_id=${case_dir#"$EVAL_DIR"/}
  local perspective=${case_id%%/*}
  [[ -f $case_dir/expected.md ]] || die "expected.md が見つかりません: $case_dir"

  local work
  work=$(mktemp -d "$tmp_root/case.XXXXXX")

  local -a git_in_work=(git -C "$work" -c user.name=amon-reviewer -c user.email=amon-reviewer@localhost)
  "${git_in_work[@]}" init -q -b main
  printf '# sample\n' > "$work/README.md"
  if [[ -d $case_dir/base ]]; then
    cp -R "$case_dir/base/." "$work/"
  fi
  "${git_in_work[@]}" add -A
  "${git_in_work[@]}" commit -q -m "base"
  "${git_in_work[@]}" checkout -q -b sample-pr
  cp -R "$case_dir/fixture/." "$work/"
  "${git_in_work[@]}" add -A
  "${git_in_work[@]}" commit -q -m "sample pr"

  mkdir -p "$case_dir/runs"
  local output
  output=$case_dir/runs/$(date +%Y%m%d-%H%M%S).md

  local context=
  if [[ -f $case_dir/context.md ]]; then
    context=$(cat "$case_dir/context.md")
  fi

  echo "=== $case_id ==="
  PROJECT_CONTEXT=$context \
    REPO_DIR=$work \
    ACTION_DIR=$ACTION_DIR \
    PERSPECTIVE=$perspective \
    DIFF_RANGE=main...HEAD \
    OUTPUT=$output \
    "$ACTION_DIR/scripts/review.sh"
  echo "結果: ${output#"$ACTION_DIR"/}"
  echo "正解: eval/$case_id/expected.md"
  echo
}

for case_dir in "${cases[@]}"; do
  run_case "$case_dir"
done
