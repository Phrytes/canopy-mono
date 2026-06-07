#!/usr/bin/env sh
# Multi-target restic backup for the feedback pipeline (Tier 3d). Backs up the CSS pod data +
# the cohort store to EVERY configured target (e.g. two different cloud providers, for
# redundancy), each encrypted independently.
#
# What it protects: the participants' + project pods (consented contributions only — raw never
# leaves the device/pod) and the amnesic recovery-hash ↔ pod-ref records. Recovery codes are
# client-side and are NOT here by design.
#
# TARGETS: drop one env file per target in BACKUP_TARGETS_DIR (default /backup/targets),
# e.g. primary.env, secondary.env — each defining RESTIC_REPOSITORY, RESTIC_PASSWORD and any
# provider credentials (see backup-targets/*.env.example). With no targets dir, falls back to
# the ambient RESTIC_* environment (single-target).
#
# USAGE:
#   backup.sh                 # = backup: snapshot every target, prune, then verify
#   backup.sh backup
#   backup.sh check           # restic check (repo integrity) on every target
#   backup.sh snapshots       # list snapshots per target
#   backup.sh restore <target> <snapshot|latest> <dest>   # restore one target to <dest>
set -u

CSS_DATA="${CSS_DATA:-/data/css}"
ACTIVATION_DATA="${ACTIVATION_DATA:-/data/activation}"
TARGETS_DIR="${BACKUP_TARGETS_DIR:-/backup/targets}"
TAG="feedback-pipeline"
KEEP="--keep-daily 7 --keep-weekly 4 --keep-monthly 6"

name_of() { basename "$1" .env; }

# list configured targets: each *.env file, or the literal __ambient__ for env-only config
targets() {
  if [ -d "$TARGETS_DIR" ] && ls "$TARGETS_DIR"/*.env >/dev/null 2>&1; then
    ls "$TARGETS_DIR"/*.env
  elif [ -n "${RESTIC_REPOSITORY:-}" ]; then
    echo "__ambient__"
  fi
}

# run restic with a target's environment loaded (in a subshell so creds don't leak across)
with_target() {
  tf="$1"; shift
  if [ "$tf" = "__ambient__" ]; then
    restic "$@"
  else
    # shellcheck disable=SC1090
    ( set -a; . "$tf"; set +a; restic "$@" )
  fi
}

do_backup() {
  tf="$1"
  with_target "$tf" snapshots >/dev/null 2>&1 || with_target "$tf" init || return 1
  with_target "$tf" backup --tag "$TAG" "$CSS_DATA" "$ACTIVATION_DATA" || return 1
  # shellcheck disable=SC2086
  with_target "$tf" forget --tag "$TAG" --prune $KEEP || return 1
  with_target "$tf" check || return 1     # verify integrity after writing
}

cmd="${1:-backup}"; [ $# -gt 0 ] && shift

TARGET_LIST="$(targets)"
if [ -z "$TARGET_LIST" ]; then
  echo "[backup] no targets configured — add *.env to $TARGETS_DIR (or set RESTIC_REPOSITORY)" >&2
  exit 0
fi

rc=0
case "$cmd" in
  backup)
    for tf in $TARGET_LIST; do
      echo "==> backup → $(name_of "$tf")"
      do_backup "$tf" || { echo "[backup] FAILED: $(name_of "$tf")" >&2; rc=1; }
    done
    ;;
  check)
    for tf in $TARGET_LIST; do
      echo "==> check → $(name_of "$tf")"
      with_target "$tf" check || rc=1
    done
    ;;
  snapshots)
    for tf in $TARGET_LIST; do
      echo "==> $(name_of "$tf")"
      with_target "$tf" snapshots --tag "$TAG" || rc=1
    done
    ;;
  restore)
    tname="${1:?usage: backup.sh restore <target> <snapshot|latest> <dest>}"
    snap="${2:-latest}"; dest="${3:?usage: backup.sh restore <target> <snapshot|latest> <dest>}"
    tf="$TARGETS_DIR/$tname.env"; [ -f "$tf" ] || tf="__ambient__"
    echo "==> restore $snap from $tname → $dest"
    with_target "$tf" restore "$snap" --target "$dest" || rc=1
    ;;
  *)
    echo "usage: backup.sh [backup|check|snapshots|restore <target> <snapshot> <dest>]" >&2
    exit 2
    ;;
esac
exit $rc
