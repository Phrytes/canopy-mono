#!/usr/bin/env bash
# Maakt een schone, publiceerbare kopie van de site ZONDER de interne
# planning. Publiceer de uitvoermap, niet de bronmap.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$(dirname "$SRC")/site-publiek"

# Bestanden/mappen die NOOIT publiek mogen. oud/ = de oude site (lokaal
# behouden, niet online); content_alt*/ + instructie_inpluggen*.md zijn
# interne auteurs-/bronartefacten.
INTERN=( "intern-planning.html" "content/intern-planning.js" \
         "oud" "content_alt" "content_alt_update" \
         "instructie_inpluggen.md" "instructie_inpluggen_aanvulling.md" )

echo "Bron : $SRC"
echo "Doel : $DEST"

# Bewaar een bestaande Vercel-projectkoppeling (.vercel), zodat een
# herhaalde deploy hetzelfde project bijwerkt i.p.v. een nieuw aan te maken.
KEEP=""
if [ -d "$DEST/.vercel" ]; then
  KEEP="$(mktemp -d)"
  cp -r "$DEST/.vercel" "$KEEP/.vercel"
fi
rm -rf "$DEST"
mkdir -p "$DEST"
if [ -n "$KEEP" ]; then
  cp -r "$KEEP/.vercel" "$DEST/.vercel"
  rm -rf "$KEEP"
  echo "(Vercel-projectkoppeling behouden)"
fi

# Kopieer alles, sluit interne + meta-bestanden uit.
( cd "$SRC" && find . \
    -path ./.git -prune -o \
    -path ./oud -prune -o \
    -path ./content_alt -prune -o \
    -path ./content_alt_update -prune -o \
    -name 'intern-planning.html' -prune -o \
    -name 'intern-planning.js' -prune -o \
    -name 'instructie_inpluggen*.md' -prune -o \
    -name 'maak-publieke-kopie.sh' -prune -o \
    -name 'README.md' -prune -o \
    -name '.verify.cjs' -prune -o \
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
