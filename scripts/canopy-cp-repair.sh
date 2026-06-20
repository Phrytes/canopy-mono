#!/usr/bin/env bash
# Fixed-point @canopy copy repair (per feedback-no-pnpm-install-here).
# 1) Restore each present @canopy copy's own files (un-flatten what I stripped) via cp -rn.
# 2) Loop: for every */node_modules/@canopy/ dir, cp any @canopy DEP missing for a present package.
#    Repeat until stable.
set -uo pipefail
cd /home/frits/expotest/canopy-mono

canopy_deps() {  # echo the @canopy/* dep basenames declared by a package dir
  local pj="$1/package.json"; [ -f "$pj" ] || return
  python3 - "$pj" <<'PY'
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

echo "[1/2] un-flatten: restore each present @canopy copy's files from packages/<P> (cp -rn, no clobber)"
restored=0
while read -r d; do
  p=$(basename "$d")
  [ -d "packages/$p" ] || continue
  cp -rn "packages/$p/." "$d/" 2>/dev/null && restored=$((restored+1))
done < <(find apps/*/node_modules/@canopy/* packages/*/node_modules/@canopy/* -maxdepth 0 -type d 2>/dev/null)
echo "      refreshed ~$restored copies"

echo "[2/2] fixed-point: add missing sibling @canopy deps, loop until stable"
round=0
while :; do
  round=$((round+1)); added=0
  while read -r dir; do                       # dir = some .../node_modules/@canopy
    for d in "$dir"/*; do
      [ -d "$d" ] || continue
      p=$(basename "$d")
      [ -d "packages/$p" ] || continue
      while read -r dep; do
        [ -n "$dep" ] || continue
        if [ ! -e "$dir/$dep" ] && [ -d "packages/$dep" ]; then
          cp -r "packages/$dep" "$dir/$dep" 2>/dev/null && added=$((added+1))
        fi
      done < <(canopy_deps "packages/$p")
    done
  done < <(find apps/*/node_modules/@canopy packages/*/node_modules/@canopy -type d -name '@canopy' 2>/dev/null)
  echo "      round $round: added $added"
  [ "$added" -eq 0 ] && break
  [ "$round" -ge 8 ] && { echo "      stop (max rounds)"; break; }
done
echo "DONE cp-repair"
