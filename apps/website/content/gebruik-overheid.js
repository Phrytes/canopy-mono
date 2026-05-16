/* gebruik-overheid.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Meepraten met de overheid",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Meepraten met de overheid",
      lead:
        "Een gemeente wil weten wat er leeft rond een concreet plan — " +
        "een herinrichting, een woonvisie. Een inspraakavond bereikt " +
        "vooral de paar luidste stemmen. Hier reageert iedereen op een " +
        "eigen moment, in een paar zinnen en met nuance; de gemeente " +
        "hoort wat er leeft, zonder te zien wie wat zei."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "reageren op een concreet onderwerp (herinrichting, woonvisie, " +
        "energie) wanneer het jou uitkomt;",
        "niet alleen “voor” of “tegen”, maar met nuance " +
        "en voorbehoud;",
        "je bijdrage herzien, intrekken of uitbreiden;",
        "zien wat de gemeente met de patronen doet, als die terugkoppelt;",
        "de gemeente ziet thema's en afwegingen, niet wie precies wat " +
        "zei."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "bot", text: "Het gaat over de herinrichting van het " +
          "plein. Wat zou voor jou belangrijk zijn?" },
        { who: "jij", text: "ik ben voor meer groen, maar maak me zorgen " +
          "over parkeerplekken voor mijn moeder die slecht ter been is" },
        { who: "bot", text: "Helder. Zo zou het meetellen — wil je het " +
          "nog aanpassen voordat het in het overzicht komt?" },
        { who: "jij", text: "nee, zo klopt het" }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je reageert op een concreet plan",
          body:
            "Op je eigen moment, via chat of scherm — genuanceerd, niet " +
            "alleen voor of tegen."
        },
        {
          title: "Herleidbare details eruit",
          body: "Privé; niemand anders kan meelezen."
        },
        {
          title: "Jij bevestigt",
          body:
            "Je ziet wat er meegaat en kunt het bijstellen of intrekken."
        },
        {
          title: "Een drempel",
          body:
            "Het telt mee als patroon, niet als losse, herleidbare zin."
        },
        {
          title: "Gecureerde patronen naar de gemeente",
          body:
            "Terug te leiden naar wat er gezegd is, niet naar wie. Per " +
            "onderwerp aan en weer uit — geen permanent platform."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
