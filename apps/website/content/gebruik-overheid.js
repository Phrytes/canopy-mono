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
      type: "prose",
      heading: "Hoe het ongeveer werkt",
      paragraphs: [
        "Bijdragen blijven van de bewoner; de gemeente krijgt gecureerde " +
        "patronen, terug te leiden naar wat er gezegd is, niet naar wie. " +
        "Per onderwerp aan en weer uit, geen permanent platform.",
        "Meer hierover: [hoe het werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
