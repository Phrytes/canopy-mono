/* gebruik-melden.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Misstanden veilig melden",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Misstanden veilig melden",
      lead:
        "Een meldkanaal dat niet door de werkgever wordt aangeboden maar " +
        "door een onafhankelijke partij. Je kunt een melding doen, het " +
        "verloop volgen en vragen stellen — zonder dat je identiteit te " +
        "achterhalen is."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "een melding doen via een link, code of poster — niet via een " +
        "kanaal van de organisatie zelf;",
        "zien of de melding is opgepakt en in welke stap het zit;",
        "vragen stellen aan de behandelaar zonder dat je naam meelekt;",
        "zelf bewijs houden van wat je wanneer meldde, in je eigen " +
        "ruimte;",
        "drie losse meldingen over hetzelfde patroon worden zichtbaar " +
        "als patroon, zonder dat de melders aan elkaar te koppelen zijn."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "jij", text: "ik wil iets melden over onveilig werken " +
          "met materieel, maar ik ben bang voor gedoe" },
        { who: "bot", text: "Je melding komt in je eigen ruimte; de " +
          "behandelaar krijgt hem zonder iets wat naar jou herleidt. Wil " +
          "je hem nu indienen of eerst opslaan?" },
        { who: "jij", text: "eerst opslaan, ik wil het morgen nog " +
          "nalezen" },
        { who: "bot", text: "Staat klaar. Je kunt later aanpassen, " +
          "indienen of weghalen — dat bepaal jij." }
      ]
    },

    {
      type: "prose",
      heading: "Hoe het ongeveer werkt",
      paragraphs: [
        "De behandelaar kan niet uitvogelen wie je bent, ook niet via " +
        "vergelijking met andere meldingen. Komt het tot een geschil, " +
        "dan heb jij zelf het bewijspad.",
        "Meer hierover: [hoe het werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
