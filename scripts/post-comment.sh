#!/usr/bin/env bash
# review.sh の結果をPRにコメントする。以前の amon-reviewer のコメントがあれば、新しく増やさずに上書きする。
#
# 環境変数:
#   REVIEW_FILE        review.sh が書き出した Markdown。必須（空ならコメントしない）
#   PR_NUMBER          PR番号。必須
#   GITHUB_REPOSITORY  owner/repo。必須（GitHub Actions では自動で入る）
#   GH_TOKEN           PRにコメントできるトークン。必須
set -euo pipefail

die() {
  echo "amon-reviewer: $*" >&2
  exit 1
}

REVIEW_FILE=${REVIEW_FILE:-}
PR_NUMBER=${PR_NUMBER:-}
GITHUB_REPOSITORY=${GITHUB_REPOSITORY:-}

[[ -n $REVIEW_FILE ]] || die "REVIEW_FILE が指定されていません"
[[ $PR_NUMBER =~ ^[0-9]+$ ]] || die "PR_NUMBER が不正です（pull_request イベント以外から呼ばれていませんか）: ${PR_NUMBER:-空}"
[[ -n $GITHUB_REPOSITORY ]] || die "GITHUB_REPOSITORY が指定されていません"
command -v gh > /dev/null || die "gh コマンドが見つかりません"

if [[ ! -s $REVIEW_FILE ]]; then
  echo "amon-reviewer: レビュー結果が空のため、コメントしません"
  exit 0
fi

# 自分のコメントを見分けるための目印。
MARKER='<!-- amon-reviewer -->'
# GitHub のコメントは 65,536 文字まで。余裕を見てバイト数で切り詰める。
MAX_BYTES=60000

body=$(mktemp)
trap 'rm -f "$body"' EXIT
{
  printf '%s\n' "$MARKER"
  if (($(wc -c < "$REVIEW_FILE") > MAX_BYTES)); then
    # 文字の途中で切れた末尾は iconv で落とす。
    head -c "$MAX_BYTES" "$REVIEW_FILE" | iconv -f UTF-8 -t UTF-8 -c
    printf '\n\n…（長すぎるため省略しました）\n'
  else
    cat "$REVIEW_FILE"
  fi
} > "$body"

existing=$(
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
    --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | tail -n 1
)

if [[ -n $existing ]]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -F "body=@$body" > /dev/null
  echo "amon-reviewer: 既存のコメント（$existing）を更新しました"
else
  gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -F "body=@$body" > /dev/null
  echo "amon-reviewer: PR #$PR_NUMBER にコメントしました"
fi
