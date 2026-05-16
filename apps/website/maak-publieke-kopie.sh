#!/usr/bin/env bash
# Maakt een schone, publiceerbare kopie van de site ZONDER de interne
# planning. Publiceer de uitvoermap, niet de bronmap.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$(dirname "$SRC")/website-publiek"

# Bestanden die NOOIT publiek mogen.
INTERN=( "intern-planning.html" "content/intern-planning.js" )

echo "Bron : $SRC"
echo "Doel : $DEST"

rm -rf "$DEST"
mkdir -p "$DEST"

# Kopieer alles, sluit interne + meta-bestanden uit.
( cd "$SRC" && find . \
    -path ./.git -prune -o \
    -name 'intern-planning.html' -prune -o \
    -name 'intern-planning.js' -prune -o \
    -name 'maak-publieke-kopie.sh' -prune -o \
    -name 'README.md' -prune -o \
    -type f -print ) | while read -r f; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$SRC/$f" "$DEST/$f"
done

# Harde controle: faal als er toch iets interns is meegekomen.
fout=0
for f in "${INTERN[@]}"; do
  if [ -e "$DEST/$f" ]; then echo "FOUT: $f staat in de kopie!"; fout=1; fi
done
if grep -rqi "NIET PUBLICEREN" "$DEST" 2>/dev/null; then
  echo "FOUT: 'NIET PUBLICEREN' aangetroffen in de publieke kopie!"; fout=1
fi
[ "$fout" -eq 0 ] || { echo "Afgebroken — niet publiceren."; exit 1; }

echo
echo "OK. Publiceerbare kopie staat in: $DEST"
echo "Inhoud:"
( cd "$DEST" && find . -type f | sort | sed 's/^/  /' )
echo
echo "Controleer zelf nog even dat intern-planning.html hierboven NIET voorkomt."
