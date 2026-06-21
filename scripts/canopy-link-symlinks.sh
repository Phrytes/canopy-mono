#!/usr/bin/env bash
# Make every node_modules/@canopy/<X> a SYMLINK → packages/<X>, and ensure every
# app/package has its DECLARED @canopy deps present as such symlinks.
#
# WHY: .npmrc uses `node-linker=hoisted` (real COPIED dirs). Because the @canopy
# packages depend on each other (e.g. @canopy/vault → @canopy/core), each copy
# re-copies its @canopy deps recursively → ~2.79M duplicated files (30-level
# @canopy/X/node_modules/@canopy/X/… chains) that crash Metro's file crawler and
# cause the recurring stale-copy bugs. Symlinks = one real copy per package at
# packages/<X>, zero duplication, zero recursion, single source of truth.
#
# Resolution model: each consumer's node_modules/@canopy/<dep> symlinks to
# packages/<dep>; since EVERY package is processed, each package's own declared
# @canopy deps are symlinked in ITS node_modules → the whole graph resolves by
# walking symlinks (Node, Vite, Metro all follow them). 3rd-party deps stay real
# in packages/<X>/node_modules.
#
# REVERT: scripts/canopy-cp-repair.sh rebuilds copies from packages/* (intact source).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

deps_of() {  # echo @canopy/* dep basenames declared by a package.json
  python3 - "$1" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit()
seen=set()
for k in ('dependencies','devDependencies','peerDependencies','optionalDependencies'):
    for n in (d.get(k) or {}):
        if n.startswith('@canopy/'):
            b=n.split('/',1)[1]
            if b not in seen: seen.add(b); print(b)
PY
}

link_one() {  # $1 = consumer dir (app or package root), needs node_modules/@canopy/<deps>
  local home="$1"
  [ -f "$home/package.json" ] || return
  local nm="$home/node_modules/@canopy"
  while read -r dep; do
    [ -n "$dep" ] || continue
    [ -d "packages/$dep" ] || continue
    local link="$nm/$dep"
    # already a correct symlink? skip
    [ -L "$link" ] && continue
    mkdir -p "$nm"
    [ -e "$link" ] && rm -rf "$link"            # replace a stale real-dir copy
    local rel; rel="$(realpath --relative-to="$nm" "$ROOT/packages/$dep")"
    ln -s "$rel" "$link"
  done < <(deps_of "$home/package.json")
}

echo "[1/2] convert existing @canopy copies → symlinks (shallowest-first)"
converted=0
while IFS= read -r d; do
  [ -e "$d" ] || continue
  [ -L "$d" ] && continue
  x="$(basename "$d")"; [ -d "packages/$x" ] || continue
  lp="$(dirname "$d")"; rel="$(realpath --relative-to="$lp" "$ROOT/packages/$x")"
  rm -rf "$d"; ln -s "$rel" "$d"; converted=$((converted+1))
done < <(find apps/*/node_modules/@canopy/* packages/*/node_modules/@canopy/* -maxdepth 0 2>/dev/null \
          | awk '{print gsub(/\//,"/"), $0}' | sort -n | cut -d' ' -f2-)
echo "      converted=$converted"

echo "[2/2] ensure every app + package has its declared @canopy deps symlinked"
created=0
for home in apps/* packages/*; do
  [ -d "$home" ] || continue
  before=$(find "$home/node_modules/@canopy" -maxdepth 1 -type l 2>/dev/null | wc -l)
  link_one "$home"
  after=$(find "$home/node_modules/@canopy" -maxdepth 1 -type l 2>/dev/null | wc -l)
  created=$((created + after - before))
done
echo "      new symlinks=$created"
echo "DONE link-symlinks"
