# Verkenning: lokale inbedding van een decentraal agent-netwerk

*Een werknotitie over hoe een buurt-skill-app en een decentrale taken-app — beide gebouwd op een agent-/Solid-infrastructuur — financierbaar en ingebed kunnen worden in lokale initiatieven in Groningen.*

---

## 1. Wat dit document is

Dit is een denkdocument, geen aanvraag. Het bundelt een aantal verkenningen rond de vraag: *hoe verbind ik mijn werk aan een decentraal agent-netwerk met lokale Groningse financiering en lokale gemeenschappen, zonder dat het verhaal verzandt in jargon of zonder partner blijft hangen?* De twee concrete toepassingen die op tafel liggen zijn:

- **Een buurt-skill-app**: bewoners delen wat ze kunnen en zoeken, en agents helpen vraag en aanbod te matchen.
- **Een decentrale taken-app**: "wie kan mij helpen met klusje X?", waarbij wie de taak aanneemt zelf weer subtaken mag uitzetten of eerst een voorstel mag indienen, en waarbij zowel mensen als machines mogen meewerken.

Beide draaien op dezelfde onderliggende infrastructuur — een SDK waarin agents (mensen, software, sensoren, actuators) als gelijkwaardige deelnemers in een netwerk meedoen, met data in Solid pods, ACL al meegenomen, transportlagen die zowel lokaal (mDNS/Bluetooth) als over relays werken, en portabele agents die meeverhuizen met hun eigenaar.

De zoektocht naar financiering is opgesplitst in twee sporen die elkáár nodig hebben: NLnet/NGI voor de protocol- en SDK-laag, lokale Groningse fondsen voor concrete toepassingen daarop. Onder die tweede tak hangt deze hele verkenning.

---

## 2. De strategische context

Lokale Groningse fondsen — Nij Begun, Toukomst, Nationaal Programma Groningen, Inwonersbudget — zijn ingericht voor *buurtactiviteiten en bewonersinitiatieven*, niet voor softwareontwikkeling. Ze financieren buurtfeesten, opgeknapte speeltuintjes, ontmoetingsplekken, dorpsinitiatieven. Wie aan komt zetten met "ik bouw een decentrale skill-app" valt in een gat: te technisch voor de sociale potten, te sociaal voor de innovatiepotten, en in zijn eentje te klein voor de grote economische fondsen.

De kunst is daarom *niet om de app te financieren, maar om een buurt te financieren die de app gebruikt en ontwikkelt*. Dat verschil is fundamenteel voor het verhaal naar buiten en voor de keuze van fondsen.

Tegelijkertijd helpt het om twee verhalen klaar te hebben. Voor de buurtbewoner geen jargon: *een buurt waarin iedereen iets te bieden heeft; vraag hulp, deel wat je kan, en je spullen blijven van jou*. Decentralisatie wordt verkocht als gevoel — jouw profiel, jouw groep, geen bedrijf ertussen — niet als architectuur. Voor de tech-geïnteresseerde of early adopter mag het agents-verhaal wél verteld worden: *mensen en machines als gelijke deelnemers in een lokaal netwerk* is filosofisch interessant en zeldzaam, en trekt mensen die het netwerk in de eerste fase gaan dragen.

In beide verhalen draait het om **wederkerigheid**. Buurt-skill-apps verzanden vaak in óf vraag-gedreven (Nextdoor-achtig, mensen klagen en vragen) óf aanbod-gedreven (LinkedIn-light). De magie zit in het matchen van beide, en het feit dat agents dat *voor je* kunnen doen is een goed verkoopargument zonder dat "AI" hoeft te vallen.

---

## 3. De Groningse fondsen in kaart

### Nij Begun — Fonds Economische Agenda Startkapitaal
Past slecht voor deze fase. Het is durfkapitaal (achtergestelde lening of aandelenparticipatie) van 2,5 tot 25 miljoen euro, gericht op scale-ups en transitieprojecten met 50% co-financiering uit de markt. Thema's zijn duurzame energie, gezondheid, landbouw, industrie en vrijetijdseconomie. Voor een open-source decentraal protocol is dit een mismatch — verkeerde schaal, verkeerde vorm. Digitalisering valt onder de brede agenda maar niet onder de vijf primaire investeringssectoren.

### Nij Begun — Inwonersbudget (Sociale Agenda)
Hier zit wel een opening. Vanaf mei 2026 zijn subsidies tussen €1 en €10.000 beschikbaar voor inwoners van Groningen en Noord-Drenthe met ideeën die bijdragen aan leefbaarheid of sociale verbinding in een buurt, wijk of dorp. Projecten voor en door inwoners. Klein bedrag, maar geschikt voor een pilot of buurttoepassing — niet voor het protocol zelf.

### Toukomst
Hier zit een belangrijk punt: Toukomst was een eenmalige call in 2020. De 900 ideeën zijn gebundeld tot uiteindelijk 36 lopende projecten waarvoor 100 miljoen euro is gereserveerd, en initiatiefnemers zijn nu druk bezig die uit te voeren. Er is dus géén open call meer voor nieuwe Toukomst-ideeën. Wat wél kan: aansluiten bij een bestaand Toukomstproject als technische partner of leverancier. Dat is niet "subsidie aanvragen bij Toukomst" — dat is werk doen *voor* een Toukomstproject.

### Aanpalend en mogelijk relevanter
Het Impulsloket van Nationaal Programma Groningen biedt inwonersgroepen en kleine ondernemers tot €25.000, met Economic Board Groningen als projectversneller. De Landschapswerkplaats heeft een eigen subsidieregeling, maar die is alleen relevant bij een natuur- of landschapstoepassing.

---

## 4. Vijf denkrichtingen, klein naar groot

### Richting 1 — Buurt-als-aanvrager (Inwonersbudget, €1–10k)
Niet jij vraagt aan; een buurt- of dorpsvereniging vraagt aan voor "een experiment met digitaal nabuurschap". Jij bent de technische partner die de tool levert. De €10k dekt bijeenkomsten, koffie, een coördinator, drukwerk en een klein bedrag voor jouw begeleiding. De app zelf is "er al" (open source, eigen werk). Eén concreet dorp, één coördinator, één seizoen. Frame: *ons dorp wil weten of digitale hulpmiddelen ons kunnen helpen elkaar beter te vinden — zonder dat onze gegevens bij grote bedrijven belanden*. Voordeel: relatief makkelijk te krijgen, levert echte usecase en testdata. Nadeel: betaalt jouw ontwikkeling nauwelijks.

### Richting 2 — Brede coalitie-pilot (Impulsloket NPG, tot €25k)
Iets ambitieuzer. Aanvrager: jij + een buurtorganisatie + bijvoorbeeld een zorgcoöperatie of energiecoöperatie als getuige. Frame: *lokale wederkerigheid digitaal ondersteunen — een pilot in [dorp/wijk] waarin bewoners taken en hulp uitwisselen via een app die hun eigenaarschap respecteert*. Voordeel: dekt enkele maanden werk plus pilot. Nadeel: nog steeds eenmalig.

### Richting 3 — Coöperatie als drager (Sociale Agenda Nij Begun, middelgroot)
Dit is waar het interessant wordt. Zoek aansluiting bij een bestaande Groningse coöperatie — zorg, energie, wonen, voedsel — en maak het systeem onderdeel van hún infrastructuur. Coöperaties hebben vaak al financieringskanalen en zoeken digitale tools die niet van Big Tech afhankelijk zijn. Frame: *coöperatieve infrastructuur voor wederkerige hulp tussen leden — data blijft bij de coöperatie en haar leden*. Voordeel: structureel, niet eenmalig; sluit aan bij waarden van coöperaties (eigenaarschap, lokaal); past in het narratief "weerbaar Groningen na de gaswinning". Nadeel: vereist dat er een partner gevonden wordt die mee wil — kost tijd.

### Richting 4 — Aansluiten bij lopend Toukomstproject
Sommige van de 36 projecten zijn al digitaal-georiënteerd of hebben digitale ondersteuning nodig. Hier bied je jezelf aan als technisch leverancier of partner. Frame: niet "geef mij subsidie" maar "ik kan jullie helpen dit beter, duurzamer of onafhankelijker te doen". Voordeel: directe usecase met echte mensen, geld is er al, geen aanvraag schrijven. Nadeel: werk in andermans agenda.

### Richting 5 — Stapelen met NLnet/NGI
De belangrijkste, vermoedelijk: NLnet voor het protocol/SDK, lokale potten voor de toepassingen erop. Die versterken elkaar. Richting NLnet kun je laten zien "er zijn al concrete Groningse toepassingen in pilot"; richting lokale fondsen "de onderliggende techniek wordt internationaal gefinancierd door NGI/EU — Groningen krijgt waar voor z'n geld, geen vendor lock-in". Commissies betalen niet voor de R&D, alleen voor de lokale toepassing. Dat is precies hun mandaat.

---

## 5. Framing-elementen die werken

Een paar woorden en concepten die het *wél* doen bij sociale fondsen in Groningen, en eentje die het *niet* doet:

| Wel | Niet |
|---|---|
| Wederkerigheid | Skill-matching |
| Digitaal nabuurschap / noaberschap | Federatie, protocollen |
| Eigenaarschap over je gegevens | Solid pods |
| Hulp van mens én machine, slimme buren | Agents |
| Niet afhankelijk van Big Tech | Decentralisatie |
| Brede welvaart | ACL, OIDC, transportlagen |
| Vertrouwen herstellen | Architectuur |

"Noaberschap" is Gronings/Drents en raakt een snaar. "Niet afhankelijk van Big Tech" speelt in op het post-gaswinning sentiment van autonomie en zelf bepalen. "Brede welvaart" is het frame waarmee NPG en Nij Begun beide werken. Wat in de eerste alinea van een pitch *niet* mag staan: decentralisatie, protocollen, federatie, ACL, OIDC, transport layers. Die mogen op pagina 3 van een bijlage.

---

## 6. Wat de apps absoluut moeten kunnen

Een paar zaken die als non-negotiable gelden voor élke concrete pilot, ongeacht via welke partner het loopt:

**Onboarding zonder cognitieve overhead.** Iemand moet binnen drie minuten een profiel hebben met drie skills en in één groep zitten. Als de eerste interactie "kies een Solid pod provider" is, dan is die persoon weg. Verstop de techniek. Eventueel: de app regelt default een pod aan, gevorderden kunnen later migreren of een eigen pod kiezen.

**Lokale ontdekking die voelt als magie.** Twee mensen met de app op een buurt-BBQ moeten elkaars (gedeelde) skills kunnen zien zonder dat er iets geconfigureerd wordt. Dit is precies waar de BT/mDNS-stack voor schittert. Een schermpje "5 mensen in de buurt — 2 delen skills met jou" is zowel functioneel als wonderlijk.

**Vragen stellen, niet alleen aanbieden.** Een blanco "wat kun jij?" is voor veel mensen blokkerend ("ik kan eigenlijk niks bijzonders"). Maar "ik zoek iemand die mijn fiets kan repareren" is laagdrempelig. En vaak ontstaat het aanbod uit het zien wat anderen vragen ("oh, dát kan ik wel"). Dit is precies waarom de taken-app náást de skill-app belangrijk is.

**Een gesprek beginnen.** Skill- of taak-match is alleen een opening. Mensen moeten makkelijk kunnen chatten, bellen of een afspraak prikken. Geen eigen volwaardig messaging systeem bouwen — kort genoeg om "hoi, hoe en wanneer?" af te handelen, daarna mogen ze naar Signal, WhatsApp, of fysiek afspreken.

**Iets afronden.** Na een uitwisseling: een lichte afronding ("gelukt? bedankje? korte review zichtbaar voor jullie groep?"). Dit onderscheidt skill-platforms van vergeten chats. Geen sterren-systeem — te transactioneel voor een buurt — maar wel iets dat erkenning geeft.

---

## 7. Interface-ideeën

Drie views waar de app om draait.

**De "buurt"-view** — de homepage. Geen feed à la social media (vermijd dat), maar iets ruimtelijks. Een kaart-achtige weergave waar skills en taken in je groepen verschijnen, of een "prikbord" met vragen en aanbod door elkaar. De feed-vorm trekt scroll-gedrag aan; een prikbord nodigt uit tot kijken-en-weer-wegklikken, wat past bij hoe vaak je deze app *zou moeten* openen — een paar keer per week, niet per dag.

**De "ik"-view** — je eigen profiel. Hier zit een truc: laat zien hoe je profiel eruit ziet *voor verschillende groepen*. Wat ziet de buurt, wat zien je familie, wat zien mensen buiten je groepen? Dat maakt de openheid-controle concreet en visueel, in plaats van een verborgen ACL-instelling.

**Een gespreks- of taken-view** — waar een match een echte interactie wordt. Voor de taken-app is hier het cruciale extra-onderdeel: zichtbaar dat een accepteur subtaken kan uitzetten ("ik kan het zelf, maar voor het vervoer zoek ik iemand"), of eerst een voorstel kan indienen voordat de taak echt geaccepteerd wordt. En, omdat zowel mensen als machines kunnen meewerken: laat dat zichtbaar zijn zonder onderscheid te overdrijven. Een sensor die "ik heb gemeten" zegt mag hetzelfde uitzien als een mens die "ik heb het gedaan" zegt.

---

## 8. Concrete partners — richting 3

### Energiecoöperaties (sterkste fit)

**Grunneger Power** (stad Groningen, ruim 3.400 leden) — sinds 2011 actief, helpt bewoners samen in hun buurt te verduurzamen. Sterk: de schaal, een professioneel apparaat, en een filosofie van "regie over eigen energie" die letterlijk jouw framing is, vertaald naar het energiedomein. Use case: leden onderling klusjes/skills delen rond verduurzaming — isolatie-hulp, warmtepomp-advies, samen-zonnepaneel-leggen. Contact: Steven Volkers wordt vaak genoemd in PEP-context.

**Groninger Energiekoepel (GrEK)** — koepel boven 40+ Groningse energiecoöperaties. Interessanter dan één enkele coöperatie, want ze faciliteren regiotafels en leergemeenschappen. Pitch: *gedeelde digitale infrastructuur voor alle 40+ coöperaties — niet 40 keer apart bouwen*. Sterk economisch argument richting fondsen.

**Dorpencoöperatie Reitdiepdal** en **Energiecoöperatie Zonnedorpen** (Loppersum, opgericht door dorpsbelangenverenigingen in Garsthuizen, Godlinze, Leermens, 't Zandt, Zeerijp en Zijldijk als alternatief voor gaswinning). Kleinere schaal, maar emotioneel sterk verbonden met het gaswinning-narratief — voor pitch-doeleinden goud waard. De overlap dorpsbelangen × energiecoöperatie is precies waar het frame "mensen + machines samen" zin krijgt.

**MEER-Dorpen Energie Coöperatie (MDEC)** — Middelbert, Engelbert, Euvelgunne, Roodehaan. Expliciet community-first, samenwerkingsovereenkomst met de gemeente Groningen rond windenergie. Sympathiek profiel.

**EC Noorddijk** — sinds 2018, circa 100 leden, werkgebied onder andere Lewenborg, Ulgersmaborg, Beijum, Drielanden. Met *vijf eigen energiecoaches die leden adviseren over besparen en opwekken*. Die energiecoaches zijn interessant: dat is de facto een skill-deel-netwerk dat nu telefoon plus spreadsheet draait.

### Andere coöperatieve en collectieve organisaties

**Programma Energieparticipatie (PEP)** — Groningse programma voor de lokale energietransitie, opvolger van het programma Lokale Energietransitie. Geen coöperatie maar een programma; kan een paraplu vormen voor een pilot. Uitgevoerd door NMG, Grunneger Power en GrEK.

**Natuur en Milieufederatie Groningen (NMG)** — uitvoerder van PEP samen met Grunneger Power en GrEK. Heeft staf, projectervaring, en is gewend aan subsidieaanvragen. Goede co-aanvrager.

**Roemte** (zelf óók een Toukomstproject) — stichting die ondernemende sociale, culturele en maatschappelijke initiatieven helpt bij het vinden van huisvesting en het uitwerken van plannen. Dit is een meta-organisatie: als zij het systeem omarmen als infrastructuur voor de initiatieven die zíj begeleiden, dan zijn er 10+ usecases in één klap. Mogelijk het belangrijkste single point of contact.

**Zorgcoöperaties** — minder bekend in Groningen dan in Brabant of Limburg, maar het Zorginnovatieforum en regionale zorgcoöperaties bestaan. Hier eerst LinkedIn intensief doorzoeken; de structuur is jonger en minder gestandaardiseerd. Het Stille Goud (Toukomstproject) zit dichtbij dit thema.

**Wooncoöperaties** — bijvoorbeeld Het Hof van Groningen, kleine maar actieve wooncoöperaties. Sterke skill-deel-cultuur intern. Past minder bij "lokaal" maar wel bij "leden onder elkaar".

### Wat creatiever

**Voedselbanken en Voedseltuinen-netwerk** — in Groningen lopen meerdere proeftuinen (Toukomstpaneladvies reserveerde maximaal €325.000 voor zeven proeftuinen met professionele begeleiding). Daar zit een natuurlijk skills- en taken-vraagstuk: wie kan wanneer komen wieden, oogsten, vervoeren?

**Bibliotheken en Forum Groningen** — bibliotheken positioneren zich steeds meer als sociale-infrastructuur-knooppunten. Forum heeft een Smartlab. Niet een coöperatie maar wel een lokale, vertrouwde drager.

**Dorpshuizenfederatie Groningen** — alle dorpshuizen samen. Een dorpshuis als fysieke ankerplek voor een digitaal netwerk is conceptueel mooi: *het digitale prikbord van het dorpshuis*.

**Sport- en verenigingsfederaties** — Huis van de Sport is partner bij Kansrijke Generatie. Verenigingen draaien op vrijwilligers-skills. Letterlijke usecase.

---

## 9. Concrete aanknopingspunten — richting 4

Per Toukomstproject is gekeken of er een natuurlijke aanleiding is voor een decentraal mensen-machines-netwerk eronder. Van zeer kansrijk naar creatief gokje.

### Hoog kansrijk

**Roemte** — dubbelfunctie als partner en als Toukomstproject. Hun corebusiness is initiatieven helpen verbinden en organiseren. Een agent-netwerk dat initiatieven onderling skills laat delen ("wie kent een goede boekhouder voor stichtingen?") past direct.

**Oogst van Groningen** — het Toukomstproject draait om een lokaal, duurzaam en toekomstbestendig voedselsysteem, met €1,45 miljoen aan subsidies in drie jaar voor lokale voedselprojecten. Letterlijk vraag-en-aanbod tussen boer en burger, distributeur en horeca. Een taken/skills-app voor de korte keten — een boer plaatst "20 kilo bieten over, wie wil/kan?" — is hier vanzelfsprekend. Stichting Oogst van Groningen heeft adviseurs die ondersteunen bij aanvragen; zij willen graag dat er meer ingediend wordt.

**Nieuwe Democratie / VanOnderen!** ('Steendammen') — over van onderaf inventariseren van wensen over leefbaarheid en bewoners een serieuze positie geven ten opzichte van overheden. Een participatie-platform waarin bewoners taken en initiatieven onderling én richting gemeente kunnen organiseren past hier exact. Frame: *VanOnderen! krijgt z'n eigen digitale gereedschapskist*.

**Het Stille Goud** — een Toukomstproject rond eenzaamheid, mantelzorg en welzijn (afgaand op de naam en het Mit Mekoar-thema). Skill- en taken-uitwisseling tussen buren is letterlijk een eenzaamheidsinterventie. Stand van zaken nakijken.

### Middelkansrijk en creatief

**Kansrijke Generatie** — verrijkt schoolprogramma met partners als IVN, Rijdende popschool, Huis van de Sport en Stichting Sparklab. Use case: scholen, vakmensen en lokale bewoners moeten gematched worden ("welke timmerman in het dorp wil komen vertellen?"). Klassiek skills- en taken-vraagstuk. Bonus: data-eigenaarschap van kinderen is een onderwerp dat in PO speelt (SURF, Edubadges-richting).

**Nieuw Vakmanschap** — over mbo-stages, leerwerkplekken, regionale arbeidsmarkt. Een agent-netwerk voor "wie heeft welk leerbedrijf nodig" is een logische infrastructurele toepassing.

**Nieuwe Zaaiplaatsen** — over jong ondernemerschap en plekken voor pioniers. Past bij "kennis en vaardigheden delen tussen jonge ondernemers".

**Energiehub050 met Experience Zone** — als dit een fysieke energie-hub is, zit daar mogelijk een vraag-en-aanbod-component (community energy management, peer-to-peer energie). Wellicht de sterkste *machines als agents*-usecase, want energiehubs draaien op real-time signalen tussen apparaten.

**Groningen Werkt Circulair** — circulaire economie draait op matching: wie heeft restmateriaal, wie kan iets repareren, wie kan iets demonteren. De Fashion Repair sessies in het Smartlab in Forum elke donderdagavond zijn een aanwijzing dat ze fysiek én community-gedreven werken. Skill-app voor "wie repareert wat" past.

### Creatieve gokjes

**Burgerhart Groningen** — een project waar initiatiefnemers nog mee bezig zijn, nog niet voorgelegd aan het bestuur. Naam suggereert burgerparticipatie en gemeenschap. Wie vroeg aanhaakt, kan vormgeven hoe het wordt.

**Route 2040** en **GRUNN, pioniers in de provincie** — details onbekend, maar de namen suggereren toekomstverkenning en netwerken van vernieuwers. Past bij het bredere narratief.

**Gronings Vuur** — rondreizend cultuur-/evenement-project, langs gemeenten. Praktisch logistiek vraagstuk dat baat heeft bij een coördinatietool. Niet de inhoudelijke sweet spot, maar wel een leuk eerste demo-podium.

---

## 10. Volgorde en kritieke pad

Als ik vandaag drie gesprekken zou mogen voeren:

1. **Roemte** — meta-positie, kunnen je 10x verder helpen dan elk individueel project
2. **Grunneger Power** of **GrEK** — schaal, professionaliteit, filosofische match
3. **Stichting Oogst van Groningen** — concrete usecase, lopend subsidiekanaal, hongerig naar goede ideeën

Mijn voorgestelde volgorde voor de komende periode:

1. **Nu**: tweede NLnet-aanvraag voorbereiden voor de gewijzigde plannen op het protocol-/SDK-werk.
2. **Komende maanden**: één Groningse coöperatie of buurtvereniging vinden die als partner wil fungeren. Dit is de bottleneck — niet de subsidie zelf.
3. **Met die partner**: een Inwonersbudget-aanvraag (€10k) doen voor een kleine pilot. Laagdrempelig, snel, en levert een referentie op.
4. **Na de pilot**: opschalen naar Impulsloket (€25k) of Sociale Agenda. Mét de pilot in de hand is dit veel makkelijker.
5. **Parallel**: contact zoeken met een lopend Toukomstproject waar de techniek waarde toevoegt.

De partner vinden is het kritieke pad. Subsidies krijgen is in Groningen relatief makkelijk áls er een gelegitimeerde lokale aanvrager achter staat; zonder partner blijf je een individuele ontwikkelaar met een idee, en daar zijn de potten niet voor.

---

*Bronnen: gesprekken eerder dit jaar over de SDK-architectuur (transportlagen, agent-blueprints, Solid-pod-integratie), eerdere verkenningen rond de buurt-skill-app, en webresearch naar Groningse fondsen, coöperaties en Toukomstprojecten in mei 2026.*
