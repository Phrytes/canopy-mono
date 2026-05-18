# Aanvullende instructie: waarborgen-pagina en open-source-rode-draad

*Aanvulling op `instructie_inpluggen.md` — uit te voeren na of in plaats van de eerdere update.*

---

## Wat er veranderd is sinds de vorige ronde

De pagina `onafhankelijkheid.js` wordt vervangen door `waarborgen.js`, met andere inhoud, andere titel ("De waarborgen") en andere URL (`waarborgen.html`). De pagina behandelt nu vier niveaus van waarborgen — architectuur, slimme hulp, organisatie-eisen, en open code — in plaats van een gedetailleerde stichtingsstructuur in te vullen.

Tegelijk wordt **open source als rode draad** verwerkt op zeven andere pagina's, en wordt de oude term "onafhankelijke partij" op meerdere plekken vervangen door "tussenpartij" (duidelijker, minder claim-achtig).

---

## Wat te doen

### Stap 1: nieuwe waarborgen-pagina inplaatsen

Plaats het bestand `waarborgen.js` in `content/`. Verwijder `content/onafhankelijkheid.js` en `onafhankelijkheid.html`.

Maak een nieuwe HTML-wrapper `waarborgen.html` aan (kopie van een bestaande wrapper, met `<script src="content/waarborgen.js">` en de juiste `<title>`).

### Stap 2: site.js bijwerken

Vervang `content/site.js` door `site_v2.js` (na hernoeming). Het verschil: in `footerNav` is `onafhankelijkheid` vervangen door `waarborgen` (label "De waarborgen", href `waarborgen.html`).

### Stap 3: zes pagina's bijwerken

De volgende content-bestanden moeten worden vervangen door hun v2-versie (hernoemen naar zonder `_v2` suffix bij plaatsen):

| Doelnaam in content/ | Vervangen door |
|---|---|
| `home.js` | `home_v4.js` |
| `waarom.js` | `waarom_v2.js` |
| `werk.js` | `werk_v2.js` |
| `werk-meedenken.js` | `werk-meedenken_v2.js` |
| `werk-eigen-versie.js` | `werk-eigen-versie_v2.js` |
| `techniek.js` | `techniek_v2.js` |
| `techniek-werk.js` | `techniek-werk_v2.js` |
| `over.js` | `over_v2.js` |
| `stand.js` | `stand_v2.js` |

### Stap 4: linkcheck

Controleer dat nergens meer naar `onafhankelijkheid.html` wordt verwezen. Alle verwijzingen zouden nu naar `waarborgen.html` moeten gaan. Specifieke plekken om te controleren:

- `home.js` — "verder lezen"-blok en uitgangspunt
- `waarom.js` — "open, controleerbaar"-blok
- `werk.js` — "waarom een tussenpartij"-blok
- `werk-meedenken.js` — slotalinea
- `werk-eigen-versie.js` — slotalinea en in het lijstje
- `techniek.js` — nieuw blok "open code en open standaarden"
- `techniek-werk.js` — "de rol van de tussenpartij"-blok
- `over.js` — "hoe het bedoeld is verder te gaan"-blok
- `stand.js` — timeline-item "Verderop" en FAQ-antwoord over open source

### Stap 5: browsertest

Controleer naast de eerdere checklist:

- Footer toont nu "De waarborgen" in plaats van "Onafhankelijk blijven"
- Klik op de footer-link "De waarborgen" → opent `waarborgen.html` met de nieuwe inhoud
- Open source komt expliciet aan bod op de homepage (in "Het uitgangspunt") en op `waarom.js` (in "Open, controleerbaar")
- De FAQ-vraag "Is dit open source?" op `stand.js` heeft een uitgebreider antwoord dan voorheen, met verwijzing naar waarborgen

---

## Wat er niet hoeft te gebeuren

- Geen render.js-aanpassingen, mits de eerdere instructie al is uitgevoerd
- Geen wijzigingen aan de andere ring-pagina's (`thuis.js`, `buurt.js`) — die verwijzen niet naar waarborgen
- Geen wijzigingen aan de overige werk-subpagina's behalve `werk-meedenken.js` en `werk-eigen-versie.js`

---

## Bestandsoverzicht voor deze ronde

**Nieuw bestand:** `waarborgen.js`
**Vervangen bestanden:** `site.js`, `home.js`, `waarom.js`, `werk.js`, `werk-meedenken.js`, `werk-eigen-versie.js`, `techniek.js`, `techniek-werk.js`, `over.js`, `stand.js`
**Verwijderde bestanden:** `onafhankelijkheid.js`, `onafhankelijkheid.html`
**Nieuwe HTML-wrapper:** `waarborgen.html`
