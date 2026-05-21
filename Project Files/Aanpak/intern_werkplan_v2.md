# Intern werkplan — gelaagde bouw met subsidie-spoor

*Werkdocument voor solo ontwikkeling, juni 2026 — eind 2027*

*Onderdeel van de [Aanpak](index.md) (begin bij de
[leek-uitleg](uitleg_voor_leek.md)). Dit plan verbindt de twee sporen:
het **commerciële** spoor — [commerciële verkenning](commerciele_verkenning.md)
plus [vijf vervolg-richtingen](vijf_vervolg_richtingen.md) — en het
**gesubsidieerde/lokale** spoor —
[lokale inbedding](verkenning_lokale_inbedding.md).*

Dit plan vervangt eerdere ontwikkelschetsen. De uitgangssituatie is: solo founder, 32-45 uur effectief per week, een werkende v0 van een Telegram-bot met LLM-integratie in een huishouden, Solid-pod-integratie in voorbereiding, achtergrond in AI en filosofie, bewezen vermogen om end-to-end systemen te bouwen, sterke Groningse netwerken, nauwe contacten met een vooruitstrevend VvE-bestuur, en huisgenoten die al een eerste versie gebruiken. Financiële runway: 2-4 maanden zonder inkomen, 6-8 maanden met €1000/maand vanaf juli. Geen jaar.

De strategische logica is dat de bouw zich uitbreidt in concentrische ringen — huishouden, VvE, buurt — en pas extern commercieel gaat zodra de bovenste twee ringen werken. Tegelijk loopt een actief subsidie-spoor om inkomen veilig te stellen vóór de runway krap wordt, en wordt commercieel materiaal voorbereid voor later. Een noodluik (parttime werk in jouw vaardigheidsdomein) staat gereed maar wordt pas geactiveerd als de subsidie-route faalt.

---

## Deel I — De financiële werkelijkheid

Eerst geld, dan plan. Geen ontwikkelplan houdt stand zonder een realistische cash-flow-route.

### De runway en de drempels

Met 2-4 maanden volle buffer en 6-8 maanden bij €1000/maand vanaf juli, zijn er drie scharnierpunten:

**Drempel 1 — Eind augustus 2026 (~3 maanden vanaf nu):** moet zicht zijn op een eerste concrete geldbron. Dat hoeft geen uitbetaling te zijn, wel een toegezegde subsidie, een getekend contract, of een gesprek dat met serieuze waarschijnlijkheid binnen 6-8 weken tot geld leidt. Als dat er niet is, begint de stress te wegen.

**Drempel 2 — Eind oktober 2026 (~5 maanden vanaf nu):** moet €1000+ per maand binnenkomen. Eén klein contract, een uitbetaalde subsidie, of een parttime constructie. Zonder dit moet het noodluik geactiveerd worden.

**Drempel 3 — Eind januari 2027 (~8 maanden vanaf nu):** moet €1500-2500 per maand structureel binnen zijn, of er moet duidelijkheid zijn over een grotere subsidie of een betalende eerste klant. Anders is de strategie aantoonbaar niet werkend en moet er fundamenteel herzien worden.

Deze drempels zijn geen doel maar diagnostiek. Ze laten je weten of het plan werkt of niet, op een moment dat je nog kunt bijsturen.

### De vier inkomensroutes

Vier potentiële geldbronnen, met heel verschillende karakteristieken:

**Route 1 — Snelle kleine subsidie (Inwonersbudget Nij Begun, €1-10K).** Beslis-termijn: weken tot enkele maanden. Vraagt: een buurtinitiatief of bewonersgroep als formele aanvrager, jij als technische partner. Dekt: een pilot, niet jouw loon — maar als jouw begeleiding in het projectbudget zit, levert het wel directe inkomsten op (bijv. €4-6K voor 1-2 maanden werk binnen het project).

**Route 2 — Middelgrote regionale subsidie (Impulsloket NPG €25K, of via Sociale Agenda).** Beslis-termijn: 2-6 maanden. Vraagt: een sterkere coalitie (buurtorganisatie + coöperatie of welzijnspartij), gepubliceerd plan, soms een eerste pilot. Dekt: enkele maanden volledig werk.

**Route 3 — Toukomstproject-partnership.** Geen subsidieaanvraag, maar betaald werk in een lopend project (Roemte, Oogst van Groningen, Het Stille Goud, VanOnderen!). Doorlooptijd: vergelijkbaar met regulier opdrachtwerk — 2-4 maanden van eerste gesprek tot eerste factuur. Dekt: afhankelijk van scope, kan tussen €5K en €30K per opdracht zijn.

**Route 4 — Noodluik: technische consultancy / lesgeven / AI-implementatie.** Op basis van je profiel (AI-bachelor, filosofie-bachelor, end-to-end systeem-ervaring, Prefect/Kedro/pipelines) zijn er meerdere richtingen mogelijk. Tarief realistisch €60-90/uur voor kleine MKB-klussen, €80-120/uur voor specialistische opdrachten, hoger bij training of dagdelen. Twee dagen per week aan dit type werk = €2000-3500 bruto per maand, voldoende voor stabilisering.

### De cash-flow-prioritering

Niet alle routes parallel inzetten met gelijke energie. Volgorde:

**Eerst Route 1.** Snelste tijdsafstand tot uitbetaling, sluit direct aan op huishouden→VvE→buurt-bouw. De buurt-aanvraag wordt jouw eerste concrete subsidie-traject, met de VvE of een nabijgelegen bewonersgroep als formele aanvrager.

**Parallel Route 3 verkennen, niet uitwerken.** Twee tot drie gesprekken (Roemte voorop) om te peilen of er een natuurlijke aanleiding is. Geen voorstellen schrijven tot er aanleiding voor is.

**Route 2 voorbereiden, niet activeren.** Wordt relevant zodra Route 1 een eerste pilot heeft opgeleverd — dan is er materiaal voor een sterker verhaal. Concreet: maand 4-6.

**Route 4 in de la, maar tastbaar.** Eén pagina met een aanbod-omschrijving, twee of drie potentiële klantenprofielen op papier, een netwerkmoment per maand om die hoek warm te houden. Niet actief verkopen, wel klaar om binnen twee weken te kunnen starten als nodig.

### De NLnet-vervolgaanvraag — bewust apart

Aparte route, want andere tijdslogica. NLnet is voor de SDK en het protocol, niet voor jouw loon op de korte termijn. Beslis-termijn typisch 2-4 maanden, uitbetaling per milestone over typisch 12-18 maanden. Het is goed werk om aan te schrijven, maar reken er niet op voor de cash-flow vóór drempel 1 of 2. Wel relevant voor 2027.

---

## Deel II — De gelaagde bouw

Drie concentrische ringen, met elk eigen leerdoel en exit-criteria.

### Laag 1 — Huishouden

**Stand van zaken:** loopt al, huisgenoten gebruiken een eerste versie.

**Wat hier ontwikkeld wordt:** de basisfunctionaliteit van de stack, gericht op gedeelde huishoudelijke organisatie (boodschappen, taken, herinneringen). De Solid-pod-integratie wordt hier eerst getest. Dit is de plek waar technische experimenten met lage sociale kosten kunnen.

**Wat er bovenop moet in de komende 6-8 weken:**
- Stabiele Solid-pod-koppeling (één pod per huisgenoot, plus een gedeelde "huishouden"-pod).
- Eerste versie van de co-redactie-flow — niet voor feedback maar voor taakvoorstellen: bot stelt iets voor, gebruiker bevestigt of past aan vóór actie. Dit is precies de bouwsteen die later in elke feedback-toepassing terugkomt.
- Multi-user-flow getest: meerdere huisgenoten parallel, taken verdelen, herinneringen.
- Documentatie van wat werkt en wat schuurt — niet voor anderen, voor jezelf en latere subsidie-aanvragen.

**Exit-criteria voor laag 2:** de huisgenoten gebruiken het zonder ergernis. Niet "ze zijn enthousiast" — dat zegt weinig — maar specifiek: ze openen de bot ongevraagd voor minstens twee verschillende doelen, en ze klagen niet meer over basis-UX-fricties. Realistisch: 4-6 weken doorontwikkeling.

### Laag 2 — VvE

**Stand van zaken:** bestuur is bereikbaar, vooruitstrevend, persoonlijke omgang. Voorwaarde voor introductie: laag 1 moet eerst werken in jouw huis.

**Wat hier ontwikkeld wordt:** uitbreiding naar een groep die geen huishouden vormt — een diverse groep volwassenen, met verschillende digitale vaardigheden, met soms politieke spanningen, met formele besluitvorming. Dit is een fundamenteel andere testomgeving dan een huishouden, en levert lessen op die je in je eigen huis niet kunt leren.

**Wat de VvE-toepassing wordt:** waarschijnlijk niet feedback-georiënteerd in eerste instantie, maar praktisch: gemeenschappelijke taken (sneeuwruimen, tuinonderhoud, vergaderingen voorbereiden), agenda's, herinneringen, simpele participatie ("hoe denken jullie over voorstel X?"). De feedback-laag komt erbij zodra de basisorganisatie loopt.

**Wat er bovenop moet:**
- Onboarding-flow voor mensen die jou misschien wel kennen maar niet vertrouwen met hun data. Eerste echte test van uitleg-zonder-jargon.
- ACL en groepenstructuur volwassen genoeg om verschillende rollen te onderscheiden (bestuur ziet meer, bewoners zien minder, buitenstaanders zien niets).
- Een eerste primitieve co-redactie-flow voor échte feedback ("hoe vond u de laatste ledenvergadering?") met k-anonymity drempel.
- Documentatie en demonstratie-materiaal — want vanaf hier wordt het bruikbaar in subsidie-aanvragen en partner-gesprekken.

**Inzet vanuit het bestuur:** vooraf afkaarten dat dit een experiment is, dat ze meedoen als designpartner, dat er geen verwachtingen zijn over een eindproduct. Mijn aanbeveling: één bestuurlijke toezegging op papier, niet uitgebreid, wel concreet ("wij testen mee van X tot Y, leveren feedback, gebruiken het voor onze eigen organisatie").

**Exit-criteria voor laag 3:** minstens een derde van de VvE-leden gebruikt actief mee, het bestuur kan uit eigen ervaring spreken over wat werkt en wat niet, en je hebt minstens één concrete situatie meegemaakt waarin de tool werkelijk waarde toevoegde (een afgehandelde gemeenschappelijke taak, een vergadering die beter voorbereid was, een conflict dat genuanceerder verliep). Realistisch: 2-3 maanden vanaf start van VvE-introductie.

### Laag 3 — Buurt of straat of bewonersgroep

**Stand van zaken:** wordt voorbereid maar nog niet geactiveerd.

**Wat hier ontwikkeld wordt:** de eerste écht externe pilot, met mensen die jou niet persoonlijk kennen. Hier wordt de skill-app, taken-app, of een mengvorm getest. Dit is waar Route 1 (Inwonersbudget) op aansluit — een buurtinitiatief vraagt aan, jij bent technische partner, de aanvraag dekt een coördinator, koffie, drukwerk, en een vergoeding voor jouw begeleiding.

**Wat de keuze van buurt bepaalt:** nabijheid van je woonomgeving, een actieve dorps- of buurtvereniging als mogelijke aanvrager, en een natuurlijk thema (energietransitie, voedseltuin, eenzaamheidsinterventie, of gemeenschappelijke ruimte) waar de skill-/taken-app waarde toevoegt.

**Wat er nog ontbreekt voordat deze laag start:**
- Werkende laag 1 en 2 als bewijslast.
- Een lokale aanvrager-partner — kritieke pad.
- Subsidie-aanvraag of betaalde opdracht in voorbereiding.

**Realistische start:** maand 4-6, mits de eerste twee lagen op tempo gaan en een partner zich aandient.

### Doorlooptijd van de stack-ontwikkeling

De zes lagen van de gedeelde stack (co-redactie, filter-pipeline, k-anonymity, aggregatie-pod, curatie-werkbank, drie-sporen-router) zijn niet allemaal direct nodig. De volgorde wordt nu:

- **Maand 1-2 (juni-juli):** co-redactie-flow basis, aggregatie-pod-architectuur. Voor laag 1.
- **Maand 3-4 (aug-sep):** uitbreiding voor laag 2 — ACL-volwassenheid, multi-user, eerste filter-pipeline.
- **Maand 5-7 (okt-dec):** voor laag 3 — k-anonymity drempel, curatie-werkbank in primitive vorm, drie-sporen-router.

Geen volledig uitontwikkelde stack vóór een externe pilot — dat is perfectionisme. Wel een stack die "goed genoeg" is voor wat de pilot vereist, met expliciete documentatie van wat nog niet af is.

---

## Deel III — Subsidie-portefeuille

Hieronder een concrete verzameling subsidie-routes, geordend op tijdsafstand tot uitbetaling en passendheid bij de drie ringen.

### Korte termijn (uitbetaling binnen 3-4 maanden)

**Inwonersbudget Nij Begun (€1-10K).** Voor inwoners van Groningen en Noord-Drenthe met ideeën die bijdragen aan leefbaarheid of sociale verbinding. Beslis-termijn relatief kort. Vraagt een buurt- of bewonersgroep als aanvrager. Jij staat in het voorstel als technische partner met een dagdeeltarief.

Mijn voorstel: dit wordt jouw eerste echte subsidie-aanvraag, in te dienen tijdens of na de VvE-fase, met een buurtinitiatief of de VvE zelf als aanvrager. Doel: een 4-6 maanden durende buurtpilot rond een concreet thema (mijn voorkeur: nabuurschap rond gedeelde klussen, of energiezuinige acties). Bedrag: maximaal €10K, waarvan €4-6K voor jouw werk.

**Loket Leefbaarheid (Provincie Groningen / Nij Begun, vergelijkbaar plafond).** Andere ingang naar vergelijkbare schaal. Voor dorpsbelangenverenigingen en bewonerscollectieven. Kan parallel met Inwonersbudget worden bekeken — afhankelijk van waar de potentiële partner het beste past.

**Kleine fondsen rond cultuur, sociaal of duurzaamheid bij de gemeente Groningen.** De gemeente heeft eigen kleine potten (Buurtinitiatieven, Wijkwethouder-budget). Per geval onder de €5K, maar combineerbaar.

### Middellange termijn (uitbetaling 4-9 maanden)

**Impulsloket NPG (€25K).** Voor inwonersgroepen en kleine ondernemers, met Economic Board Groningen als versneller. Past op een buurttoepassing met sterkere coalitie (buurtorganisatie + coöperatie of welzijnspartij). Mijn voorstel: pas indienen na de eerste pilot via Inwonersbudget — dan is er bewijslast.

**Sociale Agenda Nij Begun (middelgrote subsidies).** Voor projecten die structureel bijdragen aan sociale kwaliteit. Vereist sterker plan, vaak meerjarig. Past zodra een coöperatie meedoet — Grunneger Power, GrEK, of een wooncoöperatie als drager.

**Toukomstproject-partnership.** Geen formele aanvraag maar opdrachtwerk binnen een lopend project. Roemte staat bovenaan vanwege meta-positie. Oogst van Groningen heeft adviseurs die ondersteunen bij aanvragen. Het Stille Goud past inhoudelijk bij eenzaamheid/welzijn. VanOnderen! past bij participatie-toepassingen. Verkennen door 2-3 oriëntatiegesprekken in de eerste 2-3 maanden.

**Stimuleringsfonds van een coöperatie zelf.** Sommige Groningse coöperaties (vooral energie, soms zorg) hebben eigen kleine innovatiebudgetten voor ledenservices. Niet officieel geadverteerd, ontstaan via gesprek. Verkennen tijdens partner-zoektocht.

### Langere termijn (uitbetaling 6-18 maanden)

**NLnet vervolgaanvraag.** Voor de SDK / protocol / agent-laag. Niet voor levensonderhoud nu, wel voor jaar 2 en voor het bredere narratief. Volgende deadline opzoeken en in voorbereiding zetten — een goed onderbouwde aanvraag is 3-4 weken werk.

**NGI Sovereign Tech Fund of vergelijkbare EU-routes.** Voor protocol-werk dat als publieke infrastructuur wordt gepresenteerd. Trage trajecten, hoog prestige. Realistisch voor 2027.

**ZonMw, NWO Open Science of vergelijkbaar.** Voor onderzoekstoepassing (richting onderzoek-en-interviews-business-case) in samenwerking met een academische partner. Realistisch voor 2027 zodra er academische contacten zijn.

**Provincie Groningen — grotere programmagelden.** Voor sterkere coalities en bredere projecten, vaak meerjarig. Past wanneer er een coöperatie als hoofd-aanvrager fungeert.

### Strategische opmerking over subsidie-stapeling

Het verleidelijke beeld is "ik vraag overal aan, een paar lukken, ik ben binnen". De praktijk is dat solo subsidie-aanvragen schrijven structureel onderschat wordt qua tijd, en dat parallel meerdere grote aanvragen indienen tot kwaliteitsverlies leidt. Daarom: maximaal twee aanvragen tegelijk in actieve voorbereiding, anderen in de la met een overzichtsdocument.

---

## Deel IV — Bedrijfsideeën, parallel voorbereid

De drie hoofd-businessplannen (OR-tool, emotie-zware sectoren, witlabel-licentie) en de vijf vervolgrichtingen (onderzoek, zorg, klokkenluiden, lerende organisatie, burgerparticipatie) zijn elders uitgewerkt. Wat hier komt is wat je nu al kunt doen om die richtingen klaar te zetten voor activering.

### Parallelle voorbereidingen, maand 1-6

**Stichtingsvorm onderzoeken, nog niet activeren.** Een gesprek met een Groningse notaris die ervaring heeft met stichtingen en coöperaties (Notariaat Oosterhof Leertouwer of een vergelijkbare). Doel: weten wat de opzet kost, wat statuten moeten regelen, hoe een raad van toezicht structureel werkt. Niet meer dan één gesprek nu, met heldere keuzen vastgelegd voor later.

**Raad-van-toezicht-werving voorbereiden.** Een longlist maken van potentiële toezichthouders: een privacyjurist, een vakbond- of OR-vertegenwoordiger, een ethicus uit Groningen of Utrecht, een persoon met zorg-achtergrond. Geen verzoeken sturen — die komen later. Wel oriënteren wie er bestaan en wie via warm contact bereikbaar is.

**Eerste juridische check.** Eén gesprek met een privacy-jurist (eventueel pro bono via de RUG of via een PrivacyCompany-achtige zelfstandige) over de feedback-stack architectuur. Doel: een externe blik op de aansprakelijkheidsvragen (LLM-filter-falen, k-anonymity, aggregatie-pod). Niet alles uitwerken, wel zorgen dat je niet voor een blind muurtje bouwt.

**Casestudy-template voorbereiden.** Een document-structuur klaarzetten waarin elke pilot achteraf systematisch kan worden vastgelegd: probleem, oplossing, ervaringen, lessen, kwantitatieve indicatoren. Eerste invulling gebeurt na laag 2 (VvE). Dit is materiaal voor zowel vervolg-subsidies als voor latere commerciële verkoop.

### Welke business cases gaan parallel mee in voorbereiding

Niet alle acht. Selectie:

**Burgerparticipatie (richting 5 uit vorige document).** Sluit direct aan op de laag 3-pilot. Voorbereiding: voor de buurttoepassing iets meer doordenken over hoe een gemeentelijke participatie-cyclus er specifiek uit zou zien.

**OR-tool (hoofdrichting A uit het eerste businessplan).** Niet activeren tot er meer fundament is, wel: één gesprek met iemand die een OR voorzit (warme route via netwerk), om te toetsen of het verhaal aanslaat. Niet pitchen, wel luisteren.

**Onderzoek (vervolgrichting 1).** Heeft directe aansluiting bij je RUG-achtergrond. Eén oriëntatiegesprek bij een RUG-onderzoeker in sociale wetenschappen of psychologie die kwalitatief werk doet. Doel: peilen of er interesse is in een experimentele tool, en of er een toekomstige financieringsroute bestaat (via NWO of een interne RUG-pot).

**De andere richtingen** (zorg, klokkenluiden, lerende organisatie, witlabel) blijven in de la tot eind 2027 of later. Niet nu energie aan besteden.

---

## Deel V — Tijdspad met scharnierpunten

Geen jaar-voor-jaar-uitwerking maar concrete maanden, met expliciete go/no-go-momenten.

### Maand 1-2 (juni-juli 2026): fundament

**Bouw:** co-redactie-flow basis, Solid-pod-integratie voor huishouden afronden, aggregatie-pod-architectuur opzetten.

**Pilot:** laag 1 stabiliseren in eigen huishouden.

**Subsidie-spoor:** twee oriëntatiegesprekken — één met Inwonersbudget-loket (gemeente Groningen), één met een potentiële partner (Roemte, Grunneger Power, of de VvE-bestuurder als mogelijke buurt-partner). Geen aanvraag schrijven, wel landschap kaartleggen.

**Bedrijfsspoor:** notaris-gesprek over stichtingsvorm, gesprek met privacy-jurist.

**Noodluik:** één-pager opstellen ("Wat ik aanbied"), in de la.

**Scharnier eind juli:** is laag 1 stabiel? Is er een gesprek geweest dat tot een partner-toezegging zou kunnen leiden?

### Maand 3-4 (augustus-september 2026): uitbreiding

**Bouw:** uitbreidingen voor multi-user, ACL-volwassenheid, eerste filter-pipeline.

**Pilot:** introductie van laag 2 in de VvE. Gestructureerd, met formele toezegging van bestuur.

**Subsidie-spoor:** eerste Inwonersbudget-aanvraag schrijven samen met partner, of voorbereiden voor Toukomst-partnership-route. Doel: aanvraag indienen voor eind september.

**Bedrijfsspoor:** twee oriëntatiegesprekken — één OR-voorzitter, één RUG-onderzoeker.

**Scharnier eind september (drempel 1 nadert):** is er een toegezegde subsidie of een concreet gesprek-met-uitzicht? Zo nee — actief noodluik openen.

### Maand 5-6 (oktober-november 2026): externe pilot

**Bouw:** k-anonymity drempel, curatie-werkbank eerste versie.

**Pilot:** laag 3 voorbereiden, mits subsidie/partner concreet is. Of: laag 2 verdiepen als laag 3 nog niet kan starten.

**Subsidie-spoor:** als Inwonersbudget loopt, parallel een vervolgaanvraag voorbereiden (Impulsloket of Sociale Agenda) voor begin 2027.

**Bedrijfsspoor:** als VvE-pilot succesvol is, eerste casestudy schrijven.

**Scharnier eind oktober (drempel 2):** komt er €1000+ per maand binnen? Zo nee, noodluik activeren in november.

### Maand 7-9 (december 2026 - februari 2027): consolidatie

**Bouw:** drie-sporen-router, verdere stack-volwassenheid.

**Pilot:** laag 3 actief, of laag 2 uitbreidingen.

**Subsidie-spoor:** indien eerste subsidie loopt, NLnet vervolgaanvraag schrijven; voorbereiding Toukomst-partnership of grotere coöperatie-aanvraag.

**Bedrijfsspoor:** eerste betalende klant verkennen voor laat 2027? Hangt af van validatie laag 3.

**Scharnier eind januari (drempel 3):** is er €1500-2500/maand structureel? Zo nee, ofwel parttime intensiveren, ofwel de strategie fundamenteel herzien.

### Maand 10-18 (maart - december 2027): groei en richting

Hier wordt het meer speculatief. Bij goed verlopen: tweede en derde pilot opzetten, eerste betalende klant, eerste medewerker overwegen, stichting daadwerkelijk oprichten, raad van toezicht installeren. Een van de bedrijfsideeën gaat actief in voorbereiding (waarschijnlijk OR-tool of burgerparticipatie als doorgegroeide laag 3).

---

## Deel VI — Wat deze week en wat deze maand

### Deze week (1-2 concrete acties)

**Eén:** schrijf een kort intern document — een halve A4 — waarin je vastlegt wat de huidige stand is van de bot, wat huisgenoten doen, en wat in de komende vier weken concreet wordt opgeleverd voor laag 1. Niet voor anderen, voor jezelf. Deadline voor jezelf vaststellen helpt het tempo te bewaken.

**Twee:** plan in de komende drie weken één gesprek met Roemte (mailtje vragen om kennismaking), één gesprek met je VvE-bestuur (informeel, om de pilot-mogelijkheid bespreekbaar te maken), en één gesprek met iemand die je naar het Inwonersbudget-loket van de gemeente kan introduceren.

### Deze maand

- Laag 1 stabiel voor jouw huisgenoten.
- Drie oriëntatiegesprekken (zie boven) gevoerd.
- Notaris-afspraak over stichtingsvorm ingepland of gevoerd.
- Noodluik-één-pager geschreven.
- Op één concrete vervolgvraag voor het partner-zoektocht-spoor: welke buurt of dorp past het beste bij een eerste laag 3-pilot?

---

## Deel VII — Wat ik bewust niet beslis

Een paar dingen die expliciet open blijven, om geen schijnzekerheid te creëren:

**Welke specifieke business case eerst opschaalbaar wordt.** OR-tool en burgerparticipatie zijn nu de twee meest waarschijnlijke, maar dat hangt af van waar de pilots toe leiden en welke financierings-momenten ontstaan. Niet vastpinnen voor maand 9-12.

**Hoe groot de organisatie eind 2027 is.** Een tot drie mensen is realistisch, maar of dat als freelancers, in dienst van een stichting, of als coöperatie wordt ingevuld — dat hangt af van waar het geld vandaan komt.

**Of de feedback-stack of de skill-/taken-app het primaire commerciële product wordt.** Beide kunnen, met heel verschillende karakteristieken. De pilots zullen dat laten zien.

**De rol van Solid-pods op de lange termijn.** Of het een blijvend technisch fundament is of een tijdelijke standaard die wordt vervangen, is afhankelijk van hoe de open standaarden-ruimte zich ontwikkelt. Pragmatisch: nu bouwen we erop, over twee jaar evalueren we.

---

## Slotnotitie

Dit plan is opgebouwd vanuit de realiteit dat solo werken met een krappe runway een ander plan vereist dan een goed gefinancierd team met een lange horizon. Het accepteert dat een deel van de eerste 8 maanden geen heroïsche groei zal laten zien, maar wel reëel fundament — werkende software, eerste pilots, eerste subsidie, eerste casestudy. Het accepteert ook dat parttime werk geen verraad is aan idealen, maar een instrument dat de idealen mogelijk blijft maken.

Het kritieke pad blijft het vinden van lokale partners. Daar zit het meeste risico, maar ook de grootste hefboom: één goede partner kan vier subsidies, drie pilots en een hele reeks introducties opleveren. De keuze om eerst huishouden en VvE te bouwen voordat extern wordt gegaan, geeft je de tijd om die partner zorgvuldig te kiezen in plaats van uit nood te grijpen.

Het plan is broos op precies twee punten: financiële drempels in oktober en januari, en het vinden van een laag 3-partner vóór maand 6. Op beide punten zijn er fallbacks (noodluik voor het eerste, langere voortzetting van laag 2 voor het tweede). Maar het is geen plan zonder risico — dat is in deze fase niet realistisch.
