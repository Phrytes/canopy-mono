# Website (werknaam: "Onderling")

Een rustige, niet-technische uitleg-site: wat ik bouw en waarom, wat je
ermee oplost, de aanpak, en waar het staat. Plus één **interne**
planningspagina die **niet** publiek hoort.

## Openen

Dubbelklik **`index.html`**. Klaar. Geen build, geen server, geen
internet nodig — de hele site is platte HTML/CSS met een klein beetje
JavaScript. Werkt ook door het mapje op een USB-stick te zetten.

## Hoe het in elkaar zit

De **indeling** (kopbalk, navigatie, contactband, voet, de soorten
tekstblokken) staat los van de **tekst**:

```
index.html, *.html         de pagina-omhulsels (welke content erbij hoort)
assets/style.css            alle vormgeving
assets/render.js            bouwt elke pagina uit de content-data
content/site.js             gedeelde instellingen — HIER STAAT DE NAAM
content/home.js             "Wat & waarom"
content/gebruik.js          "Wat los je ermee op" (overzicht-hub)
content/gebruik-*.js        detailpagina per toepassing (doorklik)
content/hoe-het-werkt.js    "Hoe het werkt" (techniek, gewone taal)
content/aanpak.js           "De aanpak" (twee manieren)
content/roadmap.js          "Stand van zaken" (publiek, zonder cijfers)
content/contact.js          "Contact"
content/intern-planning.js  INTERN — niet publiceren
intern-planning.html        INTERN — niet publiceren
```

Detailpagina's hebben hun eigen `*.html`-omhulsel (zelfde patroon als
de hoofdpagina's) en zijn alleen via het overzicht bereikbaar, niet via
het menu. Een chat-voorbeeld op zo'n pagina is een illustratie — de
gebruiker en de bot spreken daarin in de ik-vorm; de site-tekst zelf
niet.

Tekst aanpassen = een `content/*.js` openen en de zinnen wijzigen. In
teksten werkt lichte opmaak: `**vet**` en `[tekst](bestand.html)`.

## De naam wijzigen

"Onderling" is een werknaam. Eén plek aanpassen volstaat:
open **`content/site.js`** en wijzig `name` (en eventueel `tagline`).
De hele site neemt het over.

## Wat is publiek en wat niet

**Publiek** (mag online): `index.html`, `wat-los-je-ermee-op.html`,
`de-aanpak.html`, `roadmap.html`, `contact.html`, `assets/`, en in
`content/` alles **behalve** `intern-planning.js`.

**NIET publiek** (alleen lokaal): `intern-planning.html` en
`content/intern-planning.js`. Die bevatten runway, financiële drempels
en het noodluik. Ze zijn nergens vanuit de publieke navigatie gelinkt en
hebben een rode "NIET PUBLICEREN"-markering, maar de zekerste maatregel
is ze simpelweg niet mee te kopiëren.

### Een veilige publieke kopie maken

Als je de site ooit online zet, publiceer dan een **kopie zonder de
interne bestanden** — niet deze map zelf. Eén commando:

```sh
bash maak-publieke-kopie.sh
```

Dat zet een schone versie in `../website-publiek/` met de interne
pagina er gegarandeerd uit. Controleer voor publicatie altijd nog even
dat `intern-planning.html` daar **niet** in zit.

> Zet je het via een host die `.gitignore`-achtige regels kent? Sluit
> dan expliciet `intern-planning.html` en `content/intern-planning.js`
> uit. De `maak-publieke-kopie.sh`-route is het minst foutgevoelig.

## Tijdelijk gratis online zetten

De site is platte HTML/CSS/JS, dus elke statische host werkt. Publiceer
**altijd de schone kopie**, nooit deze map zelf (die bevat de interne
pagina):

```sh
bash maak-publieke-kopie.sh        # maakt ../website-publiek/
cd ../website-publiek
```

Daarna, kies één:

- **Snelst, geen account/CLI:** ga naar `app.netlify.com/drop` en sleep
  de map `website-publiek` erin. Je krijgt direct een URL.
- **Vercel CLI:** `npx vercel@latest` (eenmalig inloggen via de browser;
  framework: *Other*, geen build-command, output = huidige map). Daarna
  `npx vercel@latest --prod` voor een vaste URL.
- **Cloudflare Pages / GitHub Pages:** ook prima; wijs de host naar de
  map `website-publiek`.

Let op: het wordt een **openbare** URL (iedereen met de link kan kijken).
De interne planning zit er niet in (het script breekt af als dat wel zo
zou zijn). De `noindex` hieronder houdt 'm wel uit Google tot je dat
weghaalt.

## Contact (nu een stub)

Er staat **geen e-mailadres of formulier** op de site — die is nog in
opbouw. De contactband toont `contact.stub` uit `content/site.js`.

Later weer aanzetten, in `content/site.js`:

- **mailto terug:** zet `email: "naam@adres.nl"` in `ONDERLING_SITE`
  (of licht afgeschermd: `emailEnc: "<base64>"`, met
  `printf '%s' 'naam@adres.nl' | base64`). De contactband maakt dan
  vanzelf weer een mailknop + adres.
- **formulier:** koppel een statische form-dienst (bv. Web3Forms);
  het adres staat dan bij die dienst, niet in de site. Vergt een klein
  extra `form`-blok in `assets/render.js` — niet nu gebouwd.

Zolang er geen `email`/`emailEnc` is, blijft de stub staan.

## Voor het echt live gaat

- In elke `*.html` staat nu `<meta name="robots" content="noindex">`
  (werk in uitvoering). Haal dat weg zodra de site echt vindbaar mag zijn.
- Loop de teksten in `content/` na op toon en juistheid — ze zijn een
  bewerking van `Project Files/Aanpak/`, geen letterlijke overname.
