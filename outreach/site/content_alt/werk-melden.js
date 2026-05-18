/* werk-melden.js — subpagina Werk & maatschappij. Klokkenluiden.
   Specifiek element: korte verwijzing naar wettelijke context en
   de rol die deze opzet kan spelen. key:"werk". */
window.ONDERLING_PAGE = {
  key: "werk",
  title: "Misstanden veilig melden",
  blocks: [
    { type: "backlink", href: "werk.html", label: "Werk & maatschappij" },

    {
      type: "hero",
      heading: "Misstanden veilig melden",
      lead:
        "Een meldkanaal dat de werkgever zelf aanbiedt vraagt veel " +
        "vertrouwen: je identiteit is verborgen voor de directie, " +
        "maar zichtbaar voor de beheerder en de aangewezen " +
        "behandelaar. Veel meldingen sterven daar, of worden nooit " +
        "gedaan."
    },

    {
      type: "prose",
      paragraphs: [
        "Sinds 2023 zijn organisaties met vijftig medewerkers of " +
        "meer wettelijk verplicht een meldkanaal voor misstanden te " +
        "hebben. De wet schrijft niet voor dat dat kanaal door de " +
        "werkgever zelf moet worden uitgevoerd — alleen dát het er " +
        "moet zijn, en dat melders worden beschermd. In de praktijk " +
        "kopen organisaties meestal een SaaS-meldsysteem in, met " +
        "alle gegevens centraal opgeslagen bij de leverancier. " +
        "Veiliger dan een direct mailtje naar HR, maar nog steeds " +
        "een doos waar gegevens in samenkomen.",
        "Hier loopt het kanaal via een onafhankelijke partij — een " +
        "sectorraad, een beroepsvereniging — en niet via de " +
        "organisatie waarover je meldt. Je doet je melding via een " +
        "link of een code, en de behandelaar krijgt ze zonder iets " +
        "wat naar jou herleidt. Ook niet door jouw melding te " +
        "vergelijken met andere: dat staat de opzet niet toe."
      ]
    },

    {
      type: "prose",
      heading: "Wat het anders maakt",
      paragraphs: [
        "Twee dingen, vooral. Het eerste: je kunt het verloop " +
        "volgen. Je ziet of er iets mee gebeurt, je kunt vragen " +
        "stellen zonder dat je naam meelekt, en je houdt zelf het " +
        "spoor van wat je wanneer hebt gemeld. Komt het ooit tot " +
        "een conflict over of er wel iets mee is gedaan, dan heb " +
        "jij het bewijs in handen, niet de ander.",
        "Het tweede: drie losse meldingen over hetzelfde worden " +
        "zichtbaar als één lijn, zonder dat de melders aan elkaar " +
        "te koppelen zijn. Een patroon dat normaal pas duidelijk " +
        "wordt als iemand zich alsnog blootgeeft, ontstaat hier " +
        "doordat het systeem zelf de verbanden ziet — maar niet de " +
        "personen erachter. Hoe het technisch onherleidbaar blijft, " +
        "staat op [werk en maatschappij, technisch gezien]" +
        "(techniek-werk.html)."
      ]
    }
  ]
};
