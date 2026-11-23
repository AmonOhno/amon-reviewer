#!/usr/bin/env bash
# 精度検証ケースを手元でレビューさせる。
#
# 使い方:
#   scripts/eval.sh <観点>/<ケース名>      例: scripts/eval.sh ui-react/toast-notification
#
# 一時ディレクトリに「main（空）→ sample-pr（fixture を追加）」の Git リポジトリを作り、
# review.sh でレビューさせた結果を eval/<観点>/<ケース名>/runs/<日時>.md に保存する。
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
case_id=${1:-}
[[ $case_id =~ ^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$ ]] ||
  die "使い方: scripts/eval.sh <観点>/<ケース名>（例: ui-react/toast-notification）"

case_dir=$ACTION_DIR/eval/$case_id
[[ -d $case_dir/fixture ]] || die "fixture が見つかりません: $case_dir/fixture"
[[ -f $case_dir/expected.md ]] || die "expected.md が見つかりません: $case_dir/expected.md"
perspective=${case_id%%/*}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git_in_work() {
  git -C "$work" -c user.name=amon-reviewer -c user.email=amon-reviewer@localhost "$@"
}

git_in_work init -q -b main
printf '# sample\n' > "$work/README.md"
git_in_work add -A
git_in_work commit -q -m "base"
git_in_work checkout -q -b sample-pr
cp -R "$case_dir/fixture/." "$work/"
git_in_work add -A
git_in_work commit -q -m "sample pr"

mkdir -p "$case_dir/runs"
output=$case_dir/runs/$(date +%Y%m%d-%H%M%S).md

REPO_DIR=$work \
  ACTION_DIR=$ACTION_DIR \
  PERSPECTIVE=$perspective \
  DIFF_RANGE=main...HEAD \
  OUTPUT=$output \
  "$ACTION_DIR/scripts/review.sh"

echo
echo "結果:   ${output#"$ACTION_DIR"/}"
echo "正解:   ${case_dir#"$ACTION_DIR"/}/expected.md"
