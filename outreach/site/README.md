# Onderling — site (outreach)

Nieuwe publiekssite, opnieuw opgezet vanuit de oude `apps/website/`
(die blijft staan als bron). Geen app — vandaar buiten `apps/`.

**Openen:** dubbelklik `index.html`. Geen build, geen server, werkt
offline. Tekst staat los van de indeling: HTML-shells + `assets/`
(render-engine + opmaak) + `content/*.js` (de teksten als data).

## Indeling

```
0  index.html            home: probleemschets & uitgangspunten
   waarom.html            0a · waarom dit project
   hoe-het-werkt.html     0b · hoe werkt het / jij houdt de controle
   onafhankelijkheid.html 0c · het plan om onafhankelijk te blijven
1  thuis.html             Thuis & privé (doorlopend voorbeeld, draait al)
2  buurt.html             Buurt & omgeving            [stub — CP2]
3  werk.html              Werk & maatschappij         [stub — CP2]
4  techniek.html          Technische principes        [stub — CP2]
   stand-van-zaken.html   Stand van zaken             [stub — CP2]
   vragen.html            Vragen (FAQ)                [stub — CP2]
   contact.html           Contact (stub: geen e-mail)
```

Secties 2/3/4 + stand/vragen krijgen in latere checkpoints subpagina's
en volledige tekst (zie de afgesproken schets).

## Toon

Verhalende delen (0, 1, voorbeelden) in lopend, gevarieerd proza —
bewust niet staccato. Bullets/stappen alleen waar het echt een lijst is.
Kernbelofte één keer (home), elders verwijzen. Vermijd: "commercieel",
het woord "patroon", "de bot"/"het systeem". Categorieën per leefsfeer
(thuis / buurt / werk & maatschappij), die expliciet één basis delen.

## Contact / e-mail

Geen e-mailadres op de site. De contactband toont `contact.stub` uit
`content/site.js`. Later mailto terug: `email: "naam@adres.nl"` (of
`emailEnc` met base64) in `site.js`. Formulier: aparte form-dienst
koppelen (niet nu gebouwd).

## Online zetten

Publiceer een schone kopie, nooit deze map zelf:

```sh
bash maak-publieke-kopie.sh        # → ../site-publiek/
```

Het script bewaart een bestaande Vercel-projectkoppeling (`.vercel`),
zodat een herhaalde deploy hetzelfde project bijwerkt. Pas wanneer we
tevreden zijn wijzen we `onderling.vercel.app` naar deze nieuwe site
(de oude blijft tot dan).

`<meta name="robots" content="noindex">` staat in elke pagina; weghalen
zodra de site echt vindbaar mag zijn.
