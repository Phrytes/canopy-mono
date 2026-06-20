#!/usr/bin/env bash
# Convert every node_modules/@canopy/<X> COPY into a SYMLINK → packages/<X>.
#
# WHY: .npmrc uses `node-linker=hoisted` (real COPIED dirs). Because the @canopy
# packages depend on each other (e.g. @canopy/vault → @canopy/core), each copy
# re-copies its @canopy deps, recursively, down the dependency graph → ~2.79M
# duplicated files (30-level @canopy/X/node_modules/@canopy/X/… chains). That bomb
# crashes Metro's file crawler and is the root of the "stale copy" class of bugs.
#
# FIX: one real copy per package at packages/<X>; every consumer's
# node_modules/@canopy/<X> is a symlink to it. Zero duplication, zero recursion,
# single source of truth (edit packages/<X>/src → all consumers see it live).
# Node, Vite, and Metro all follow symlinks.
#
# REVERT: rebuild the copies with scripts/canopy-cp-repair.sh (packages/* are the
# intact source of truth, so copies regenerate deterministically).
#
# Only the FIRST-LEVEL @canopy entries under each app/package node_modules are
# converted; deeper nested copies vanish when their parent copy is replaced, and
# resolution then flows through the symlink to packages/<X> (whose own
# node_modules/@canopy entries this script also converts). packages/<X> keep their
# real node_modules (3rd-party deps like tweetnacl + symlinked @canopy).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

linked=0; skipped=0; missing=0
# Shallowest-first so replacing a parent removes the deep copies underneath it.
while IFS= read -r d; do
  [ -e "$d" ] || continue                      # parent already replaced → gone
  x="$(basename "$d")"
  if [ ! -d "packages/$x" ]; then
    echo "  ? no packages/$x for $d (left as-is)"; missing=$((missing+1)); continue
  fi
  [ -L "$d" ] && { skipped=$((skipped+1)); continue; }   # already a symlink

  # relative target from the link's parent dir to packages/<x>
  linkparent="$(dirname "$d")"
  rel="$(realpath --relative-to="$linkparent" "$ROOT/packages/$x")"

  rm -rf "$d"
  ln -s "$rel" "$d"
  linked=$((linked+1))
done < <(find apps/*/node_modules/@canopy/* packages/*/node_modules/@canopy/* -maxdepth 0 2>/dev/null \
          | awk '{print gsub(/\//,"/"), $0}' | sort -n | cut -d' ' -f2-)

echo "symlinked=$linked  already-symlink=$skipped  no-source=$missing"
echo "DONE link-symlinks"
