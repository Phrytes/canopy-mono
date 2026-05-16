/* hoe-het-werkt.js — over de gedeelde basis onder alle toepassingen.
   Hoofdtekst jargon-vrij; vaktermen staan los, mét uitleg, onder
   "Voor wie benieuwd is naar de technische details". */
window.ONDERLING_PAGE = {
  key: "techniek",
  title: "Hoe het werkt",
  blocks: [
    {
      type: "hero",
      heading: "Hoe het werkt",
      lead:
        "Onder alle toepassingen op deze site ligt één gedeelde basis. " +
        "Een paar dingen gelden altijd; andere alleen daar waar je " +
        "bijdrage in een groter geheel meetelt. En de stappen zélf " +
        "verschillen per toepassing — van heel eenvoudig (een " +
        "huishouden) tot uitgebreider (bijvoorbeeld meedenken via een " +
        "ondernemingsraad)."
    },

    {
      type: "prose",
      heading: "Wat altijd geldt",
      list: [
        "**Je eigen ruimte, geen centrale database.** Wat je inbrengt " +
        "staat in een afgesloten ruimte waar alleen jij bij kunt — geen " +
        "bedrijf, geen persoon, niemand anders. Geen grote pot om te " +
        "hacken of op te vragen. Je kunt die ruimte meenemen.",
        "**Jij bent eindredacteur.** Niets wordt gedeeld of samengevat " +
        "zonder dat jij het eerst kunt aanpassen of terugnemen. " +
        "Verzenden is een tussenstap, geen eindpunt.",
        "**Vorm-vrij.** Je gebruikt het via een chat, via lijstjes en " +
        "knoppen in de app, of automatisch — wat past.",
        "**Slimme hulp is optioneel en privé.** Zie verderop."
      ]
    },

    {
      type: "prose",
      heading: "Alleen waar je bijdrage in een groter geheel meetelt",
      paragraphs: [
        "Bij toepassingen waar veel mensen iets inbrengen dat samen een " +
        "beeld vormt — meedenken over je werk, ervaringen in de zorg, " +
        "meepraten met de gemeente — gaat het zo. Bij een huishoudlijstje " +
        "of een buurtprikbord speelt dit niet."
      ]
    },

    {
      type: "steps",
      heading: "Zo gaat dat, stap voor stap",
      items: [
        {
          title: "In je eigen ruimte",
          body:
            "Je bericht komt eerst in je eigen, afgesloten ruimte. " +
            "Alleen jij kunt erbij."
        },
        {
          title: "Optioneel opgeschoond door een privé-AI",
          body:
            "Een privé-AI haalt krachttermen, namen en herleidbare " +
            "details eruit. Alleen jij kunt bij die AI; ze deelt niets " +
            "met een achterliggend bedrijf. Het is optioneel — het kan " +
            "ook zonder."
        },
        {
          title: "Jij bevestigt",
          body:
            "Je ziet wat er — geanonimiseerd — zou meegaan en past aan " +
            "of trekt terug. Jij bent eindredacteur, niet de computer."
        },
        {
          title: "Anoniem verzameld en samengevat",
          body:
            "Een afgeschermde verzamelplek bij de dienstverlener (een " +
            "“aggregeerpod”) haalt de goedgekeurde bijdragen " +
            "anoniem op en vat ze samen. Niemand heeft daar directe " +
            "toegang toe."
        },
        {
          title: "Pas vanaf een drempel",
          body:
            "Een patroon, citaat of thema verschijnt pas als meerdere " +
            "mensen er los van elkaar aan bijdroegen. Daaronder ziet " +
            "niemand het."
        },
        {
          title: "Naar de opdrachtgever, via een onafhankelijke partij",
          body:
            "Het samengevatte beeld gaat naar de opdrachtgever. Degene " +
            "waar het over gaat is niet de aanbieder; een onafhankelijke " +
            "partij doet de eindcontrole."
        }
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Diezelfde basis maakt steeds nieuwe toepassingen mogelijk; een " +
        "paar daarvan staan bij [wat los je ermee " +
        "op](wat-los-je-ermee-op.html)."
      ]
    },

    {
      type: "prose",
      heading: "De stappen verschillen per toepassing",
      paragraphs: [
        "Een huishouden heeft maar een paar stappen; de zes hierboven " +
        "gelden waar je bijdrage in een groter geheel meetelt. Op elke " +
        "[toepassing](wat-los-je-ermee-op.html) staat het bijbehorende " +
        "stappenplan, afgestemd op wat daar nodig is."
      ]
    },

    {
      type: "prose",
      heading: "Slimme hulp: optioneel en privé",
      paragraphs: [
        "Zowel het begrijpen van gewone berichten als het opschonen " +
        "gebeurt met slimme tekstverwerking (een taalmodel). Die kan op " +
        "je eigen apparaat draaien of in een afgeschermde omgeving in de " +
        "cloud — in beide gevallen zo opgezet dat niemand anders kan " +
        "meelezen, ook de aanbieder of hoster niet.",
        "Dat is het verschil met veel bekende AI-assistenten (zoals " +
        "ChatGPT), waar het bedrijf erachter wél bij je invoer kan. En " +
        "het is optioneel: het kan ook met lijstjes en knoppen in de " +
        "app, zonder slimme hulp."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Geldt overal: niets gaat automatisch buiten jou om; er wordt " +
        "niet uit zichzelf contact opgenomen met anderen, en het is geen " +
        "hulpverlener."
    },

    {
      type: "prose",
      heading: "Voor wie benieuwd is naar de technische details",
      paragraphs: [
        "Een paar termen, voor wie ze wil opzoeken:"
      ],
      list: [
        "**Eigen ruimte / pod** — je persoonlijke opslag, gebaseerd op " +
        "de open standaard Solid. Geen centrale database; je kunt hem bij " +
        "een aanbieder naar keuze zetten en meenemen.",
        "**Drempel / k-anonimiteit** — een patroon verschijnt pas als " +
        "minimaal een afgesproken aantal mensen er onafhankelijk aan " +
        "bijdroeg; daaronder wordt het verwijderd.",
        "**Taalmodel / LLM** — de slimme tekstverwerking die berichten " +
        "begrijpt en herleidbare details weghaalt. Kan lokaal of in een " +
        "afgeschermde cloud-omgeving draaien; zo opgezet dat niemand " +
        "anders meeleest, ook de aanbieder niet — anders dan bij veel " +
        "bekende AI-assistenten.",
        "**Aggregeerpod** — de afgeschermde verzamelplek bij de " +
        "dienstverlener waar goedgekeurde, geanonimiseerde bijdragen " +
        "samenkomen en worden samengevat; niemand heeft er directe " +
        "toegang toe."
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Onder de motorkap is het een netwerk waarin kleine helpers " +
        "(programmaatjes) taken kunnen oppakken naast mensen. De " +
        "gegevens blijven bij de gebruiker; de helpers zijn " +
        "verplaatsbaar tussen apparaten en aanbieders, zodat je niet aan " +
        "één leverancier vastzit.",
        "De onderlaag is open en wordt deels met publieke fondsen voor " +
        "digitale infrastructuur ontwikkeld. Een deel werkt al, een deel " +
        "is ontwerp — zie [stand van zaken](roadmap.html)."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Dit is een schets op hoofdlijnen, geen technische documentatie. " +
        "Dieper doorvragen kan later; de site is nog in opbouw."
    }
  ]
};
