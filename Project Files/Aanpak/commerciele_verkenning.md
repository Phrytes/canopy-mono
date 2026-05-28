# Commerciële verkenning: feedback-infrastructuur op decentrale agent-architectuur

*Werkdocument — synthese van technisch ontwerp + drie commerciële richtingen*

*Onderdeel van de [Aanpak](index.md) — het **commerciële** spoor.
Context: [leek-uitleg](uitleg_voor_leek.md) · plan:
[intern werkplan](intern_werkplan_v2.md) · uitbreidingen:
[vijf vervolg-richtingen](vijf_vervolg_richtingen.md).*

---

## Deel I — Technische synthese

Dit deel beschrijft de gedeelde architectuur waarop alle drie de commerciële richtingen rusten. Het is geen handleiding maar een referentie: wanneer in de businessplannen wordt verwezen naar "de architectuur", "de pod-laag" of "de filter-pipeline", dan staat hier wat dat is.

### Wat er onder ligt

Het onderliggende werk is een decentraal agent-netwerk waarin mensen en machines als gelijkwaardige agents opereren. Elke agent heeft skills (capabilities), een eigen profiel, en kan in groepen functioneren. Drie lagen lopen daarbij door elkaar maar moeten conceptueel uit elkaar worden gehouden:

1. **Identiteits- en datalaag** — Solid pods. WebID, profiel, skills, groepslidmaatschappen, persoonlijke data. Eigendom blijft bij de gebruiker, agents zijn portable tussen apparaten en providers.
2. **Agentlaag** — de SDK. Runtime-communicatie, skill-execution, messaging tussen agents. Skill-aanbod, skill-zoeken en ACL zijn op dit niveau opgelost.
3. **Transport- en discovery-laag** — meerdere kanalen voor verschillende scenario's: mDNS en Bluetooth voor lokale ontdekking, NKN/MQTT voor inter-netwerk communicatie, relays als store-and-forward voor wanneer apparaten niet tegelijk online zijn.

Voor de commerciële toepassingen in dit document is de relevante eigenschap: data leeft per definitie bij de gebruiker, er is geen centrale database, en de agents kunnen autonoom opereren in containerizeerbare omgevingen die ophouden te bestaan zodra hun taak afgelopen is.

### De feedback-pipeline

Voor alle drie de commerciële richtingen wordt eenzelfde pipeline gebruikt, met variërende parameters per use case. De pipeline kent zes stappen:

**1. Initialisatie.** De afnemende organisatie (OR, vakbond, zorginstelling, etc.) communiceert het kanaal en de spelregels naar de eindgebruiker. De gebruiker ontvangt een uitnodiging — typisch via een onafhankelijke route, dus niet via HR-mail. Bij activatie wordt automatisch een persoonlijke pod ingericht. De gebruiker hoeft hier niets van te weten of te beheren; voor de eindgebruiker is de ervaring "ik krijg een chat-link en ik klaag".

**2. Inname van ruwe berichten.** De gebruiker chat met een bot, bij voorkeur via een kanaal dat de gebruiker al gebruikt (WhatsApp Business API als hoofdspoor; Signal of een web-chat als alternatief; Telegram alleen waar de doelgroep dat dominant gebruikt). Hier zit een bewuste afweging: een vertrouwde app is laagdrempelig en verhoogt deelname aanzienlijk, maar is privacytechnisch zwakker omdat metadata en bezorging via een externe server lopen. Daarom bieden we daarnaast een eigen chatkanaal aan zonder afhankelijkheid van externe servers, voor gebruikers en afnemers die die afhankelijkheid niet willen accepteren. Ruwe berichten worden in alle gevallen opgeslagen in de persoonlijke pod. Tot dit punt is de inhoud uitsluitend toegankelijk voor de gebruiker zelf.

**3. Lokale filtering.** Een lokale LLM creëert per bericht een gefilterde versie waarin krachttermen, naamsgenoemingen en evident herleidbare details zijn verwijderd of geneutraliseerd. De ruwe versie blijft beschikbaar voor de gebruiker; de gefilterde versie is voorbereid voor mogelijke latere aggregatie.

**4. Co-redactie en review.** Cruciale stap. Vóór elke aggregatie krijgt de gebruiker een afkoel-periode plus een expliciete review-stap: "dit is wat we van plan zijn samen te vatten — wil je er nog iets uit halen of aanpassen?" De gebruiker is daarmee eindredacteur, niet de LLM. Dit lost juridische aansprakelijkheid voor filter-falen grotendeels op (de gebruiker heeft de tekst expliciet goedgekeurd) en verhoogt de kwaliteit van de aggregatie aanzienlijk (mensen halen impulsieve dingen er zelf uit). De gebruiker kan ook op elk moment ruwe berichten verwijderen via de chat.

**5. Aggregatie met drempel.** Goedgekeurde, gefilterde inputs worden samengevoegd in een aggregatie-pod waar niemand directe toegang toe heeft. Een tweede LLM-laag plus standaard tekststatistieken (tf-idf, topic clustering, sentiment) genereert thematische en statistische output. **K-anonymity drempel:** een patroon, citaat of thema verschijnt pas in de output als minimaal N (instelbaar, typisch 4-7) verschillende gebruikers er onafhankelijk aan hebben bijgedragen. Onder die drempel: data wordt verwijderd, niemand ziet het ooit.

**6. Curatie en rapportage.** Een onafhankelijke curatie-organisatie (zie organisatievorm hieronder) doet de laatste kwaliteitscontrole en stelt het rapport samen voor de afnemer. Drie sporen worden onderscheiden:

- **Statistisch spoor** — k-anonieme aggregatie van patronen.
- **Signaal-spoor** — incidentele zware meldingen (intimidatie, integriteit, veiligheid) gaan via een aparte route mét expliciete opt-in van de melder, en worden direct gerouteerd naar de juiste instantie (vertrouwenspersoon, klokkenluider-loket, OR-vertrouwenscommissie). Geen aggregatie, wel curatie. De k-drempel geldt hier niet — één melding is genoeg om actie te triggeren, als de melder daarvoor opt-in.
- **Curatie-spoor** — gecureerde citaten en thema's, ontdaan van herleidbaarheid, ter illustratie van het statistische rapport.

### Architecturele eigenschappen die in de pitch ertoe doen

Vier eigenschappen zijn commercieel onderscheidend en moeten in elke pitch terugkomen — vertaald naar normaal Nederlands, niet in technische termen.

*"Geen centrale database."* Er valt niets in één keer te lekken, te dagvaarden, of te hacken. Pods zijn tijdelijk-autonome containers per gebruiker. Aggregatie-pods bevatten alleen geaggregeerde, gefilterde data — niets herleidbaars.

*"De gebruiker is eindredacteur."* Geen black-box filter. De gebruiker ziet en bevestigt wat er geaggregeerd wordt.

*"Drempel ingebouwd."* Onder een minimale groepsgrootte gaat data niet door — niet "we proberen het te anonimiseren", maar "het kan architectonisch niet anders".

*"Onafhankelijke curatie."* Geen software-leverancier die ook over de data gaat. Stichting of coöperatieve organisatie met externe toezicht, transparantierapport, klachtprocedure.

### Organisatievorm

Voor alle drie de commerciële richtingen geldt dat een gewone BV een verkeerd signaal afgeeft. De infrastructuur en het narratief vragen om een stichting of coöperatie met:

- **Externe raad van toezicht** met minimaal: privacyjurist, vertegenwoordiger van een doelgroepkoepel (vakbond / patiëntenfederatie / etc.), en een ethicus of academicus uit het veld.
- **Jaarlijks transparantierapport** met aantallen verwerkte berichten, aantallen onder k-drempel weggegooid, aantallen verwijderverzoeken, klachten, escalaties.
- **Klachtprocedure** voor gebruikers die vinden dat hun input verkeerd is samengevat, met escalatie naar de raad van toezicht.
- **Publieke jaarrapportage** van sectorbrede inzichten (opt-in van klanten), als authority-marketing én maatschappelijke bijdrage.

Dit is overhead. Het is ook precies wat het bedrijf onderscheidt van twintig privacy-claimende SaaS-concurrenten. De governance is de moat.

---

## Deel II — Drie commerciële richtingen

Drie uitgewerkte businessplannen, oplopend in beleidsmatige zwaarte en onderlinge versterking. Ze sluiten elkaar niet uit; idealiter is richting A het anker-product, B de tweede markt, en C de lange-termijn-licentielaag.

---

## Richting A — OR-feedbacktool

### Wat het is

Een continu feedbackkanaal voor medewerkers, afgenomen en beheerd door de ondernemingsraad. Medewerkers chatten — wanneer en zo vaak ze willen — met een bot via WhatsApp of een vergelijkbaar kanaal. Ruwe input belandt in een persoonlijke pod waar alleen zijzelf bij kunnen. Periodiek (per kwartaal, of richting een OR-overleg) krijgt de medewerker een verzoek om de verzamelde input te reviseren en goed te keuren voor aggregatie. Goedgekeurde input gaat geanonimiseerd en gefilterd naar een aggregatie-pod. De OR krijgt een dashboard plus kwalitatief rapport. De drie sporen uit de pipeline gelden onverkort: statistisch, signaal (gerouteerd naar OR-vertrouwenscommissie of externe vertrouwenspersoon), en curatie.

### Waarom dit gat bestaat

Ondernemingsraden zitten al decennia met hetzelfde probleem: ze worden geacht de achterban te vertegenwoordigen, maar hebben tussen verkiezingen door amper contact. Gangbare instrumenten zijn medewerkerstevredenheidsonderzoek (eens per twee jaar, door of namens HR uitgevoerd, dus gewantrouwd), achterbanbijeenkomsten (slecht bezocht), en informele wandelgangen (selectiebias). De Medezeggenschap Monitor laat al jaren zien dat OR's hun grootste zwakte zien in achterbancontact — niet in expertise of mandaat.

OR's hebben drie dingen die geen andere afnemer in deze markt heeft:

- Een wettelijk mandaat dat losstaat van de werkgever (WOR art. 2 en 28).
- Een eigen budget waarvan de werkgever de faciliteiten moet vergoeden (WOR art. 22).
- Een natuurlijke buffer-positie tussen werkgever en werknemer.

Daarmee is de OR de enige afnemer in dit segment die het vertrouwensprobleem van "de baas betaalt voor de klaagchat" structureel oplost. De werkgever betaalt via art. 22, maar koopt niet, ziet niet, heeft geen toegang. Voor de medewerker is de OR de aanbieder, niet HR.

### Waarom de gebruikers het gebruiken

Drie redenen, in volgorde van belang:

1. **Regie blijft bij de medewerker.** Ruwe berichten in de eigen pod, op elk moment verwijderbaar via de chat. Bevestiging vóór aggregatie. Geen knipperend HR-dashboard.
2. **De aanbieder is niet de werkgever.** OR plus onafhankelijke curatie-organisatie. Het structurele wantrouwen "de baas leest mee" is grotendeels weg.
3. **Laagdrempelig en in het moment.** Klagen op het moment dat het opkomt via een kanaal dat ze al hebben (WhatsApp), niet wachten op een jaarlijkse enquête.

### Waarom OR's het kopen

OR's zoeken niet primair tooling, ze zoeken legitimiteit en input. Een continue, statistisch onderbouwde stroom van wat onder de achterban leeft helpt hen:

- Bij overleg met de bestuurder — feiten, geen anekdotes.
- Bij hun positionering — zichtbaar maken dat ze namens iemand spreken.
- Bij prioritering — van twintig dossiers weten welke de achterban echt raakt.
- Bij verkiezingscampagnes — meetbare achterbanbetrokkenheid.

Het commerciële verhaal is niet "betere data" maar "een sterkere OR". Dat verschil doet ertoe in de pitch.

### Prijsmodel en marktomvang

Per actieve medewerker per maand, gefactureerd aan de OR, doorbelast aan werkgever via WOR art. 22. Indicatief €2-4 per medewerker per maand voor basisdienst; meerprijs voor diepe curatie-rapportages, ad-hoc thematische analyses, of integratie met OR-procesondersteuningstools.

Een organisatie van 500 werknemers: €12.000-24.000 per jaar. Vergelijkbaar met of goedkoper dan jaarlijks medewerkersonderzoek door bestaande spelers, maar dan continu en onafhankelijk.

In Nederland zijn er circa 16.000-18.000 OR-plichtige organisaties (vanaf 50 werknemers), met grofweg 2,5 miljoen werknemers binnen die organisaties. Bij circa 70-75% actieve OR's zit je op 1,7-1,9 miljoen werknemers binnen bereik. Bij 1% adoptie en €30 per medewerker per jaar: €500-570K ARR. Bij 5%: €2,5-2,9M. Bij 10% op termijn: €5-6M. Geen mega-markt, wel voldoende voor een gezond bedrijf van 10-20 mensen.

### Distributie

Verkoop via vakbonds-koepels (FNV, CNV, VCP — alle drie hebben OR-ondersteuningsafdelingen) is schaalbaarder dan losse OR-deals. Ook OR-trainingsinstituten (SBI Formaat, GBIO, BVMW Academy) en de WOR-adviesbranche zijn warme ingangen. Eerste klanten waarschijnlijk via directe acquisitie bij progressieve middelgrote organisaties (zorg, onderwijs, gemeente, woningcorporatie) met een professionele OR-voorzitter die meedenkt.

### Concurrentie en positionering

Drie soorten concurrenten, geen ervan zit precies in dit gat:

- **Engagement-tools voor HR** (Effectory, Peakon, CultureMonkey, 2DAYSMOOD, 15Five). Werkgever is afnemer en heeft toegang tot data. Verkeerde afnemer voor dit gat.
- **Klokkenluider-platforms** (SpeakUp, NAVEX, Integrity Line, FaceUp). Wettelijk verplicht, formele toon, niet voor alledaagse feedback. Mogelijk later product-uitbreiding.
- **OR-procestools** (OR-Online, OR-Direct, OR Informer). Doen vooral administratie, geen achterban-feedback. Mogelijk integratiepartners.

Positionering: "het achterbankanaal dat OR-procestools missen, met een vertrouwens-architectuur die HR-tools niet kunnen leveren."

### Risico's

*Filtering geeft valse zekerheid.* Mitigatie: gebruiker als eindredacteur (review-stap), k-anonymity drempel als technische garantie, expliciete disclaimer dat aggregatie nooit 100% anonimiseert. Vroege juridische review is voorwaarde, geen luxe.

*Adoptie door medewerkers.* Een mooie infrastructuur die niemand gebruikt is niets waard. De drempel staat of valt bij introductie. De OR moet het zelf actief introduceren als "jouw kanaal naar ons", niet als HR-tooling laten landen. Onboarding-content en best-practice-begeleiding zijn deel van het product.

*Werkgever wil het tegenhouden.* Bij sommige werkgevers wordt HR of de bestuurder zenuwachtig van een kanaal dat ze niet monitoren. WOR art. 22 geeft sterke positie maar er is politieke energie nodig. Mitigatie: framing richting werkgever als "betere dialoog, minder verrassingen, lager verloop" plus casestudies met progressieve organisaties als eerste klanten.

*Coördinatie-misbruik.* Groep medewerkers coördineert om een specifieke leidinggevende structureel slecht te laten lijken. Mitigatie deels via curatie (zulke patronen vallen op), deels via OR-procedures. Niet waterdicht, maar de schade is in proportie beperkt.

*Schaalbaarheid van curatie.* Tot circa 30-50 klanten kan dit met klein curatieteam (2-3 mensen). Daarna combinatie van geautomatiseerde curatie met steekproef-audit en externe controle. Vooraf doordenken, niet pas bij groei.

*Concurrentie met deep pockets.* Effectory of Workday kan morgen een "anoniem chat-kanaal" lanceren bovenop hun bestaande platform. Wat ze niet kunnen kopiëren is de decentrale architectuur — hun businessmodel staat of valt bij centrale data. Mitigatie: maak "geen centrale database, fundamenteel niet hackbaar of opvraagbaar" tot het hart van de positionering.

*Tussenpersoon-vertrouwen.* Je organisatie wordt zelf een vertrouwde partij. Als dat vertrouwen scheurt, scheurt het hele product. Mitigatie: stichtingsvorm, externe toezicht, transparantierapportage, strict langs één lijn lopen — geen opportunistische data-uitbreiding.

### Volgorde van uitvoeren

- **Jaar 1**: MVP, één pilot-OR (organisatie 200-500 werknemers, professionele OR-voorzitter). Sectoren: zorg, onderwijs, gemeente, woningcorporatie. Casestudy plus iteraties.
- **Jaar 2**: 5-10 OR-klanten, eerste publieke jaarrapport, contact met FNV/CNV/VCP voor distributiepartnership. Stichting opgericht, raad van toezicht geïnstalleerd.
- **Jaar 3**: Schaalbare curatie, 30-50 klanten, eerste DACH-verkenning (Duitse Betriebsrat-markt is structureel zwaarder dan onze OR), eerste verkenning richting B.

---

## Richting B — Feedback voor emotie-zware sectoren

### Wat het is

Dezelfde infrastructuur, ingezet voor sectoren waar feedback per definitie emotioneel is en bestaande kanalen falen. Niet voor "hoe was uw bezoek aan de Action" — daar werkt een formuliertje prima. Wél voor patiëntfeedback en klachtafhandeling in de zorg, ervaringen met uitkeringsinstanties (UWV, gemeentelijke sociale dienst), ouderfeedback bij onderwijsincidenten of schorsingen, klachten over woningcorporaties, en feedback van mensen die met justitie of slachtofferhulp te maken hebben gehad.

De afnemer is steeds een partij die *structureel onafhankelijk* is van degene waarover wordt geklaagd: patiëntenfederatie, ombudsman, klachtencommissie, sectorraad, koepelorganisatie. Niet de zorginstelling zelf, niet het UWV zelf — dat zou hetzelfde vertrouwensprobleem als HR-tools veroorzaken.

### Waarom dit gat bestaat

Drie redenen waarom huidige feedback-kanalen in deze sectoren niet werken:

1. **Emotionele drempel.** Een formulier invullen vlak na een nare zorgervaring werkt voor heel weinig mensen. Mensen die het wél doen zijn een gefilterd selectie — meestal de boze, met scherpe bewoordingen die voor een instelling makkelijk weg te zetten zijn als "ontevreden uitschieters". Het verhaal van de stille meerderheid wordt nooit verteld.
2. **Anonimiteit voorwaardelijk.** Patiënten die nog in behandeling zijn, uitkeringsgerechtigden die afhankelijk zijn van de instantie, ouders waarvan het kind nog op de school zit — die durven hun naam niet onder een klacht te zetten. De keuze is "anonimiteit én geen actie" of "actie én geen anonimiteit". Geen van beide is goed.
3. **Bestaande aggregatie is matig.** Klachtencommissies krijgen individuele klachten en moeten er zelf patronen in zien. Dat lukt soms (Centraal Tuchtcollege Zorg ziet patronen na 50 vergelijkbare zaken) maar duurt jaren. Patroonherkenning op het niveau van een patiëntenfederatie is nu vooral kwalitatief en traag.

### Marktstructuur en afnemers

**Zorg.** Patiëntenfederatie Nederland (250+ aangesloten patiënten- en gehandicaptenorganisaties), Zorgbelang Nederland (regionale belangenorganisaties), specifieke aandoeningsverenigingen (KWF, Diabetes Vereniging Nederland, etc.). Aanpalend: Inspectie Gezondheidszorg en Jeugd voor structurele signalen, en klachtenfunctionarissen-koepels. Mogelijk vergoeding via zorgverzekeraars (cliëntpreferentie-meting wordt steeds belangrijker in inkoopgesprekken).

**Sociale zekerheid en overheid.** Nationale Ombudsman, lokale ombudsfunctionarissen bij grote gemeenten, Cliëntenraden bij UWV en SVB. Voor onderwijs: Onderwijsinspectie, Ouders & Onderwijs, JOB voor MBO-studenten, ISO/LSVb voor HBO/WO.

**Wonen.** Woonbond, lokale huurdersverenigingen, Aedes (verhuurders-perspectief, indirect bruikbaar).

**Justitie en slachtofferhulp.** Slachtofferhulp Nederland, Reclassering, Raad voor de Kinderbescherming-cliënten (gevoelig, behoedzaam in te stappen).

### Waarom deze partijen het kopen

De waardepropositie is anders dan bij OR's. Niet "een sterkere belangenorganisatie" maar:

- **Vroege patroonherkenning.** Drie maanden eerder weten dat ergens iets structureels misgaat, in plaats van wachten tot de individuele klachten optellen.
- **Empirische basis voor lobby.** Patiëntenfederatie kan tegen het ministerie zeggen "we hebben 800 anonieme meldingen die laten zien dat..." — dat is iets anders dan "we horen van veel mensen".
- **Mandaat om door te pakken.** Een ombudsfunctionaris met data heeft een andere positie dan een ombudsfunctionaris met een gevoel.
- **Compliance met komende eisen.** De zorg krijgt geleidelijk strengere eisen rond cliëntenfeedback (Wkkgz, transitie naar uitkomstgerichte zorg). Wat nu een nice-to-have is, wordt over een aantal jaar een moet.

### Prijsmodel en marktomvang

Hier zit een ander prijsmechaniek dan bij OR's. Afnemers zijn vaak gesubsidieerde of semipublieke organisaties met andere koopdynamiek dan bedrijven. Drie modellen die kunnen werken:

- **Project-licentie per thema.** Patiëntenfederatie zet voor één jaar een kanaal op voor "ervaringen met eerstelijnszorg in regio X". Vast bedrag per project (€15-50K), met curatie-rapportage als deliverable.
- **Doorlopende licentie per koepel.** Vaste jaarbijdrage, onbeperkt thema's, eigen dashboard. €50-150K per jaar, afhankelijk van schaal.
- **Co-financiering door zorgverzekeraar of overheid.** Voor structurele inzet. Subsidiestromen (ZonMw, fondsen rond cliëntparticipatie) kunnen meebetalen aan introductie.

Markt is moeilijker te kwantificeren dan bij OR's omdat het versnipperd is en deels via projectsubsidie loopt. Indicatief: er zijn in NL circa 40-60 koepelorganisaties die structureel feedback willen verzamelen van hun achterban, plus een veelvoud aan tijdelijke projecten. Realistische ARR bij gedegen positionering na 3-5 jaar: €1-3M, met groei via subsidiestromen en EU-uitbreiding.

### Concurrentie en positionering

Anders dan bij OR's: minder directe concurrenten, meer fragmentatie en eigenbouw.

- **Klassieke onderzoeksbureaus** (Nivel in de zorg, ZorgkaartNederland, Customeyes voor cliëntfeedback). Goed in surveys, niet conversational, niet privacy-by-architecture.
- **Klachtformulier-tools** (specifieke modules van bredere CRM's). Functioneel maar geen aggregatie, geen anonimiteits-garantie van het architectonische niveau.
- **Academisch onderzoek**. Universiteiten en kennisinstituten doen het soms zelf via gestructureerde interviews. Hoogwaardig maar duur en traag.

Positionering: "patronen vinden in ervaringen die mensen nu niet durven of kunnen delen — met een architectuur die hun anonimiteit afdwingt in plaats van belooft."

### Risico's

*Gevoeligheid van data.* Bijzonder-persoonsgegevens (gezondheid, sociale situatie, justitie) vallen onder zwaarder regime van AVG. Mitigatie: van begin af aan met privacy-jurist gespecialiseerd in bijzondere categorieën, DPIA per use case, geen genoegen nemen met "het is geanonimiseerd dus AVG-irrelevant" — bijzondere categorieën blijven gevoelig zelfs als geanonimiseerd in de praktijk.

*Aansprakelijkheid bij gemiste signalen.* Wat als iemand een suïcide-signaal in de chat zet en het systeem reageert niet adequaat? Mitigatie: vooraf gedefinieerde escalatie-protocollen, herkenning van crisis-taal, automatische doorverwijzing naar 113/professionele hulp. De bot is geen hulpverlener en moet dat ook expliciet niet zijn.

*Trage besluitvorming bij afnemers.* Koepelorganisaties hebben besturen, ALV's, soms ministeriële afstemming. Verkooptrajecten van 9-18 maanden zijn normaal. Mitigatie: pilots klein houden zodat ze binnen mandaat van een directie passen, en parallel werken aan opschaling.

*Politiek gevoelig.* Een patiëntenfederatie met data over slechte zorg bij specifieke instellingen heeft macht. Niet iedereen vindt dat fijn. Mitigatie: governance vooraf, geen private toegang voor instellingen tot data over henzelf, transparantie over methodologie.

*Tactische uitsluiting door grote spelers.* Een grote zorginstelling kan haar cliënten ontmoedigen om mee te doen, of een gemeente kan een ombudsfunctionaris budgettair knijpen. Mitigatie: meerdere paden tegelijk, niet afhankelijk worden van één afnemer.

### Volgorde van uitvoeren

Niet vanaf nul. Deze richting bouwt voort op richting A (validatie van de stack, eerste curatie-ervaring, opgebouwde reputatie). Stappenplan:

- **Pre-pilot (parallel aan jaar 2 richting A)**: één gesprek per maand met Patiëntenfederatie, Nationale Ombudsman, een patiëntenorganisatie voor een specifieke aandoening. Niet verkopen — luisteren wat hun grootste informatie-gat is. Daaruit ontstaat de juiste eerste use case.
- **Jaar 3**: eerste pilot, waarschijnlijk in de zorg (sterkste vraag, meeste financieringsstromen, beste passend bij architectuur). Project-licentie van 6-12 maanden bij één specifieke koepel rond één specifiek thema.
- **Jaar 4-5**: doorbreken naar 5-10 afnemers, mogelijk eerste EU-pilot via een Europese federatie of EHDS-spoor (European Health Data Space — hier kan onze decentrale architectuur conceptueel sterk landen).

---

## Richting C — Witlabel-infrastructuur (licentie + revenue share)

### Wat het is

De stack zelf — pod-laag, agent-SDK, transport, filter-pipeline, aggregatie — als licentieproduct voor derde partijen die er hun eigen frontend op bouwen. Geen eindgebruiker-product, geen curatie-dienst, alleen de infrastructuur.

Afnemers: bestaande klokkenluider-platforms die willen migreren naar een privacy-by-architecture model, vakbonden in andere landen die hun eigen versie van richting A willen, onderzoeksbureaus die hoogwaardig kwalitatief onderzoek doen, universitaire onderzoeksgroepen, internationale koepels.

### Waarom dit gat bestaat

Bestaande SaaS-spelers in feedback en klokkenluiden hebben centrale databases. Dat is een fundamentele architectuurkeuze die ze niet zomaar kunnen omdraaien — hun hele product zit erop. Tegelijk groeit de druk op die spelers:

- **EU AI Act en strengere AVG-handhaving** maken centrale databases met emotionele input steeds risicovoller.
- **Klanten in publieke sector** (zorg, overheid, onderwijs) vragen vaker expliciet om "geen vendor lock-in, data blijft in NL/EU".
- **Whistleblower-richtlijn** vereist sinds 2023 dat organisaties met 50+ medewerkers een meldkanaal hebben. Veel spelers haasten zich naar deze markt maar bouwen op centrale infrastructuur — wat juist hier riskant is.

Voor deze spelers is "complete herbouw" geen optie en "doen alsof" wordt steeds moeilijker. Een licentie op een kant-en-klare decentrale stack onder hun eigen merk is een uitweg.

### Wat de afnemer krijgt

- De volledige stack als licentie, inclusief updates en doorontwikkeling.
- Integratie-support en SDK-documentatie.
- White-label dashboard (zij brengen huisstijl in, wij leveren functionaliteit).
- Optioneel: curatie-as-a-service voor afnemers die niet zelf een curatie-team willen opbouwen.

Wat ze niet krijgen: exclusiviteit (de stack wordt aan meerderen gelicentieerd), eigen aanpassingen aan de architectuur (alleen aan de frontend), of toegang tot data van andere licentiehouders.

### Prijsmodel

Combinatie van licentie en revenue share. Indicatief:

- **Eenmalige integratie-fee**: €25-100K, afhankelijk van schaal en complexiteit van de afnemer.
- **Jaarlijkse licentie**: minimumbedrag (€20-50K) plus percentage van omzet (5-15%) die de afnemer met de stack genereert.
- **Curatie-as-a-service** (optioneel): aparte prijsstelling, vergelijkbaar met richtingen A en B.

Dit is een hoger-marge product dan A of B, maar met langere salescycles en meer technische integratie-overhead. Geschikt zodra het basisproduct stabiel is en er bewijslast is van werkende implementaties.

### Doelgroep — concreet

**Whistleblower-platforms in EU.** SpeakUp, FaceUp en vergelijkbaren zoeken differentiatie. Decentralisatie is een mogelijke wedge.

**Vakbonden in DACH en Scandinavië.** De Duitse Betriebsrat is institutioneel sterker dan onze OR. Een Duitse vakbond die "onze versie van richting A" wil bouwen onder eigen merk is een natuurlijke afnemer.

**Onderzoeksbureaus en universiteiten.** Kwalitatief onderzoek waar respondent-anonimiteit en data-eigenaarschap voorwaarde zijn. Niche maar hoogwaardig.

**EU-instituten en internationale NGO's.** Sommige hebben behoefte aan veilige feedback-kanalen voor doelgroepen in onveilige contexten (klokkenluiders bij multinationals, ervaringsverhalen van vluchtelingen, etc.). Klein in volume maar prestigieus en passend bij het narratief.

### Waarom dit niet vroeg moet

Richting C is een natuurlijk eindpunt, geen startpunt. Drie redenen om het pas in jaar 4-5 echt op te starten:

1. **Pre-mature standaardisering.** De stack moet stabiel zijn voordat je 'm aan derden licentieert. Anders verkoop je bugs.
2. **Bewijslast.** Afnemers van witlabel-infrastructuur willen referenties zien. Richting A en B leveren die.
3. **Capaciteit.** B2B-infrastructuur-verkoop is een ander vak dan SaaS-aan-OR's. Vraagt om commercieel team met enterprise-ervaring, partner-management, integration engineers. Dit is bouwen voor later.

### Risico's

*Concurrent kopieert open source.* De agent-SDK en delen van de stack zijn open source (deel van het narratief, deel van de NLnet-aanvraag). Dat betekent dat concurrenten in principe ook kunnen bouwen. Mitigatie: het waardevolle zit niet alleen in de code maar in (a) de curatie-praktijk, (b) de governance-laag, (c) de relaties met afnemers en koepels, (d) de gecombineerde stack-with-services. Open source bouwen helpt eerder dan dat het schaadt — het verlaagt drempels voor adoptie en bouwt geloofwaardigheid.

*Afhankelijkheid van enterprise-cyclus.* Een paar grote licentie-deals leveren meer omzet dan honderd kleine, maar vallen langzamer en zijn moeilijker te voorspellen. Mitigatie: niet vroeg leunen op deze richting voor cashflow.

*Reputatieschade door licentiehouder.* Als een afnemer de stack inzet op een manier die ons narratief tegenspreekt (bijv. een staat die het gebruikt voor surveillance), staan we daar moreel mede voor. Mitigatie: licentievoorwaarden met expliciete use-case-beperkingen, raad van toezicht beoordeelt grote licentiedeals, recht om licenties te beëindigen bij misbruik.

---

## Deel III — Samenhang en volgordelijke uitvoering

### Hoe de drie richtingen elkaar versterken

Richting A bouwt de stack-met-curatie en de governance-structuur. Eerste klanten, eerste curatie-ervaring, eerste publieke rapport, opbouw van geloofwaardigheid in NL. Dit is het anker.

Richting B hergebruikt dezelfde stack maar in een ander marktsegment met andere financieringsdynamiek. De pilots in B versterken het maatschappelijke verhaal richting subsidiegevers en publiek; de inkomsten uit A betalen mee aan de aanloopkosten in B.

Richting C zet de stack van A en B in als infrastructuur-licentie. Dit is mogelijk omdat A en B aantonen dat de stack werkt en omdat de governance-laag bewezen is.

### Wat in alle drie hetzelfde is

De pipeline (zes stappen, drie sporen). De architectuur (Solid pods, agents, k-anonymity). De governance (stichting/coöperatie, externe raad, transparantierapport). De publieke jaarrapportage. De wel/niet-lijst van wat het product is en niet is.

### Wat verschilt

Afnemer, prijsmodel, distributie, regulatoire context. A is OR/vakbond, vast prijspunt per medewerker. B is sectorale koepel, project-licentie of jaarlicentie, vaak gesubsidieerd. C is enterprise-licentie plus revenue share.

### Timing-overzicht

- **Jaar 1**: Richting A — MVP, pilot-OR.
- **Jaar 2**: Richting A — schaal naar 5-10 klanten, stichting opgericht, eerste publieke rapport. Voorverkenning B.
- **Jaar 3**: Richting A — 30-50 klanten. Richting B — eerste pilot in zorg.
- **Jaar 4**: Richting A — geconsolideerd. Richting B — 5-10 afnemers, eerste EU-verkenning. Richting C — eerste licentie-experiment.
- **Jaar 5**: Drie richtingen draaien parallel, met onderlinge versterking en gedeelde infrastructuur.

### Wat de richtingen samen waard maken

Een typische SaaS-feedback-tool concurreert op feature-set en prijs. Wat hier ontstaat is iets anders: een infrastructuur waarvan de architectuur het vertrouwen draagt, met een organisatie eromheen die dat vertrouwen institutioneel borgt, in drie markten waar dat vertrouwen voorwaarde is voor het product werkt.

Dat is moeilijker te bouwen dan een SaaS-tool. Het is ook moeilijker te kopiëren.
