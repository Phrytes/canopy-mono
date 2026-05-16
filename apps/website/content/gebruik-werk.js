/* gebruik-werk.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Meedenken over je werk",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Meedenken over je werk",
      lead:
        "Een doorlopend kanaal waarin medewerkers iets kwijt kunnen — " +
        "wanneer het speelt, niet eens per twee jaar in een enquête. De " +
        "ondernemingsraad of een onafhankelijke partij is de aanbieder, " +
        "niet de werkgever."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "iets melden op het moment dat het opvalt, via een kanaal dat je " +
        "al gebruikt;",
        "ruwe berichten blijven in je eigen ruimte, niet op een " +
        "HR-dashboard;",
        "vóór er iets meetelt, zie en bewerk je wat er — geanonimiseerd " +
        "— van jou wordt meegenomen;",
        "een zware melding (intimidatie, veiligheid) kun je apart houden, " +
        "los van het algemene overzicht;",
        "de werkgever ziet alleen patronen, nooit losse, herleidbare " +
        "berichten."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "jij", text: "de werkdruk op onze afdeling loopt al " +
          "weken uit de hand" },
        { who: "bot", text: "Genoteerd in je eigen ruimte. Voor het " +
          "kwartaaloverzicht naar de OR: zal ik dit straks meenemen, " +
          "geanonimiseerd?" },
        { who: "jij", text: "ja, maar haal de naam van mijn leiding­" +
          "gevende eruit" },
        { who: "bot", text: "Die laat ik weg. Je krijgt het voorstel " +
          "eerst te zien voordat er iets meegaat — je kunt het dan nog " +
          "aanpassen of terugtrekken." }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je meldt iets",
          body:
            "Wanneer het speelt, via chat of scherm. Het komt in je " +
            "eigen ruimte, niet op een dashboard."
        },
        {
          title: "Herleidbare details eruit",
          body:
            "Privé; niemand anders kan meelezen. De ruwe versie blijft " +
            "van jou."
        },
        {
          title: "Jij bevestigt",
          body:
            "Je ziet wat er geanonimiseerd zou meegaan en past aan of " +
            "trekt terug."
        },
        {
          title: "Een drempel",
          body:
            "Het telt pas mee als meer mensen los van elkaar hetzelfde " +
            "melden; daaronder gaat niets door."
        },
        {
          title: "Onafhankelijke verwerking",
          body:
            "De ondernemingsraad of een onafhankelijke partij maakt er " +
            "een overzicht van; de werkgever ziet geen losse berichten."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
