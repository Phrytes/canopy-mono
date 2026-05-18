/* techniek.js — v2 met open code expliciet als fundament en
   verwijzing naar waarborgen. */
window.ONDERLING_PAGE = {
  key: "techniek",
  title: "Techniek",
  blocks: [
    {
      type: "hero",
      heading: "Wat er onder de motorkap zit",
      lead:
        "Voor wie het naadje van de kous wil weten. Eerst in gewone " +
        "taal hoe het in elkaar zit; onderaan de echte termen met " +
        "uitleg, voor wie ze wil opzoeken."
    },

    {
      type: "prose",
      heading: "Geen apps, wel gegevens en ingangen",
      paragraphs: [
        "Het idee waar alles op rust is dat Onderling niet één " +
        "programma is, en ook geen verzameling losse apps die elkaar " +
        "soms vinden. Wat er is, zijn gegevens — lijstjes, taken, " +
        "afspraken, vragen, aanbod, ervaringen — en die staan in een " +
        "ruimte die van jou is. Niet in de app, niet bij een bedrijf, " +
        "niet in een gedeelde database. Bij jou.",
        "Een chat-assistent, een scherm met lijstjes, een prikbord, " +
        "straks misschien iets anders: dat zijn ingangen tot diezelfde " +
        "gegevens. Verschillende ingangen kunnen naast elkaar bestaan, " +
        "en wat je er via de ene in zet, zie je via de andere terug — " +
        "want het ligt niet in de ingang maar op je eigen plek. " +
        "Verdwijnt een ingang, dan blijven de gegevens; dan open je ze " +
        "ergens anders."
      ]
    },

    {
      type: "prose",
      heading: "Toegang in plaats van eigendom",
      paragraphs: [
        "Wat zo'n ruimte tot “van jou” maakt, is dat alleen jij erbij " +
        "kunt. Wil je iets met anderen delen, dan geef je toegang tot " +
        "specifieke onderdelen — niet tot alles. Zo zien je huisgenoten " +
        "de gedeelde boodschappenlijst, maar niet je persoonlijke " +
        "herinneringen. Zo ziet de buurt wat jij in je profiel " +
        "vrijgeeft, maar niet wat je voor jezelf hebt staan. En zo " +
        "kun je dezelfde gegevens met de ene groep wel en met de " +
        "andere niet delen, zonder dat je twee plekken hoeft bij te " +
        "houden.",
        "Op dezelfde manier delen ook mensen onderling. In een " +
        "huishouden is de toegang ruim en wederzijds. In een buurt " +
        "open je je profiel naar wie je wilt. In werk en " +
        "maatschappij gaat het juist via een omweg: bijdragen worden " +
        "samengevoegd voordat er iets verschijnt, en wie de uitkomst " +
        "ziet weet niet wie er afzonderlijk aan bijdroeg."
      ]
    },

    {
      type: "prose",
      heading: "Hoe ruimtes met elkaar praten",
      paragraphs: [
        "Omdat er geen centrale server in het midden zit, moeten de " +
        "ruimtes wel een manier hebben om elkaar te vinden en te " +
        "bereiken. Dichtbij gebeurt dat rechtstreeks — twee toestellen " +
        "in dezelfde ruimte zien elkaar via het lokale netwerk of via " +
        "een korte radioverbinding. Verder weg loopt het via een " +
        "doorgeefluik: een hulpserver die berichten doorgeeft maar zelf " +
        "niets onthoudt of leest. Welke route gebruikt wordt is een " +
        "kwestie van praktische optimalisatie, niet van vertrouwen — " +
        "wat erdoorheen gaat is sowieso versleuteld.",
        "Slimme helpers — kleine programmaatjes die een afgebakende " +
        "taak doen, zoals iets opschonen, samenvatten of doorgeven — " +
        "spelen mee als losse deelnemers. Ze horen bij een ruimte (van " +
        "jou, of van een groep) en kunnen alleen wat je ze toestaat. " +
        "Ze zijn verplaatsbaar: je neemt ze mee als je de ruimte " +
        "verhuist naar een andere aanbieder."
      ]
    },

    {
      type: "prose",
      heading: "Open code en open standaarden",
      paragraphs: [
        "Alles hierboven gaat ervan uit dat de techniek doet wat hier " +
        "beschreven staat. De code is open en blijft open — wie wil, " +
        "kan zelf nagaan dat het zo werkt. Het rust op open " +
        "standaarden (zoals Solid voor de persoonlijke ruimtes), wat " +
        "betekent dat je niet aan één aanbieder vast komt te zitten en " +
        "dat anderen verder kunnen bouwen op dezelfde basis. Welke " +
        "rol dat speelt in hoe dit project geloofwaardig overeind " +
        "blijft, staat onder [de waarborgen](waarborgen.html)."
      ]
    },

    {
      type: "prose",
      heading: "Drie ringen, dezelfde fundamenten",
      paragraphs: [
        "Onder elk van de drie ringen op deze site ligt dezelfde " +
        "basis. Wat verschilt is welke gegevens er spelen, en hoe de " +
        "toegang erop is geregeld. De ring-pagina's hebben elk een " +
        "eigen uitleg van die kant; hier alleen het overzicht:"
      ],
      list: [
        "**[Thuis, technisch gezien](techniek-thuis.html)** — " +
        "gedeelde lijsten, taken met toebedeling, herinneringen, " +
        "korte chat-coördinatie. Toegang is ruim binnen een " +
        "huishouden en strikt erbuiten.",
        "**[Buurt, technisch gezien](techniek-buurt.html)** — " +
        "vraag- en aanbod-items, profielen waarvan je per groep " +
        "kiest wat zichtbaar is, matching op vaardigheden. " +
        "Onderling vinden gebeurt lokaal of via een doorgeefluik.",
        "**[Werk en maatschappij, technisch gezien]" +
        "(techniek-werk.html)** — een extra laag bovenop het " +
        "bovenstaande. Bijdragen worden eerst opgeschoond, door jou " +
        "bevestigd, en pas zichtbaar als er genoeg los van elkaar in " +
        "dezelfde richting wijzen. Een tussenpartij doet de " +
        "eindcontrole."
      ]
    },

    {
      type: "prose",
      heading: "De termen, voor wie ze wil opzoeken",
      list: [
        "**Solid pod / eigen ruimte** — een persoonlijke opslag op " +
        "de open standaard Solid. Geen centrale database; je kunt " +
        "hem bij een aanbieder naar keuze zetten en meenemen.",
        "**Data-item** — een lijstje, taak, vraag, aanbod, afspraak, " +
        "foto, ervaringsbericht. Dit is wat er werkelijk bestaat; de " +
        "interface waarmee je het ziet is een venster erop.",
        "**Interface / ingang** — een chat, een scherm, een " +
        "prikbord-weergave. Onderling kent meerdere ingangen tot " +
        "dezelfde data-items.",
        "**Toegangsrechten** — wie wat mag zien of veranderen. " +
        "Ingebed in de structuur van de pod zelf, niet in een aparte " +
        "instelling die je per app moet aanvinken.",
        "**Decentrale verbindingen** — ruimtes en helpers verbinden " +
        "rechtstreeks met elkaar in plaats van via één centrale " +
        "server. Lokaal via mDNS of Bluetooth; verder weg via een " +
        "doorgeefluik.",
        "**Doorgeefluik / relay** — een hulpserver die berichten " +
        "doorgeeft voor het geval twee kanten niet tegelijk online " +
        "zijn. Bewaart de inhoud niet, leest niet mee.",
        "**Agents / helpers** — kleine zelfstandige programma's die " +
        "afgebakende taken doen; horen bij een ruimte en kunnen " +
        "alleen wat ze mogen.",
        "**Skill-matching** — agents en mensen kunnen kenbaar " +
        "maken wat ze kunnen of zoeken; vraag en aanbod vinden " +
        "elkaar zonder centrale matchmaker.",
        "**Drempel / k-anonimiteit** — iets verschijnt pas in een " +
        "overzicht als minimaal een afgesproken aantal mensen er " +
        "onafhankelijk aan bijdroeg; daaronder wordt het verwijderd. " +
        "Speelt vooral in werk en maatschappij.",
        "**Aggregeerruimte** — een afgeschermde verzamelplek waar " +
        "goedgekeurde, geanonimiseerde bijdragen samenkomen en " +
        "worden samengevat; niemand heeft er directe toegang toe. " +
        "Speelt vooral in werk en maatschappij.",
        "**Taalmodel / LLM** — slimme tekstverwerking die berichten " +
        "begrijpt en, waar nodig, gevoelige details weghaalt. Draait " +
        "lokaal of in een afgeschermde omgeving; geen ander " +
        "kan meelezen, ook het bedrijf erachter niet.",
        "**Open source** — de code achter Onderling is publiek " +
        "beschikbaar, en blijft dat. Wie wil kan zelf nagaan dat het " +
        "doet wat hier staat; wie verder wil bouwen kan dat doen.",
        "**Bouwpakket / SDK** — de gedeelde codebasis waarmee " +
        "verschillende ingangen op dezelfde onderlaag worden " +
        "gemaakt, zonder de werking ervan opnieuw uit te vinden."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Dit is een schets op hoofdlijnen, geen technische " +
        "documentatie. Een deel werkt, een deel is ontwerp — zie " +
        "[stand van zaken](stand-van-zaken.html). Voor verdieping per " +
        "ring: [thuis](techniek-thuis.html), " +
        "[buurt](techniek-buurt.html), [werk en maatschappij]" +
        "(techniek-werk.html)."
    }
  ]
};
