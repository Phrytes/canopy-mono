/* techniek.js — sectie 4: Technische principes. Gelaagd: gewone taal
   eerst, vaktermen mét uitleg in een aparte glossary. Eerlijk een
   schets, geen documentatie. Bron: Project Files/Aanpak + projects/
   + standardisation/SDK (verder uit te diepen). */
window.ONDERLING_PAGE = {
  key: "techniek",
  title: "Techniek",
  blocks: [
    {
      type: "hero",
      heading: "Wat er onder de motorkap zit",
      lead:
        "Voor wie het naadje van de kous wil. Eerst in gewone taal hoe " +
        "het in elkaar steekt; onderaan de echte termen met uitleg, voor " +
        "wie ze wil opzoeken."
    },

    {
      type: "prose",
      heading: "Geen midden, wel verbinding",
      paragraphs: [
        "Het idee waar alles op rust is dat er geen centrale plek is " +
        "waar alle gegevens samenkomen. In plaats daarvan heeft iedereen " +
        "een eigen, afgeschermde ruimte, en die ruimtes praten " +
        "rechtstreeks met elkaar wanneer dat nodig is. Er valt dus geen " +
        "grote bak te hacken of op te vragen, want die bestaat niet — " +
        "wat je hebt is veel kleine ruimtes die ieder van één persoon " +
        "zijn.",
        "Naast mensen lopen er kleine, zelfstandige helpers mee: " +
        "programmaatjes die een afgebakende taak doen — iets opschonen, " +
        "iets samenvatten, iets doorgeven — en daarna weer ophouden te " +
        "bestaan. Ze zijn verplaatsbaar: je kunt je ruimte en je helpers " +
        "meenemen naar een andere aanbieder, zodat je nergens aan " +
        "vastzit."
      ]
    },

    {
      type: "prose",
      heading: "De keten, kort",
      paragraphs: [
        "Waar je bijdrage in een groter geheel meetelt, is de route " +
        "steeds dezelfde: ze begint in jouw eigen ruimte, wordt daar " +
        "desgewenst opgeschoond, jij geeft ze vrij, en pas dan komt ze " +
        "anoniem samen op een afgeschermde verzamelplek waar niemand " +
        "rechtstreeks in kan kijken. De volledige uitleg in gewone taal " +
        "staat op [hoe werkt het](hoe-het-werkt.html); hieronder de " +
        "termen die daarbij horen."
      ]
    },

    {
      type: "prose",
      heading: "De termen, voor wie ze wil opzoeken",
      list: [
        "**Solid pod / eigen ruimte** — een persoonlijke opslag op de " +
        "open standaard Solid. Geen centrale database; je kunt hem bij " +
        "een aanbieder naar keuze zetten en meenemen.",
        "**Decentrale connecties** — ruimtes en helpers verbinden " +
        "rechtstreeks met elkaar in plaats van via één centrale server.",
        "**Relay-server** — een doorgeefluik voor het geval twee kanten " +
        "niet tegelijk online zijn; het bewaart de inhoud niet, het geeft " +
        "alleen door.",
        "**Agents** — de kleine zelfstandige helpers (mens of programma) " +
        "die taken oppakken; portable tussen apparaten en aanbieders.",
        "**JavaScript-SDK** — het bouwpakket waarmee een toepassing op " +
        "deze onderlaag gemaakt wordt, zonder de werking ervan opnieuw " +
        "uit te vinden.",
        "**Drempel / k-anonimiteit** — iets verschijnt pas in een " +
        "overzicht als minimaal een afgesproken aantal mensen er " +
        "onafhankelijk aan bijdroeg; daaronder wordt het verwijderd.",
        "**Aggregeerpod** — de afgeschermde verzamelplek waar " +
        "goedgekeurde, geanonimiseerde bijdragen samenkomen en worden " +
        "samengevat; niemand heeft er directe toegang toe.",
        "**Taalmodel / LLM** — de slimme tekstverwerking die berichten " +
        "begrijpt en gevoelige details weghaalt; draait lokaal of in een " +
        "afgeschermde omgeving, zo dat niemand anders meeleest, ook de " +
        "aanbieder niet."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Dit is een schets op hoofdlijnen, geen technische documentatie. " +
        "Per sfeer (thuis, buurt, werk & maatschappij) komt hier later " +
        "een diepere uitleg bij; de bouwplannen zelf liggen in de " +
        "projectstukken, niet op deze site. Een deel werkt, een deel is " +
        "ontwerp — zie [stand van zaken](stand-van-zaken.html)."
    }
  ]
};
