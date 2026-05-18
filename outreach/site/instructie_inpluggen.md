# Instructie: nieuwe content inpluggen op de bestaande site

*Voor een AI-assistent (of mens) die de inhoudsupdate van Onderling op de bestaande site moet doorvoeren.*

---

## Context

De site `onderling.vercel.app` heeft een client-side render-architectuur: HTML-bestanden zijn dunne wrappers die per pagina een content-bestand (uit `content/`) laden. De content-bestanden zijn JavaScript-modules die een globale `window.ONDERLING_PAGE`-variabele vullen; `render.js` zet die om naar HTML. Daarnaast is er één gedeelde site-configuratie in `content/site.js` (navigatie, naam, footer).

In een gesprek met Claude is alle content herschreven naar een nieuw inhoudelijk model — gegevens als data-items in eigen ruimtes, interfaces als ingangen erop, toegang als de manier waarop scheiding tussen "van mij" en "gedeeld" werkt. Het visuele ontwerp en de render-architectuur blijven hetzelfde.

Deze instructie beschrijft wat er precies moet gebeuren om de oude content te vervangen door de nieuwe.

---

## Mappenstructuur ter herinnering

```
site-publiek/
├── assets/
│   ├── render.js
│   └── style.css
├── content/
│   ├── site.js               (gedeelde nav + tagline + footer)
│   ├── home.js               (pagina-content per pagina)
│   ├── hoe.js
│   ├── thuis.js
│   ├── buurt.js
│   ├── buurt-burenhulp.js
│   ├── werk.js
│   ├── werk-meedenken.js
│   ├── werk-zorg.js
│   ├── werk-melden.js
│   ├── werk-onderzoek.js
│   ├── werk-overheid.js
│   ├── werk-eigen-versie.js
│   ├── techniek.js
│   ├── stand.js
│   ├── waarom.js
│   ├── onafhankelijkheid.js
│   ├── vragen.js             ← te verwijderen
│   └── contact.js
├── index.html                (HTML-wrappers, één per content-bestand)
├── hoe-het-werkt.html
├── thuis.html
├── buurt.html
├── buurt-burenhulp.html
├── werk.html
├── werk-meedenken.html
├── ... (etc)
├── techniek.html
├── stand-van-zaken.html
├── waarom.html
├── onafhankelijkheid.html
├── vragen.html               ← te verwijderen
└── contact.html
```

---

## Wat te doen

### Stap 1: nieuwe content-bestanden inplaatsen

De volgende bestanden moeten in `content/` worden geplaatst, **ter vervanging van de bestaande gelijknamige bestanden** (behalve waar anders aangegeven):

| Doelnaam in content/ | Nieuwe inhoud uit gesprek met Claude |
|---|---|
| `site.js` | bestand `site.js` |
| `home.js` | bestand `home_v3.js` *(let op: hernoemen)* |
| `hoe.js` | bestand `hoe.js` |
| `thuis.js` | bestand `thuis.js` |
| `buurt.js` | bestand `buurt.js` |
| `buurt-burenhulp.js` | bestand `buurt-burenhulp.js` |
| `werk.js` | bestand `werk.js` |
| `werk-meedenken.js` | bestand `werk-meedenken.js` |
| `werk-zorg.js` | bestand `werk-zorg.js` |
| `werk-melden.js` | bestand `werk-melden.js` |
| `werk-onderzoek.js` | bestand `werk-onderzoek.js` |
| `werk-overheid.js` | bestand `werk-overheid.js` |
| `werk-eigen-versie.js` | bestand `werk-eigen-versie.js` |
| `techniek.js` | bestand `techniek.js` |
| `stand.js` | bestand `stand.js` |
| `waarom.js` | bestand `waarom.js` |
| `onafhankelijkheid.js` | bestand `onafhankelijkheid.js` |
| `contact.js` | bestand `contact.js` |
| `over.js` | bestand `over.js` *(nieuw, bestaat nog niet)* |
| `techniek-thuis.js` | bestand `techniek-thuis.js` *(nieuw)* |
| `techniek-buurt.js` | bestand `techniek-buurt.js` *(nieuw)* |
| `techniek-werk.js` | bestand `techniek-werk.js` *(nieuw)* |

### Stap 2: vragen.js verwijderen uit content/

De vragen-pagina is afgeschaft. Vragen zijn nu verspreid:
- Algemene vragen → onderaan `stand.js` (sectie "Algemene vragen")
- Thuis-specifieke vragen → onderaan `thuis.js`
- Buurt-specifieke vragen → onderaan `buurt.js`
- Werk-specifieke vragen → onderaan `werk.js`

Verwijder dus `content/vragen.js` en `vragen.html`.

### Stap 3: HTML-wrappers maken voor de nieuwe pagina's

Vier nieuwe HTML-bestanden zijn nodig, parallel aan de bestaande HTML-wrappers. Open een bestaande wrapper (zoals `index.html`) en kijk hoe die er uit ziet — typisch een eenvoudige template die `style.css`, het juiste content-bestand uit `content/`, en `render.js` laadt.

Kopieer die structuur naar:
- `over.html` → laadt `content/over.js`
- `techniek-thuis.html` → laadt `content/techniek-thuis.js`
- `techniek-buurt.html` → laadt `content/techniek-buurt.js`
- `techniek-werk.html` → laadt `content/techniek-werk.js`

Pas in elk nieuw HTML-bestand de juiste `<script src="content/X.js">` regel aan, en eventueel de `<title>` als die per pagina handmatig wordt gezet.

### Stap 4: render.js controleren

De nieuwe content gebruikt enkele dingen die mogelijk al ondersteund worden door `render.js`, maar dat moet gecontroleerd:

**a. `footerNav`-veld in `site.js`** — de nieuwe `site.js` heeft een tweede navigatie-array genaamd `footerNav` (naast `nav`). Deze bevat techniek/onafhankelijk/waarom/contact. Als render.js dit veld nog niet kent, moet het worden toegevoegd. Render het als een aparte rij in de footer, visueel iets minder prominent dan de hoofdnav. Zelfde linkstructuur als `nav`.

**b. Inline markdown-links in `note`-blokken** — sommige nieuwe `note`-blokken bevatten markdown-links zoals `[stand van zaken](stand-van-zaken.html)`. Controleer of de bestaande note-renderer dit al verwerkt (zoals `prose`-blokken dat doen). Zo niet, breid de note-renderer uit zodat markdown-links erin gerenderd worden.

**c. Vetgedrukte tekst in `note`-blokken** — `werk-zorg.js` heeft een note die begint met `**Acute hulp staat hier los van.**`. Controleer of `**...**` als vet wordt gerenderd binnen notes. Zo niet, breid de renderer uit.

**d. `faq`-blokken op meerdere pagina's** — voorheen stond het `faq`-blocktype alleen op `vragen.js`. Nu staat het op `thuis.js`, `buurt.js`, `werk.js`, en `stand.js`. De renderer moet dat type op alle pagina's correct verwerken (zou al moeten werken — gewoon checken).

Maak geen aanpassingen aan `style.css`. Visueel moet alles hetzelfde blijven.

### Stap 5: linkcheck

Doorloop alle nieuwe content-bestanden en controleer dat elke interne link (alles van de vorm `[tekst](xxx.html)`) verwijst naar een bestaand HTML-bestand. Specifieke aandachtspunten:

- `techniek-thuis.html`, `techniek-buurt.html`, `techniek-werk.html` — alleen geldig als stap 3 is uitgevoerd
- `over.html` — alleen geldig als stap 3 is uitgevoerd
- `vragen.html` — mag nergens meer naar verwezen worden (zou na inplaatsing van de nieuwe content vanzelf het geval moeten zijn, maar controleer)

### Stap 6: browsertest

Open `index.html` in een browser met JavaScript aan. Doorloop:
- Hoofdmenu klopt (zeven items: Wat & waarom, Hoe werkt het, Thuis, Buurt, Werk & maatschappij, Stand van zaken, Over ons)
- Footer toont vier links (Techniek, Onafhankelijk blijven, Waarom dit project, Contact)
- Alle hoofdpagina's openen zonder JavaScript-fouten in de console
- Klik door naar elke subpagina (zes onder werk, één onder buurt, drie techniek-pagina's)
- Markdown-links binnen prose en notes werken
- FAQ-secties tonen vragen en antwoorden correct

---

## Wat er niet hoeft te gebeuren

- **Geen style.css-wijzigingen.** Het visuele ontwerp blijft hetzelfde.
- **Geen aanpassingen aan de bestaande HTML-wrappers** (behalve het verwijderen van `vragen.html`). De wrappers blijven leeg-genoeg om hergebruikt te worden.
- **Geen build-stap.** Dit is een statische site; bestanden vervangen en klaar.
- **Geen herstructurering van de mappenstructuur.** Alleen content vervangen.

---

## Waar het mogelijk fout gaat

**Een paar dingen om in de gaten te houden bij het uitvoeren:**

- *Bestandsnaam-mismatch.* Het bestand `home_v3.js` uit het gesprek moet `home.js` worden in de content-map. Niet vergeten te hernoemen.
- *Render.js die `footerNav` negeert.* Zonder aanpassing van render.js verschijnt de footer-nav niet — techniek, onafhankelijkheid, waarom en contact zouden dan onvindbaar zijn behalve via inline links. Eerste prioriteit als blijkt dat ze niet renderen.
- *Inline markdown-links binnen `note`-blokken.* Als die niet worden gerenderd, blijven ze als platte tekst staan inclusief de `[]()`-syntax — dat is lelijk. Goed te checken op bijvoorbeeld de homepage waar dat speelt.
- *Backlinks van subpagina's.* De werk- en buurt-subpagina's beginnen met een `backlink`-blok. Die zou al moeten werken vanuit de oude site, maar controleer dat de link naar `werk.html` of `buurt.html` correct werkt.

---

## Bestandsoverzicht

In totaal worden er **22 content-bestanden geplaatst** in `content/`:
- 1 site-configuratie: `site.js`
- 17 bestaande pagina's (vervangen): home, hoe, thuis, buurt, buurt-burenhulp, werk, werk-meedenken, werk-zorg, werk-melden, werk-onderzoek, werk-overheid, werk-eigen-versie, techniek, stand, waarom, onafhankelijkheid, contact
- 4 nieuwe pagina's: over, techniek-thuis, techniek-buurt, techniek-werk

Er worden **4 nieuwe HTML-wrappers** gemaakt: `over.html`, `techniek-thuis.html`, `techniek-buurt.html`, `techniek-werk.html`.

Er worden **2 bestanden verwijderd**: `content/vragen.js` en `vragen.html`.

Render.js wordt **mogelijk uitgebreid** met footer-nav-rendering en markdown-link-rendering binnen notes (alleen indien nog niet ondersteund).

Style.css wordt **niet aangepast**.
