# Wat ik aan het bouwen ben

**TLDR.** Ik bouw een soort gereedschapskist waarmee groepen mensen — een huishouden, een buurt, een vereniging, een bedrijf — eenvoudig dingen kunnen organiseren via een chatbot. Boodschappen, taken, feedback, beslissingen. Wat het anders maakt dan bestaande apps: jouw bijdragen zijn van jou, niet van een bedrijf. Je kunt ze altijd terughalen of weghalen, en wat je deelt met de groep bepaal je zelf. Onder de motorkap zit een technologie waarmee mensen, slimme apparaten en kleine stukjes software op gelijke voet samenwerken — daarover meer aan het eind.

---

Stel je voor: je hebt een groepsapp met je huisgenoten waarin je elke dag heen-en-weer-typt over boodschappen, klusjes, wie nog koffie moet halen. Op zichzelf werkt het, maar het is rommelig. Wie kookt vanavond? Wat staat er op het lijstje? Heb jij die rekening al betaald? Het versnippert in honderden berichtjes.

Wat ik bouw, vervangt die groepsapp niet — het zit er een laagje bovenop. Een soort slimme assistent waarmee de groep dingen kan bijhouden zonder erover te hoeven onderhandelen. Je stuurt een bericht ("vergeet niet melk te halen") en het komt op het lijstje. Je vraagt iets ("wie was er aan de beurt voor de wasruimte?") en je krijgt antwoord. Je geeft je mening over iets ("kunnen we afspreken dat we 's avonds geen muziek meer draaien?") en de assistent bewaart het op een manier die later voor iedereen te zien is — als jij dat wil.

Hetzelfde idee werkt in andere groepen. In een Vereniging van Eigenaren waar elf huishoudens iets moeten beslissen over de schutting, kan iedereen rustig en in zijn eigen tijd reageren, zonder dat het een vergadering wordt. In een buurttuin kunnen de twintig mensen die het tuintje bijhouden makkelijk afspreken wie wanneer komt wieden. In een klein bedrijf kunnen medewerkers feedback geven over hoe het loopt, zonder dat hun directe baas precies kan zien wie wat geschreven heeft. In een ondernemingsraad kunnen werknemers laten weten wat er onder de mensen leeft, op een manier waarop hun woorden van henzelf blijven.

Dat laatste — *je woorden blijven van jou* — is het belangrijkste verschil met bestaande apps. Bij WhatsApp staan je berichten op de servers van Meta. Bij een typische klachtenformulier staat je klacht in een database van het bedrijf dat de software levert. Bij Google Forms hetzelfde verhaal. Je gegevens zijn weg op het moment dat je op verzenden klikt.

Bij mijn aanpak heeft elke gebruiker een eigen kleine opslagruimte — denk aan een digitale opbergkast die alleen jij kunt openen. Wat je typt staat dáár, niet bij een groot bedrijf. Als je iets met de groep wil delen, gebeurt dat bewust en kan je het altijd weer terugnemen. Wil je je hele opslagruimte verhuizen naar een andere plek? Dat kan. Wil je dat een vriendin of de assistent iets voor je doet zonder dat ze al je andere spullen kunnen zien? Dat kan ook, want jij bepaalt wat je deelt en met wie.

Voor groepen levert het iets bijzonders op. Stel een buurt wil weten wat er leeft rond een nieuwe inrichting van het plein. In plaats van een avond waar de drie meest assertieve mensen het woord voeren, kan iedereen op zijn eigen moment iets typen tegen de assistent — een paar zinnen, op het moment dat het opkomt, zonder dat het naar het hele internet gaat. De assistent vraagt: "is dit zo goed verwoord, of wil je het aanpassen voordat het wordt meegenomen?" En pas als jij ja zegt, telt het mee in een overzicht dat aan de gemeente wordt gegeven. Niet jouw losse zin, wel het patroon dat eruit komt — zonder dat herleidbaar is wie wat zei.

Hetzelfde principe werkt voor medewerkers van een organisatie die feedback willen geven aan hun werkgever, voor patiënten die ervaringen willen delen met een ziekenhuis, voor onderzoekers die mensen willen interviewen die anders niet zouden durven praten, voor klokkenluiders die misstanden willen melden zonder zelf onveilig te worden. Steeds dezelfde onderliggende ideeën, telkens aangepast aan de context.

Wat ik bouw is dus niet één app, maar een fundament waarop verschillende toepassingen kunnen rusten. De eerste versie loopt al — een chatbot voor mijn eigen huishouden die boodschappen, taken en huishoudelijke dingen bijhoudt. De volgende stappen zijn een uitbreiding naar mijn VvE en daarna een eerste pilot in een buurt of dorp in Groningen, vermoedelijk rond een concreet thema zoals nabuurschap of energietransitie. Daarna komen er bredere toepassingen voor bedrijven, gemeenten en sectoren waar privacy en vertrouwen extra zwaar wegen.

Het is geen kant-en-klaar product dat je morgen in de App Store vindt. Het is een langlopend ontwerp waarin de techniek, de juridische kant en het gebruik in echte groepen tegelijk worden uitgeprobeerd. De komende maanden gaat het vooral om uitproberen en bijschaven — en om met de juiste mensen aan tafel komen.

---

## Een beetje meer over wat eronder zit

Voor wie het echt wil weten — geen jargon, wel iets meer techniek.

Onder de motorkap werkt het systeem met drie principes die in deze combinatie zeldzaam zijn.

**Eigen opslag, niet centrale opslag.** Wat elke gebruiker bijdraagt, staat in een persoonlijke digitale ruimte (gebaseerd op een open standaard genaamd Solid). Die ruimte kan op verschillende plekken bestaan — bij een aanbieder naar keuze, bij een vereniging, of zelfs op een apparaat thuis. Geen centrale database die gehackt of opgevraagd kan worden, want er valt geen centrale database te hacken.

**Een netwerk van mensen, software en apparaten als gelijkwaardige deelnemers.** Wat in een groepsapp gebeurt — een bericht sturen, iets afspreken, iets vastleggen — kan in mijn systeem net zo goed door een persoon worden gedaan als door een slimme assistent of een sensor in huis. "Wie haalt vanavond brood?" kan beantwoord worden door een huisgenoot, maar ook door een agenda die ziet dat iemand toch al langs de bakker komt. Dat klinkt vanzelfsprekend maar is technisch ongebruikelijk: de meeste apps maken een hard onderscheid tussen "echte gebruikers" en "automatiseringen".

**De gebruiker is eindredacteur.** Voordat iets met de groep wordt gedeeld, of voordat het in een aggregatie of overzicht terechtkomt, krijgt de gebruiker eerst de kans om het terug te nemen of aan te passen. Dat is anders dan bij de meeste feedback-tools, waar je op een knop drukt en het is weg uit je handen. Bij mij is "verzenden" een tussenstap, geen eindstation.

Het concrete werk dat nu loopt is een open softwarelaag waarmee deze drie principes voor verschillende toepassingen gebruikt kunnen worden. Een deel ervan wordt mogelijk ondersteund door Europese fondsen voor publieke digitale infrastructuur, en het andere deel wordt in samenwerking met Groningse gemeenschappen ontwikkeld en getest.

---

## Verder lezen

Dit stuk is de toegankelijke samenvatting — een vereenvoudiging van het
hele project. De uitwerking staat in de rest van de [Aanpak](index.md):

- **[Intern werkplan](intern_werkplan_v2.md)** — het concrete plan:
  tijdlijn, financiën, de bouw in concentrische ringen (huishouden →
  VvE → buurt).
- **[Commerciële verkenning](commerciele_verkenning.md)** — de techniek
  en de drie commerciële richtingen, in detail.
- **[Lokale inbedding](verkenning_lokale_inbedding.md)** — het
  gesubsidieerde/lokale spoor in Groningen.
- **[Vijf vervolg-richtingen](vijf_vervolg_richtingen.md)** — extra
  toepassingsgebieden bovenop de hoofdplannen.
