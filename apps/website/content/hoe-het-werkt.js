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
        "Wat die basis bijzonder maakt staat hieronder. De stappen zélf " +
        "verschillen per toepassing — van heel eenvoudig (een " +
        "huishouden) tot uitgebreider (bijvoorbeeld meedenken via een " +
        "ondernemingsraad)."
    },

    {
      type: "prose",
      heading: "Wat de basis bijzonder maakt",
      list: [
        "**Je eigen ruimte, geen centrale database.** Wat je inbrengt " +
        "staat in een afgesloten ruimte waar alleen jij bij kunt — geen " +
        "bedrijf, geen persoon, niemand anders. Geen grote pot om te " +
        "hacken of op te vragen. Je kunt die ruimte meenemen.",
        "**Jij bent eindredacteur.** Niets wordt gedeeld of samengevat " +
        "zonder dat jij het eerst kunt aanpassen of terugnemen. " +
        "Verzenden is een tussenstap, geen eindpunt.",
        "**Een drempel.** Een patroon, citaat of thema verschijnt pas " +
        "als meerdere mensen er los van elkaar aan hebben bijgedragen. " +
        "Daaronder ziet niemand het.",
        "**Een onafhankelijke partij waar dat nodig is.** Degene waar " +
        "het over gaat is niet de aanbieder.",
        "**Vorm-vrij.** Je gebruikt het via een chat, een gewoon scherm, " +
        "of automatisch — wat past.",
        "**Slimme hulp is optioneel en privé.** Zie hieronder."
      ],
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
        "Een huishouden heeft maar een paar stappen: je voegt iets toe, " +
        "de assistent zet het op de gedeelde lijst, klaar. Bij " +
        "gevoeliger toepassingen — bijvoorbeeld meedenken via een " +
        "ondernemingsraad — komen er stappen bij: herleidbare details " +
        "eruit, jij bevestigt, een drempel, en een onafhankelijke partij " +
        "die er een overzicht van maakt.",
        "Op elke [toepassing](wat-los-je-ermee-op.html) staat het " +
        "bijbehorende stappenplan, afgestemd op wat daar nodig is."
      ]
    },

    {
      type: "prose",
      heading: "Slimme hulp: optioneel en privé",
      paragraphs: [
        "Het begrijpen van gewone berichten en het weghalen van " +
        "herleidbare details gebeurt met slimme tekstverwerking (een " +
        "taalmodel). Die kan op je eigen apparaat draaien of in een " +
        "afgeschermde omgeving in de cloud — in beide gevallen zo " +
        "opgezet dat niemand anders je gesprekken kan meelezen, ook de " +
        "aanbieder of hoster niet.",
        "Dat is het verschil met veel bekende AI-assistenten (zoals " +
        "ChatGPT), waar het bedrijf erachter wél bij je invoer kan. En " +
        "het is optioneel: het kan ook via gewone schermen, zonder " +
        "slimme hulp."
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
        "bekende AI-assistenten."
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
        "Wil je het naadje van de kous weten? Onderaan staat een " +
        "mailknop."
    }
  ]
};
