#!/usr/bin/env bash
# Push the current (or specified) branch to origin, with `Project Files/`
# stripped from the branch's history. The local repo is never modified —
# all filtering happens inside a throwaway temp clone.
#
# Usage:
#   scripts/push-public.sh                       # push current branch
#   scripts/push-public.sh master                # push specified branch
#   scripts/push-public.sh master --force        # force-push (use with care)
#   scripts/push-public.sh --dry-run             # report what would push, no actual push
#   scripts/push-public.sh master --dry-run      # dry-run a specific branch
#
# Why this exists:
#   `Project Files/` holds design-doc history we want versioned locally but
#   never pushed to the public remote. Filtering at push time keeps the
#   working repo intact while ensuring nothing in `Project Files/` ever
#   reaches GitHub.
#
# Requires: git-filter-repo (pip install --user git-filter-repo).

set -euo pipefail

DRY_RUN=0
BRANCH=""
FORCE_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE_FLAG="--force" ;;
    -*)        echo "Unknown flag: $arg" >&2 ; exit 2 ;;
    *)         if [ -z "$BRANCH" ]; then BRANCH="$arg" ; else echo "Unexpected arg: $arg" >&2 ; exit 2 ; fi ;;
  esac
done

REPO_ROOT=$(git rev-parse --show-toplevel)
if [ -z "$BRANCH" ]; then
  BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
fi

ORIGIN_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)
if [ -z "$ORIGIN_URL" ]; then
  echo "FATAL: no 'origin' remote configured in $REPO_ROOT" >&2
  exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1 ; then
  echo "FATAL: git-filter-repo not installed. Run: pip install --user git-filter-repo" >&2
  exit 1
fi

TMP=$(mktemp -d -t nkn-push-public.XXXXXX)
trap "rm -rf '$TMP'" EXIT

echo "Cloning $REPO_ROOT (branch '$BRANCH') to $TMP/repo ..."
git clone --no-local --branch "$BRANCH" "$REPO_ROOT" "$TMP/repo" --quiet

cd "$TMP/repo"

ORIG_COMMITS=$(git rev-list --count HEAD)
echo "Stripping 'Project Files/' from history ..."
git filter-repo --invert-paths --path 'Project Files/' --force --quiet
NEW_COMMITS=$(git rev-list --count HEAD)

echo "Result: $ORIG_COMMITS commits in $BRANCH locally → $NEW_COMMITS after strip."
echo "Files that would push (top-level):"
git ls-tree -r --name-only HEAD | awk -F/ '{print $1}' | sort -u | head -20

if git ls-tree -r HEAD | grep -q "Project Files/" ; then
  echo "FATAL: 'Project Files/' still present after filter — refusing to push." >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "--dry-run set: not pushing. Temp clone at $TMP/repo (will be deleted on exit)."
  exit 0
fi

git remote add origin "$ORIGIN_URL"
echo "Pushing $BRANCH to origin $FORCE_FLAG ..."
git push origin "$BRANCH" $FORCE_FLAG
echo "Done. Local repo untouched; remote '$BRANCH' has no 'Project Files/' content."
