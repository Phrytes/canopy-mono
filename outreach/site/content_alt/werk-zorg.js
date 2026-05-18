/* werk-zorg.js — subpagina Werk & maatschappij. Patiëntervaringen.
   Specifiek element: nuance over wat de patiëntenorganisatie wel
   en niet kan, plus prominente acute-nood-disclaimer. key:"werk". */
window.ONDERLING_PAGE = {
  key: "werk",
  title: "Ervaringen delen in de zorg",
  blocks: [
    { type: "backlink", href: "werk.html", label: "Werk & maatschappij" },

    {
      type: "hero",
      heading: "Ervaringen delen in de zorg",
      lead:
        "Een formulier invullen vlak na een nare ervaring doen vooral " +
        "de boze mensen, met scherpe woorden die makkelijk weg te " +
        "zetten zijn als uitschieter. Wie nog in behandeling is, of " +
        "afhankelijk van de instelling, zet z'n naam er niet onder."
    },

    {
      type: "prose",
      paragraphs: [
        "Daardoor blijft het verhaal van de stille meerderheid " +
        "onverteld, en duurt het jaren voordat een instelling ziet " +
        "dat er iets structureels misgaat. Hier deel je op je eigen " +
        "tempo, in je eigen woorden — geschreven of ingesproken — " +
        "tussen het moment dat er iets is gebeurd en het moment dat " +
        "je het kunt uitleggen.",
        "Wat je deelt gaat niet naar de zorgaanbieder zelf, maar " +
        "naar een onafhankelijke patiëntenorganisatie, en alleen " +
        "wat jij vrijgeeft. Je beslist per keer wat meegaat, en je " +
        "kunt het tot een afgesproken moment nog terugnemen. Voor " +
        "een breder beeld telt het pas mee als meer mensen, los van " +
        "elkaar, in dezelfde richting wijzen."
      ]
    },

    {
      type: "prose",
      heading: "Wat de patiëntenorganisatie ermee kan",
      paragraphs: [
        "Een patiëntenorganisatie is geen toezichthouder en geen " +
        "klachtenloket. Wat ze wél kan: structurele signalen " +
        "doorgeven aan de instelling, aan de inspectie, of aan de " +
        "minister — onderbouwd met een breed beeld in plaats van met " +
        "anekdotes. Voor jou als persoon kan dat indirect verlichting " +
        "geven, doordat iets dat jou is overkomen ook tegen anderen " +
        "wordt opgenomen. Maar verwacht geen rechtstreekse reactie " +
        "op jouw situatie via deze weg.",
        "Voor wie een rechtstreekse klacht over een individuele " +
        "zaak wil indienen, blijven de gewone wegen open — de " +
        "klachtenfunctionaris van de instelling, de geschillen-" +
        "commissie zorg, in laatste instantie de tuchtrechter. Dit " +
        "is een aanvulling op die wegen, geen vervanging."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "**Acute hulp staat hier los van.** De assistent is geen " +
        "hulpverlener en neemt niet uit zichzelf contact op met een " +
        "zorgaanbieder of instantie. Bij acute nood blijf je " +
        "aangewezen op de gewone hulplijnen — huisarts, 112, of " +
        "113 voor gedachten aan zelfdoding."
    }
  ]
};
