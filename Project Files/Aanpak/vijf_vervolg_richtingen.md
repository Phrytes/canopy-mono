# Vijf vervolg-richtingen op de decentrale feedback-infrastructuur

*Werkdocument — uitwerking van de toepassingsgebieden die buiten de drie hoofd-businessplannen vielen*

*Onderdeel van de [Aanpak](index.md) — "wat erna / ernaast" op het
**commerciële** spoor. Context: [leek-uitleg](uitleg_voor_leek.md) ·
plan: [intern werkplan](intern_werkplan_v2.md) · basis:
[commerciële verkenning](commerciele_verkenning.md).*

Dit document bouwt voort op het eerdere stuk ([commerciële verkenning](commerciele_verkenning.md)) waarin de technische pipeline en drie hoofd-businessplannen staan. De vijf richtingen hier gebruiken **dezelfde** onderliggende stack: persoonlijke pods, lokale LLM-filtering, gebruiker als eindredacteur, k-anonymity drempel, onafhankelijke curatie-organisatie. Wat verschilt is de toepassing, de afnemer, en het verdienmodel.

De richtingen verschillen in volwassenheid. Sommige zijn een natuurlijke uitbreiding van het OR-product (richting 4: lerende organisatie). Andere zijn een aparte markt met aparte verkoop (richting 1, 2, 3, 5). Geen van deze is bedoeld als startpunt — ze zijn allemaal "wat erna" of "wat ernaast". Een paar zijn behoorlijk creatief; ik heb me daar niet ingehouden, je vroeg er expliciet om.

---

## Richting 1 — Onderzoek en interviews

### Probleemstelling

Kwalitatief onderzoek leunt op interviews, focusgroepen en dagboekstudies. De respondent levert ruwe, vaak gevoelige input ("ik heb meegemaakt dat...", "in mijn organisatie gebeurt..."). Wat er vervolgens met die input gebeurt is voor de respondent ondoorzichtig: het verdwijnt in een transcript, wordt gecodeerd in NVivo of ATLAS.ti, en duikt jaren later op in publicaties met soms onverwachte framing. De respondent heeft op dat moment geen mogelijkheid meer om context toe te voegen, te corrigeren, of zich terug te trekken.

Dit creëert drie problemen die de kwaliteit van onderzoek aantoonbaar drukken:

1. **Anonimiteits-wantrouwen.** Respondenten zelfcensureren omdat ze niet zeker weten hoe het transcript gaat reizen. Onderzoekers krijgen voorzichtigere antwoorden dan optimaal.
2. **Geen herziening na afkoeling.** Mensen zeggen in een interview dingen die ze achteraf overdreven of ongelukkig geformuleerd vinden. Klassieke transcripten bevriezen die formuleringen.
3. **Datalogistiek is een gevaar.** Onderzoekers slepen transcripten via Dropbox, e-mail en lokale schijven. Lekken gebeuren routinematig. Ethische commissies (METC's, ETH boards) worden steeds strenger.

Tegelijk staat de markt op een kantelpunt. De klassieke tools (NVivo, ATLAS.ti, MAXQDA) hebben een legacy-interface en bestandsformaten waar moderne onderzoekers op afhaken, en NVivo en ATLAS.ti zijn sinds september 2024 onder dezelfde paraplu (Lumivero) — wat betekent dat de markt nu effectief één grote speler heeft die langzaam beweegt, plus een groeiende laag AI-tools (Dovetail, Skimle, UserCall) die snelheid bieden maar weinig aan respondent-rechten doen.

### Productbeschrijving

**Naam-werktitel:** een onderzoeksplatform waarin respondenten een eigen pod krijgen voor de duur van het onderzoek (en eventueel daarna). De pod bevat hun bijdragen, hun toestemmingsverklaringen, en hun reviseringen.

**Wat de respondent ervaart:** een uitnodiging via een vertrouwde route (universiteit, patiëntenorganisatie, beroepsgroep). Activatie via chat — geen aparte app. De respondent kan voice-berichten of tekst sturen, met of zonder structuur (open dagboek versus gestructureerd interview-protocol). Na elke significante input volgt een afkoel-moment, daarna een review-uitnodiging: "dit is wat de onderzoeker zou zien — wil je iets aanpassen, weghalen, of context toevoegen?" De respondent kan op elk moment input intrekken, ook maanden later.

**Wat de onderzoeker krijgt:** gestructureerde toegang tot goedgekeurde, gefilterde transcripten plus een ingebouwd codeer- en analysevlak. Codering kan automatisch (LLM-suggesties) of handmatig, met volledige traceability naar bronfragmenten. Voor team-onderzoek: gedeelde codebooks zonder dat ruwe data gedeeld hoeft. Voor longitudinaal onderzoek: respondenten kunnen meerdere onderzoeksprojecten in dezelfde pod aanleveren, zonder dat onderzoekers daar toegang toe krijgen.

**Wat het ethisch laat zien:** een verifieerbaar bewijspad ("audit trail") dat aan elke ethische commissie laat zien wie wat wanneer goedkeurde, hoeveel inputs zijn ingetrokken, hoeveel onder de k-drempel zaten. Bij publicatie kan de onderzoeker bewijzen dat alle gebruikte fragmenten expliciet zijn goedgekeurd door de respondent.

### Business case

**Afnemers:**

- Universiteiten en hogescholen — typisch via onderzoekspakketten of departement-licenties. Sociale wetenschappen, gezondheidswetenschappen, onderwijskunde, public administration. Nederland alleen al heeft 14 universiteiten en 36 hogescholen.
- Onafhankelijke onderzoeksbureaus — Motivaction, Kantar Public, Ipsos NL, I&O Research, Verwonderzoek voor gemeentelijk onderzoek, gespecialiseerde ethnografische bureaus.
- Beleidsadvies en consultancies — Berenschot, Andersson Elffers Felix, BMC. Doen veel kwalitatief werk voor ministeries en gemeenten.
- Patiëntenorganisaties en koepels die zelf onderzoek doen (zie ook richting 2).
- Internationale: EU-projecten (Horizon, Erasmus+) hebben behoefte aan datadeling tussen onderzoekers met behoud van GDPR.

**Prijsmodel:** seat-licenties per onderzoeker per jaar (€800-1.500), plus storage/curatie-fees voor grote projecten. Voor universiteiten institutionele licenties (€20-100K per jaar). Voor losse onderzoeksprojecten project-tarieven inclusief implementatie en exit-rapport.

**Indicatieve marktomvang:** wereldwijd CAQDAS-markt circa $200-300M, met NL-aandeel naar omzet rond €5-10M. Bij sterke positionering als "ethical-by-default" alternatief op een drukke vervangingsmarkt: 2-5% marktaandeel haalbaar over vijf jaar = €0,5-1M omzet uit NL, met EU-uitbreiding additioneel.

**Concurrentie en positionering:** je concurreert niet op feature-pariteit met NVivo — die strijd verliezen. Je concurreert op de combinatie respondent-eigenaarschap + audit-trail + EU-conform + integreerbaar in de onderzoekspraktijk. De positionering: *"Onderzoek waarin respondenten eindredacteur blijven en ethische commissies achteraf niets hoeven aan te nemen."* AI-native nieuwkomers zoals Dovetail en Skimle hebben snelheid maar geen respondent-architectuur. Klassieke tools hebben methodologische diepte maar geen privacy-by-design. Dit is een wig.

### Aanvullende diensten, rollen en producten

**Onderzoeksethiek-coach.** Een rol binnen de organisatie: een ethicus of methodoloog die METC-aanvragen begeleidt en organisaties helpt om hun studieprotocollen voor de tool te ontwerpen. Hoogwaardige consultancy, hoge marge, sterke conversiehefboom.

**REFI-QDA bridge.** Volledig compatible export naar/van NVivo, ATLAS.ti, MAXQDA via de open REFI-QDA standaard. Onderzoekers kunnen hybride werken: data verzamelen met jullie tool, later coderen in een vertrouwd pakket. Verlaagt instapdrempel dramatisch.

**Respondent-portfolio.** Stel je voor: een respondent die in jaar 1 meedoet aan een patiëntenstudie, in jaar 3 aan een werkgever-onderzoek, in jaar 5 aan een buurt-evaluatie — alles in dezelfde pod, telkens onder eigen controle. Geen versnipperde dataspoorvorming over allerlei platformen. Dit verbindt richting 1 met richting 2 en 5 en bouwt aan een infrastructuur waar respondenten persoonlijke continuïteit krijgen.

**Open Science certificering.** Een keurmerk dat onderzoek met deze tool aan vooraf-gedefinieerde transparantiestandaarden voldoet. In samenwerking met DANS, NWO, of internationaal de Open Science Framework. Marketingwaarde plus institutionele inbedding.

**AI-moderated interviewing.** Voor schaalstudies: een AI-agent voert open-eind interviews uit waar voorheen gestructureerde enquêtes werden gebruikt. Diepere data dan een formulier, schaalbaarder dan menselijke interviews. Cruciaal verschil met UserCall en vergelijkbaren: de respondent houdt nog steeds eigenaarschap over alles wat ze zeggen. Dit verbindt mooi met richting 5 (burgerparticipatie).

**Sectorale dataconsortia.** Universiteiten die met dezelfde tool werken kunnen — met respondent-toestemming — geanonimiseerde subdatasets delen voor meta-analyses. Bouwt aan netwerkeffect.

---

## Richting 2 — Patiëntenfeedback en symptoomdagboeken

### Probleemstelling

Zorg leunt steeds zwaarder op Patient Reported Outcome Measures (PROMs) en symptoomdagboeken. De Utrecht Symptom Diary (USD) is een gevalideerde Nederlandse PROM op basis van het Edmonton Symptom Assessment System en wordt gebruikt om symptomen bij kankerpatiënten te beoordelen en monitoren. Vergelijkbare instrumenten bestaan voor chronische pijn, MS, diabetes, GGZ, revalidatie, palliatieve zorg. eHealth-tools zoals patient portals en personal health records kunnen patiënten met chronische aandoeningen betrekken en empoweren — patiënten die sterk betrokken zijn bij hun zorg hebben betere ziektekennis, zelfmanagement-vaardigheden en klinische uitkomsten.

Drie problemen die dit gebied teisteren:

1. **Datasilo's per zorgverlener.** Het ziekenhuis heeft z'n eigen portaal, de huisarts heeft een ander systeem, de fysiotherapeut een derde. De patiënt typt dezelfde symptomen op drie plekken in. Niemand heeft het complete plaatje, en de patiënt is de koerier.
2. **Klinische taal versus geleefd ervaring.** Vragenlijsten zijn op een Likert-schaal ("op een schaal van 1 tot 10..."). Wat de patiënt eigenlijk wil zeggen ("het is erger 's nachts, vooral als ik me zorgen maak over m'n moeder die net is opgenomen") valt buiten het instrument.
3. **Geen retentie van eigen geschiedenis.** Patiënten die van zorgverlener wisselen, beginnen vaak weer bij nul. Hun eigen dagboek, gestructureerde observaties, en context-informatie zijn gefragmenteerd of vergaan.

Tegelijk komt er beweging in het landschap: de European Health Data Space (EHDS) wordt vanaf 2026-2027 stapsgewijs operationeel; Wkkgz vereist al transparantie over kwaliteit; zorgverzekeraars wegen patiëntervaringen in inkoopgesprekken. De infrastructuur die alles nu verbindt is centraal en hackgevoelig (Vektis, MedMij). Een decentraal alternatief past hier filosofisch én juridisch beter dan in de meeste andere markten.

### Productbeschrijving

**Wat de patiënt ervaart:** een chat-bot met persoonlijkheid die regelmatig vraagt hoe het gaat. Antwoorden in vrije tekst of voice. De bot herkent symptomen die de patiënt eerder heeft genoemd en bouwt context op ("vorige week schreef je dat de pijn 's ochtends erger was — is dat nog zo?"). Voor patiënten met chronische aandoeningen wordt dit een soort dagboek met geheugen, dat ze net zo goed voor zichzelf gebruiken als voor zorgverleners.

**Wat de zorgverlener krijgt:** met expliciete patiënttoestemming, een PROM-conform overzicht voor de gewenste tijdsperiode. Klinisch relevante extracties (pijnscores, slaapkwaliteit, mood, functionele beperkingen) gehaald uit de vrije input via een lokale LLM die getraind is op klinische taal. Patiënt is eindredacteur: voor elke deel-overdracht naar zorgverlener kan ze kiezen wat wel en niet meegaat, en kan dat later weer intrekken.

**Wat het onderscheid maakt:**

- **Pod is van de patiënt, niet van het ziekenhuis.** Wisselt patiënt van behandelaar: data verhuist mee zonder transfer-protocollen.
- **Klinische taal aan beide kanten.** De vrije input van de patiënt wordt vertaald naar klinische codes (SNOMED, ICD-10) zodat het in het EPD past. Vice versa kan informatie uit het EPD met patiënttoestemming worden weergegeven in begrijpelijke taal.
- **Drie sporen variant.** Statistisch: trends in de eigen historie zichtbaar (vorige maand sliep ik gemiddeld 5,2 uur, deze maand 6,8). Signaal: incidentele zware signalen (suïcide-ideatie, plotse verslechtering) gerouteerd naar afgesproken crisis-route. Curatie: gestructureerde overdracht met door patiënt geredigeerde context.

### Business case

**Afnemers:**

*Primair (B2B):*
- **Patiëntenorganisaties** (Patiëntenfederatie Nederland en de 250+ aangesloten organisaties; specifieke zoals KWF, MS Vereniging, Diabetesvereniging) — als deel van ledenondersteuning.
- **Specialistische klinieken en revalidatiecentra** — concrete pilots in MS-zorg, oncologie, chronische pijn, revalidatie, palliatieve zorg. Sectoren waar PROMs al ingebed zijn.
- **Ziekenhuizen via Epic/HiX-koppeling** — niet zelf het EPD vervangen, wel een schil eromheen voor patiënt-bijdragen.
- **GGZ-instellingen** — Routine Outcome Monitoring (ROM) is verplicht, huidige instrumenten worden door cliënten gehaat.

*Secundair (B2B-via-B):*
- **Zorgverzekeraars** — co-financieren omdat het inkoopgesprekken verrijkt. CZ, VGZ, Zilveren Kruis, Menzis hebben allemaal innovatieprogramma's.
- **Onderzoekscohorten** — Lifelines (Noord-NL!), Generation R, Nederlandse Kankerregistratie. Connectie met richting 1.

**Prijsmodel:** drie lagen.

1. **Patiënt** — gratis basistoegang, betaald premium (€3-5/maand) voor advanced features (export naar GP, multiparty-toegang, lange-termijn-archief).
2. **Instelling** — per actieve patiënt per maand (€2-4), zoals OR-tool maar dan via zorgverlener.
3. **Cohort/onderzoek** — projecttarief, vergelijkbaar met richting 1.

**Marktomvang:** zorg-IT in NL groeit hard. Specifiek voor PROM-/symptoom-/cliëntfeedback-tools: indicatief €30-50M markt nu, groeiend richting €100M+ over vijf jaar onder druk van EHDS, Wkkgz, en value-based care. Realistisch marktaandeel met sterke positionering: 5-10% op middellange termijn = €5-10M omzet.

**Concurrentie:** versnipperd. Klassieke PROM-leveranciers (Mediquest, Survalyzer, ART-Software) zijn formulier-based en zorgverlener-gecentreerd. Patiëntportalen (MijnZorg, MedMij-aangesloten) zijn informatie-overdracht, geen verzameling. eHealth-platforms (BeterDichtbij, Therapieland) zijn wel patiënt-gericht maar centraal en sectorspecifiek. Geen huidige speler combineert PROM-rigor, patiënt-eigenaarschap, en cross-institutionele portabiliteit.

### Risico's (specifiek voor zorg)

*Medisch hulpmiddel-classificering.* Als de tool klinische beslissingen ondersteunt, valt het mogelijk onder MDR (Medical Device Regulation). Mitigatie: bewust ontwerp als "patiënt-eigen documentatie" zonder klinische beslis-assistentie in de eerste versie; aparte productlijn voor MDR-gecertificeerde modules later. Dit moet vooraf juridisch worden uitgezocht.

*Crisis-response aansprakelijkheid.* Als een patiënt suïcide-signalen geeft en de tool reageert traag of fout, ligt jouw organisatie publiek nat. Mitigatie: vooraf gedefinieerde, gecertificeerde escalatie-protocollen met 113/professional. Geen ambitie om hulpverlener te zijn — wel de transfer naar hulpverleners professioneel doen.

*Bijzondere persoonsgegevens.* Gezondheid valt onder zwaarder AVG-regime. DPIA per use case, geen genoegen nemen met "geanonimiseerd dus geen issue".

### Aanvullende diensten, rollen en producten

**Klinische integratie-architect.** Een vaste rol: iemand die EPD-koppelingen ontwerpt (HL7 FHIR, Nictiz-standaarden). Schaars profiel, maar bottleneck voor breedte-adoptie.

**Patient-mediator.** Een onafhankelijke ondersteuningsdienst: een mens die patiënten helpt om hun data goed te begrijpen en goed te delen. Vooral voor mensen die digitaal minder vaardig zijn. Vergoedbaar via verzekeraars (basis-zorgcontract) of via maatschappelijke ondersteuning. Sociaal én commercieel waardevol.

**Symptoom-templates per aandoening.** Voor MS, oncologie, chronische pijn, etc.: vooraf-gevalideerde gespreks-templates die de bot gebruikt. Co-ontwikkeling met aandoeningsverenigingen. Verlaagt drempel voor klinische adoptie.

**EHDS-bridge.** Vanaf het moment dat de European Health Data Space operationeel wordt: jullie als eerste decentrale aanbieder die patiënt-gestuurde data-deling EU-breed faciliteert. Strategisch positie-bepaling vooraf vraagt nu al inzet.

**Geheugen-as-a-service voor patiënten.** Een premium feature: een persoonlijke AI-assistent (binnen de pod, dus privacy-veilig) die helpt om eigen klachten-geschiedenis te begrijpen ("hoe verhoudt deze week zich tot de slechte periode in januari?"). Voor patiënten met chronische aandoeningen kan dit ongelofelijk waardevol zijn.

**Mantelzorg-toegang.** Met patiënttoestemming: mantelzorger heeft beperkte view-rechten, kan helpen documenteren tijdens slechte fases, krijgt eigen lichtgewicht versie. Versterkt netwerkeffect en pakt een hard gemis aan in huidige zorg-IT.

**Onderzoekscohort-modus.** Met patiënttoestemming: bijdragen aan onderzoek door een cohort waar je toch al input voor levert. Patiënt kiest per project. Bouwt aan datacommons voor zeldzame aandoeningen waar individuele onderzoekers te weinig data hebben.

---

## Richting 3 — Klokkenluiden en integriteitsmeldingen

### Probleemstelling

De EU Whistleblower-richtlijn (2019/1937) verplicht sinds 2023 elke organisatie met 50+ medewerkers tot een meldkanaal. De richtlijn vereist dat organisaties veilige meldkanalen instellen, klokkenluiders beschermen tegen vergelding, en juiste opvolging van meldingen waarborgen — het geldt voor bedrijven met 50+ medewerkers, publieke organisaties, en gemeenten. De adoptie is hoog: meer dan 60% van Europese ondernemingen heeft een GRC-oplossing geadopteerd om compliance-uitdagingen aan te pakken, met Duitsland, Frankrijk en het VK als koplopers.

De markt is dus groot en groeiend, maar **kwalitatief slecht ingevuld**:

1. **Centrale databases bij commerciële spelers.** SpeakUp, NAVEX, Whistleblower Software, FaceUp — allemaal SaaS met centrale opslag, allemaal aansluitend op concept "wij beloven dat we het goed bewaren". Geen architecturele garantie.
2. **Klokkenluider blijft afhankelijk.** Identiteit is verborgen voor de werkgever, maar zichtbaar voor de platform-operator én voor de aangewezen interne case-handler. Hoeveelheid vertrouwen die nodig is om te durven melden = groot.
3. **Eenrichtingsverkeer.** Melder dropt een melding en moet hopen dat er iets gebeurt. Vervolg-communicatie is moeizaam ("anoniem terugmailen" werkt niet altijd). Veel meldingen sterven omdat de melder nooit weet of er iets mee gedaan is.
4. **Slechte signaal-aggregatie.** Drie afzonderlijke meldingen over hetzelfde patroon door verschillende mensen worden als drie losse incidenten behandeld. Patroonherkenning gebeurt manueel als 't al gebeurt.

Tegelijk groeit de druk: een rule-of-thumb is dat je gemiddeld één melding per 250 medewerkers per jaar kunt verwachten, en handhavingsboetes lopen op. Bestaande spelers prijzen hier rond €2.000-4.000 per jaar voor een organisatie van 200 personen — een markt met substantiële budget per klant.

### Productbeschrijving

**Wat de melder ervaart:** een kanaal dat niet door de werkgever wordt aangeboden, maar door een onafhankelijke partij (sectorraad, beroepsvereniging, vakbond, ombudsfunctionaris). Toegang via QR-code, link, of poster in de kantine. Activatie creëert een persoonlijke melder-pod waarin elke melding, elke vervolg-communicatie, en elke opvolg-stap permanent traceerbaar is — voor de melder zelf. De melder kan **zien** of de melding is opgepakt, **vragen** stellen aan de case-handler zonder dat haar identiteit lekt, en **bewijs** verzamelen over hoe de zaak is afgehandeld.

**Wat de case-handler ziet:** een melding zonder identiteitsgegevens, met gestandaardiseerd format (datum, context, ernst-indicatie, gevraagde opvolging). Kan via de tool communiceren met de melder. Cruciaal: kan **niet** uitvogelen wie de melder is, ook niet via correlatie met andere meldingen — de architectuur staat dat fundamenteel niet toe.

**Wat het onderscheid maakt:**

- **Patroon-detectie over meldingen heen**, zonder dat meldingen onderling herleidbaar zijn naar dezelfde melder. Drie meldingen over "intimidatie door manager X" worden als patroon zichtbaar voor de case-handler, zonder dat de drie melders aan elkaar gekoppeld kunnen worden.
- **Audit-trail die melder bezit.** Komt het ooit tot een rechtszaak (vergelding, of melder die zegt "ik heb gemeld, jullie deden niets"), dan bezit de melder zelf het bewijs. Dat verlaagt de drempel om te melden enorm.
- **Cross-organisatie patronen.** Sector-koepels (bijv. Zorgbelang, een vakbond, een beroepsregistratie) kunnen — als de melder dat toestaat — geaggregeerd zien dat een patroon meerdere organisaties raakt. Dit is een capability die geen huidige speler levert.

### Business case

**Afnemers:** Hier is een strategische keuze. Drie verschillende klanttypen, gradient van conservatief naar progressief:

**Type A — Compliance koper (vervangingsmarkt).** Organisaties die een Whistleblower-platform nodig hebben en kiezen voor een betere oplossing. Standard B2B SaaS. Prijspunt rond €1.500-4.000/jaar afhankelijk van grootte. Concurreert met FaceUp, SpeakUp, etc. Voordeel: bewezen vraag, voorspelbare verkoop. Nadeel: je strijdt op een al-druk speelveld, marges onder druk.

**Type B — Sectorraden en koepels.** Een vakbond, een beroepsorganisatie, een sectorraad biedt het meldkanaal aan haar leden aan, in plaats van dat individuele werkgevers het doen. Patroon-detectie op sectorniveau. €50-250K per koepel per jaar, met co-financiering door deelnemende organisaties. Voordeel: cross-organisatie patroon-inzicht is een fundamenteel nieuwe capability die niemand anders biedt. Nadeel: langere verkoopcycli, politiek complex.

**Type C — Investigative journalism en NGO's.** SafeSources voor onderzoeksjournalistiek; klokkenluider-ondersteuningsorganisaties zoals Huis voor Klokkenluiders. Niche, klein, maar hoog-prestige en sterk authoriteit-bouwend. Vaak gesubsidieerd.

**Marktomvang (NL):** circa 30.000 organisaties met 50+ medewerkers + 350 gemeenten + provincies en waterschappen. Bij gemiddeld €2.500/jaar voor een platform = ~€80M markt totaal, waarvan een groot deel nog niet of slecht is ingevuld. Bij 1% marktaandeel = €800K ARR; bij 5% = €4M.

**Concurrentie en positionering:** drukke markt aan de Type A-kant. Onderscheiden lukt alleen op architectuur ("geen centrale database, melder bezit eigen audit-trail"), niet op feature-pariteit. Het positie-statement: *"De enige meldkanaal-leverancier die structureel niet kan beloven 'we lekken niet' — omdat er architectonisch niets te lekken valt."* Markt zoekt steeds explicieter dit soort claims door toenemende compliance-druk en publieke schandalen.

### Aanvullende diensten, rollen en producten

**Compliance-officer-as-a-service.** Veel kleine en middelgrote organisaties hebben geen interne compliance-officer maar willen wel professionele case-handling. Externe service waarin jullie organisatie (of een partner) als case-handler optreedt. Significant hogere marge dan alleen software. Vereist gecertificeerde mensen.

**Sector-patroon-rapportage.** Jaarlijks een publicatie per sector (na opt-in van melders): "wat zijn de patronen die we dit jaar zagen in [zorgsector]?". Authoriteit-bouwend, mediawaardig, drukt sectorraden om aan te sluiten.

**Klokkenluider-coach.** Mens-tot-mens ondersteuning voor (potentiële) melders. Helpt ze formuleren, beoordelen of melding kansrijk is, verwijzen naar wettelijke ondersteuning. Vergoedbaar via Huis voor Klokkenluiders of via verzekering. Sociaal én commercieel waardevol; verbetert daadwerkelijke uitkomsten voor melders.

**Cross-sectorale early-warning.** Met expliciete opt-in: anonieme patronen tussen sectoren delen. Stel een toezichthouder (NZa, AFM, ACM) kan zien "er is een verhoogde meldingsdruk over financiële malversaties in pensioenfondsen". Strategisch waardevol voor de toezichthouder, mits zorgvuldig gegovernd. Verbindt naar richting 5 (overheid).

**Rechtszaak-toolkit.** Voor melders die later wettelijke stappen ondernemen (vergelding-klacht, civielrechtelijke schadeclaim): een gestructureerde export van hun melder-pod met cryptografisch verifieerbare timestamps. Significant verbeterde rechtspositie. Mogelijk product in samenwerking met advocatuur.

**Verzekerings-koppeling.** Bestuurdersaansprakelijkheidsverzekeringen (D&O) en cyberverzekeringen kunnen korting geven voor organisaties met een gecertificeerd onafhankelijk meldsysteem. Werkgever betaalt minder premie, jij krijgt distributie via verzekeraars. Onderzoek of dit een natuurlijk partnerverband oplevert.

---

## Richting 4 — Lerende organisatie en kennisborging

### Probleemstelling

Organisaties zijn slecht in het vasthouden van wat ze leren. Mensen ontdekken iets ("die leverancier levert nooit op tijd", "die procedure stap 4 werkt niet als..., dus we slaan 'm over"), maar die kennis blijft hangen bij individuen of in onhandige Confluence-pagina's die niemand bijhoudt. Bij vertrek loopt waardevolle kennis de deur uit.

Klassieke knowledge management-systemen (Confluence, Notion, SharePoint) hebben drie problemen:

1. **Drempel om bij te dragen.** Mensen moeten actief stoppen met werken om iets op te schrijven in het juiste format op de juiste plek. Gebeurt zelden.
2. **Geen onderscheid signaal/ruis.** Eén persoon die ergens over klaagt is anekdotisch; tien mensen die hetzelfde tegen aanlopen is een patroon. Klassieke KM ziet dat verschil niet.
3. **Slechte synthese.** Pages stapelen op, maar niemand maakt periodieke samenvattingen van "wat hebben we dit kwartaal geleerd?". De institutionele leercyclus ontbreekt.

Tegelijk hebben organisaties tussen team-engagement-tools (Slack, MS Teams) en formele KM-systemen een gat: een laag waarin medewerkers laagdrempelig observaties, frustraties en inzichten kunnen delen, die vervolgens worden gefilterd, geaggregeerd, en in iteratieve verbetering vertaald.

### Productbeschrijving

Dit is feitelijk een variant van het OR-product, maar met andere afnemer (de werkgever in plaats van de OR), ander gebruik (continu, werkproces-gericht), en andere output (verbeterpunten, niet sentiment).

**Wat de medewerker ervaart:** een chat-bot in de tool waar ze toch al werken (Teams, Slack). Op elk moment kan ze observaties, frustraties, ideeën, of vragen droppen — informeel, vaak als reactie op iets concreets ("dit dashboard laadt vandaag weer 30 seconden"). Eigen pod, eigen geschiedenis, eigen review voor aggregatie. Belangrijk verschil met OR-tool: dit is niét anti-werkgever, dit is collectieve verbetering — de framing en het vertrouwens-niveau zijn anders.

**Wat het management krijgt:** periodieke synthese-rapporten — niet sentiment, maar **operationele observaties**. "30% van het ontwikkelteam noemde de CI/CD-pipeline als een productiviteits-knelpunt deze maand." "5 mensen in support meldden dat klanten het herhaaldelijk over dezelfde feature-vraag hebben." Geen scores, geen ranking, wel patronen.

**Wat het onderscheid maakt:**

- **Pull-model in plaats van push-model.** Geen wekelijkse "pulse survey" die mensen ervaren als onderbreking. Medewerker bepaalt wanneer ze iets melden.
- **Synthese naar kennis, niet alleen sentiment.** De LLM destilleert observaties tot actionable verbeterpunten met traceable bronnen.
- **Persoonlijk leerdagboek als bijproduct.** De medewerker bouwt haar eigen geschiedenis: "wat heb ik dit jaar opgemerkt, wat heb ik geleerd?" Gebruiksvriendelijke export voor functioneringsgesprekken, performance review, of gewoon zelfreflectie.

### Business case

**Afnemers:**

- **Middelgrote en grote bedrijven** in kennisintensieve sectoren: tech, consultancy, R&D, financiële dienstverlening, professional services.
- **Scale-ups** die snel groeien en bang zijn om hun "stamcultuur" te verliezen. Pre-IPO bedrijven met grote groei.
- **Publieke instellingen** met procedure-zware werkpraktijken (ministeries, gemeenten, uitvoeringsorganisaties) — vooral in lichten van de overheidsbrede transitie naar "lerende overheid".
- **Zorginstellingen** voor klinische lessen en near-miss-rapportage (overlapt met richting 2 en 3).

**Prijsmodel:** klassieke SaaS per medewerker per maand, €3-6/maand. Voor 1000-FTE bedrijf = €36-72K/jaar.

**Marktomvang:** breed maar competitief. Direct competitief met Microsoft Viva, 15Five, Lattice, Culture Amp — allemaal goed gefinancierd. Onderscheidend vermogen niet zo sterk als bij andere richtingen omdat het privacy-voordeel hier minder doorslaggevend is (de werkgever is de afnemer, en die wil sommige patronen juist wél zien). Realistisch: niche-positie in "privacy-conscious organisaties" en publieke sector. NL-aandeel haalbaar: €0,5-2M omzet middellange termijn.

**Concurrentie en positionering:** drukst van alle richtingen. Positionering moet scherp: *"Patroon-inzicht zonder pulse-fatigue, en zonder dat individuele bijdragen ooit op een dashboard zichtbaar zijn."* Past goed bij organisaties die hun engagement-tooling als opdringerig ervaren — en dat is een groeiend segment.

### Aanvullende diensten, rollen en producten

**Procesverbeter-coach.** Een rol: iemand die organisaties helpt om de gevonden patronen te vertalen naar concrete verbeteringen. Lean/six sigma-achtig profiel. Significant hogere marge dan alleen software.

**Onboarding-archeologie.** Een specifieke toepassing: nieuwe medewerkers leggen tijdens hun eerste 90 dagen vast wat hen verwart, wat onhandig is, wat ze niet snappen. Aggregatie levert een doorlopende verbeterlijst voor de onboarding-ervaring. Tegelijk: een sociaal moment voor de organisatie ("dit is waarvoor we naar de stem van nieuwkomers luisteren").

**Vertrek-archeologie (offboarding).** Bij vertrek zorgvuldige extractie van wat de persoon weet, op een manier die voor henzelf waardevol is (eigen kennislogboek mee naar nieuwe werkgever) en voor de organisatie (institutioneel geheugen). Vervangt het slecht-uitgevoerde exit-interview.

**Cross-team retrospective-tool.** Niet alleen binnen een team, maar tussen teams: welke patronen overlappen tussen development en support? Tussen sales en product? Verbindt observaties die nu in silo's blijven hangen.

**Manager dashboard met training.** Een opleidingscomponent: managers leren omgaan met geaggregeerde patroon-rapporten, hoe ermee te interveniëren zonder dat het naar surveillance neigt. Reduceert het risico dat de tool defensief wordt ingezet.

**Kennisbank-bridge.** Patronen die stabiel zijn en consensus opleveren, worden suggesties voor de officiële kennisbank van de organisatie. Brug tussen informele observatie en formele kennis.

**Stamcultuur-meter voor scale-ups.** Specifiek voor groeibedrijven: een dashboard dat laat zien hoe verschillende lagen van de organisatie de cultuur ervaren. Vroeg waarschuwingsysteem voor "we verliezen het" momenten waar veel scale-ups op crashen.

---

## Richting 5 — Burgerparticipatie en overheidsfeedback

### Probleemstelling

Overheden willen burgers laten meepraten over beleid, omgevingsplannen, voorzieningen. Maar de huidige instrumenten falen op alle fronten:

1. **Enquêtes en peilingen** bereiken een gefilterde populatie (digitaal vaardig, geïnteresseerd, tijd, vaak hoger opgeleid). Resultaten zijn representatief op papier, niet in de praktijk.
2. **Inspraakavonden** bereiken de meest assertieve en vaak boze stem. De stille meerderheid hoor je nooit.
3. **Online participatie-platforms** (Argu, OpenStad, Decidim-implementaties) zijn vaak technisch in orde maar lijden onder lage betrokkenheid en gebrek aan vertrouwen in de overheid die ze faciliteert.
4. **Big tech-platforms** (Facebook-groepen, Nextdoor) zijn waar veel feitelijke buurtdiscussie wel plaatsvindt — maar onder commerciële voorwaarden, met algoritmen die polarisatie bevorderen, en buiten democratisch zicht.

Tegelijk staat overheid voor enorme legitimiteitscrisis. Compliance-eisen en GDPR-druk dwingen overheden tot betere data-omgang; de afstand tussen burger en bestuur lijkt te groeien; de roep om "echte" participatie wordt luider.

Een decentrale architectuur is hier filosofisch én institutioneel uitzonderlijk sterk gepositioneerd. Burgers willen niet dat de gemeente al hun bijdragen centraal opslaat. De gemeente wil niet aansprakelijk zijn voor het beheer van politiek-gevoelige content. Een infrastructuur waarin de burger eigenaar blijft, de gemeente alleen geaggregeerd ziet, en een onafhankelijke partij cureert, lost dat probleem op.

### Productbeschrijving

**Wat de burger ervaart:** een uitnodiging via post, e-mail, of een poster in de wijk om mee te praten over een concreet onderwerp ("herinrichting Marktplein", "nieuwe woonvisie", "energietransitie in dorp X"). Activatie creëert een pod voor deze burger, voor dit onderwerp. Conversational input via WhatsApp, voice, of (voor minder digitaal vaardige burgers) per telefoon met een bot. Burger kan haar bijdrage altijd herzien, intrekken, of uitbreiden.

**Wat de gemeente krijgt:** een dashboard met gestructureerde, gecureerde patroon-rapporten. Niet "individuele klachten" maar "thematische clusters van zorgen, voorstellen, en prioriteiten" — met traceability naar wat er gezegd is, zonder herleidbaarheid naar wie. Verschillende statistische snijdingen mogelijk (per buurt, per leeftijdsgroep — indien burgers daar input voor geven en toestaan).

**Wat het onderscheid maakt:**

- **De stille meerderheid bereikt.** Conversational, op eigen tempo, in het kanaal dat de burger toch gebruikt. Drempel veel lager dan inspraakavond of formulier.
- **Niet-binair.** Niet "voor of tegen", maar genuanceerde input ("ik ben voor renovatie, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is"). Aggregatie ziet die nuance.
- **Cycle van terugkoppeling.** De gemeente reageert op patronen, niet op individuen. Burgers krijgen via dezelfde tool te zien wat er met hun bijdragen gedaan is. Bouwt vertrouwen op.
- **Per onderwerp activeerbaar.** Geen permanent platform dat onderhouden moet worden. Per beleidsdossier wordt een participatie-cyclus opgestart, met begin en einde.

### Business case

**Afnemers:**

*Primair:*
- **Gemeenten** — Nederland heeft 342 gemeenten (per 2026), waarvan circa 100 met substantiële participatie-budgetten. Vooral grotere (G40 en G4) experimenteren constant met nieuwe vormen.
- **Provincies** — 12 stuks, met provinciale participatietrajecten (omgevingsvisies, klimaatadaptatie).
- **Waterschappen** — 21 stuks, met groeiende participatie-eisen vanuit Omgevingswet.

*Secundair:*
- **Rijksoverheid** — directoraten van ministeries die landelijke trajecten doen (BZK voor democratie, IenW voor infrastructuur, EZK voor energietransitie).
- **Toukomstprojecten en regionale fondsen** (Nij Begun) — die participatie-tools nodig hebben.
- **NGO's en burgerinitiatieven** — Mieren, ProDemos, Buurkracht, etc.

**Prijsmodel:** projectbasis per participatie-traject. Klein traject (één wijk, één onderwerp): €15-30K. Groot traject (gemeentebreed, meerdere onderwerpen, lange looptijd): €50-150K. Voor doorlopende capaciteit: jaarcontract met gemeenten €25-75K. Onderzoeksbureaus die participatie organiseren als onderaannemer: revenue share-model.

**Marktomvang:** moeilijk te kwantificeren maar substantieel. Gemeenten besteden gezamenlijk tientallen miljoenen per jaar aan participatie-trajecten (onderzoeksbureaus, inspraakorganisaties, platforms, communicatie). Indicatief deel daarvan dat toegankelijk is voor een goed gepositioneerd alternatief: €5-20M. Bij EU-uitbreiding (Decidim-ecosysteem, lokale democratiebewegingen in Frankrijk, Spanje, Duitsland) significant groter.

**Concurrentie:** versnipperd. Argu (NL), OpenStad (open source, gemeente Amsterdam), Decidim (Spaans/Catalaans, EU-breed), Citizenlab (Belgisch), Consul Democracy. Plus enquête-bureaus (Motivaction, Citisens, etc). Niemand combineert decentrale architectuur met conversational input en patroon-aggregatie. Onderscheidend vermogen sterk.

**Positionering:** *"De stille meerderheid bereiken op een manier waarop hun gegevens van henzelf blijven, en hun bijdrage als patroon zichtbaar wordt — niet als losse klacht."*

### Aanvullende diensten, rollen en producten

**Participatie-procesregisseur.** Een rol: iemand met ervaring in burgerparticipatie die gemeenten helpt om een participatie-cyclus goed op te tuigen. Belangrijk: dit is overigens de bottleneck in de markt, niet de technologie. Hoge marge consultancy. Vergelijkbaar met Argu's eigen aanpak.

**Burgerassistent (offline brug).** Een mens die belrondes doet onder burgers die geen digitale toegang hebben, met dezelfde principes (eigen pod, eigen redactie). Reduceert de digital divide. Vergoedbaar als democratisch-toegankelijkheidsbudget.

**Lokale-democratie-academie.** Trainingsprogramma voor gemeenteambtenaren en bestuurders over hoe je een echte participatie-cyclus ontwerpt. Boeken-en-cursussen-business. Bouwt aan het ecosysteem.

**Cross-municipal pattern library.** Met opt-in van gemeenten: patronen die meerdere gemeenten zien (omgaan met energietransitie, parkeerdruk, jeugdzorg) worden gedeeld. Geen individuele data, wel inzicht in wat werkt en niet werkt. Bouwt aan landelijke democratische infrastructuur.

**Jongerenmodus.** Specifieke vorm voor onder-18 participatie, met aangepaste taal, andere kanalen (Discord, TikTok-DM), en passende waarborgen. Onderschat segment.

**Politieke-besluitvorming-bridge.** Gestructureerde overdracht van participatie-resultaten naar raadsstukken en bestuurlijke besluiten, met traceability ("dit besluit verwerkt patroon X uit traject Y, met deze nuances"). Versterkt democratische legitimiteit en is voor politici waardevol om te kunnen tonen "ik heb geluisterd, dit heb ik gehoord, dit doe ik ermee, en dit niet en hier is waarom".

**Connectie naar buurt-skill-app en taken-app.** En hier wordt het écht interessant: jouw bestaande werk op de buurt-skill-app en de decentrale taken-app sluit hier organisch op aan. Stel een gemeente lanceert participatie rond een wijk-vernieuwing. Burgers geven input → patronen worden zichtbaar → de gemeente besluit "we gaan een gemeenschapstuin aanleggen" → de taken-app helpt burgers de uitvoering zelf op te pakken ("wie kan helpen met grondwerk?", "wie wil het bord maken?") → de skill-app verbindt vraag en aanbod. **De hele democratische cyclus, van input tot uitvoering, op één decentrale infrastructuur.** Dit is conceptueel sterk én commercieel: het maakt jullie de enige aanbieder met een volledig democratisch ecosysteem.

---

## Tot slot — onderlinge versterking

Deze vijf richtingen zijn niet vijf losse producten — ze zijn vijf toepassingen van dezelfde stack. Een gebruiker kan in principe dezelfde pod gebruiken om:

- als werknemer feedback aan haar OR te geven (uit het hoofd-businessplan),
- als patiënt symptomen bij te houden,
- als respondent mee te doen aan een gezondheidsonderzoek,
- als burger te reageren op een gemeentelijk participatietraject,
- als kennisdrager bij te dragen aan organisatieleren.

Dat is een infrastructurele claim die geen enkele concurrent op deze schaal kan maken. **Niet omdat de stack zo geweldig is, maar omdat niemand anders een architectuur heeft waarin dit überhaupt zonder vertrouwens-collaps mogelijk is.**

De praktische volgorde lijkt: start met OR (richting A uit het eerdere document) of klokkenluiden (richting 3 hier) als anker — beide hebben sterke vraagdruk en bewezen prijsbereidheid. Bouw als tweede richting iets met hogere marge en mooi narratief: zorg (richting 2) of onderzoek (richting 1). Voeg richting 5 (burgerparticipatie) toe zodra de andere zijn gevalideerd — het profileert je als infrastructuur-aanbieder, niet als één-product-bedrijf. Richting 4 (lerende organisatie) is een natuurlijke laterale uitbreiding voor extra omzet uit bestaande relaties.

De meest creatieve gedachte hier is misschien deze: zodra je drie van deze richtingen draait, ben je niet meer een SaaS-bedrijf met meerdere producten. Je bent een **digitale civic infrastructure**-aanbieder. Dat is een fundamenteel andere positionering en opent fundamenteel andere financieringsmogelijkheden — denk EU-niveau, denk publieke-private samenwerking, denk EHDS-tier.
