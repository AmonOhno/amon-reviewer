#!/usr/bin/env bash
# レビューで得た知見を、呼び出し元リポの専用ブランチに貯める。
#
# 使い方:
#   knowledge.sh export <dir>          知見（knowledge/*.md）を <dir> に書き出す。知見がなければ何もしない
#   knowledge.sh save-pending <pr> <file>
#                                      要約を保留（pending/<pr>.md）として保存する。同じPRは上書き
#   knowledge.sh adopt <pr>            保留を知見（knowledge/<pr>.md）に移す。マージされたPR用
#   knowledge.sh discard <pr>          保留を捨てる。マージされずに閉じられたPR用
#
# 環境変数:
#   KNOWLEDGE_BRANCH  知見を貯めるブランチ（既定: amon-reviewer-knowledge）
#   REPO_DIR          呼び出し元リポのルート（既定: カレントディレクトリ）。actions/checkout 済みであること
#   PR_TITLE          save-pending で見出しに入れるPRのタイトル（省略可）
set -euo pipefail

die() {
  echo "amon-reviewer: $*" >&2
  exit 1
}

BRANCH=${KNOWLEDGE_BRANCH:-amon-reviewer-knowledge}
REPO_DIR=${REPO_DIR:-$PWD}

export GIT_AUTHOR_NAME="github-actions[bot]"
export GIT_AUTHOR_EMAIL="41898283+github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
export GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL

# 知見のブランチを取得する。まだなければ 1 を返す。
fetch_branch() {
  git -C "$REPO_DIR" fetch -q origin "refs/heads/$BRANCH" 2> /dev/null
}

worktree=
orphan_branch=amon-reviewer-tmp-$$
cleanup() {
  if [[ -n $worktree ]]; then
    git -C "$REPO_DIR" worktree remove --force "$worktree" 2> /dev/null || rm -rf "$worktree"
    git -C "$REPO_DIR" branch -D "$orphan_branch" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# 知見のブランチを作業用ディレクトリに開く。ブランチがなければ空の状態から始める。
open_worktree() {
  worktree=$(mktemp -d)
  rmdir "$worktree"
  if fetch_branch; then
    git -C "$REPO_DIR" worktree add -q --detach "$worktree" FETCH_HEAD
  else
    git -C "$REPO_DIR" worktree add -q --detach "$worktree" HEAD
    git -C "$worktree" checkout -q --orphan "$orphan_branch"
    git -C "$worktree" rm -rfq --cached .
    git -C "$worktree" clean -fdxq
  fi
}

# 変更をコミットしてブランチに push する。ほかのPRと同時に書き込んだときは取り込み直して再試行する。
publish() {
  local message=$1
  git -C "$worktree" add -A
  if git -C "$worktree" diff --cached --quiet; then
    echo "amon-reviewer: 知見のブランチに変更はありません"
    return 0
  fi
  git -C "$worktree" commit -q -m "$message"

  local attempt
  for attempt in 1 2 3 4 5; do
    if git -C "$worktree" push -q origin "HEAD:refs/heads/$BRANCH" 2> /dev/null; then
      echo "amon-reviewer: $BRANCH に保存しました（$message）"
      return 0
    fi
    sleep "$attempt"
    git -C "$worktree" fetch -q origin "refs/heads/$BRANCH" || die "$BRANCH を取得できません"
    git -C "$worktree" rebase -q FETCH_HEAD || die "$BRANCH への取り込みに失敗しました"
  done
  die "$BRANCH に push できませんでした"
}

require_pr() {
  [[ ${1:-} =~ ^[0-9]+$ ]] || die "PR番号が不正です: ${1:-空}"
}

command=${1:-}
case $command in
  export)
    dir=${2:?"使い方: knowledge.sh export <dir>"}
    mkdir -p "$dir"
    if fetch_branch && git -C "$REPO_DIR" cat-file -e FETCH_HEAD:knowledge 2> /dev/null; then
      git -C "$REPO_DIR" archive FETCH_HEAD knowledge | tar -x -C "$dir" --strip-components=1
      echo "amon-reviewer: 知見 $(find "$dir" -name '*.md' | wc -l) 件を読み込みました"
    else
      echo "amon-reviewer: まだ知見はありません"
    fi
    ;;
  save-pending)
    pr=${2:-}
    file=${3:-}
    require_pr "$pr"
    [[ -s $file ]] || die "要約のファイルが空です: ${file:-未指定}"
    open_worktree
    mkdir -p "$worktree/pending"
    {
      printf '# PR #%s%s\n\n' "$pr" "${PR_TITLE:+ $PR_TITLE}"
      cat "$file"
    } > "$worktree/pending/$pr.md"
    publish "pending: PR #$pr"
    ;;
  adopt)
    pr=${2:-}
    require_pr "$pr"
    fetch_branch || {
      echo "amon-reviewer: $BRANCH がないため、何もしません"
      exit 0
    }
    open_worktree
    if [[ ! -f $worktree/pending/$pr.md ]]; then
      echo "amon-reviewer: PR #$pr の保留中の知見はありません"
      exit 0
    fi
    mkdir -p "$worktree/knowledge"
    git -C "$worktree" mv -f "pending/$pr.md" "knowledge/$pr.md"
    publish "adopt: PR #$pr"
    ;;
  discard)
    pr=${2:-}
    require_pr "$pr"
    fetch_branch || exit 0
    open_worktree
    if [[ ! -f $worktree/pending/$pr.md ]]; then
      exit 0
    fi
    git -C "$worktree" rm -q "pending/$pr.md"
    publish "discard: PR #$pr"
    ;;
  *)
    die "使い方: knowledge.sh export|save-pending|adopt|discard ..."
    ;;
esac
