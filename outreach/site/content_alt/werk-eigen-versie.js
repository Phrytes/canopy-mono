/* werk-eigen-versie.js — subpagina Werk & maatschappij. Witlabel-
   licentie. Specifiek element: concrete invulling van wat een
   organisatie zelf doet en wat de onderlaag doet. key:"werk". */
window.ONDERLING_PAGE = {
  key: "werk",
  title: "Een eigen versie op dezelfde basis",
  blocks: [
    { type: "backlink", href: "werk.html", label: "Werk & maatschappij" },

    {
      type: "hero",
      heading: "Een eigen versie op dezelfde basis",
      lead:
        "Niet elke organisatie hoeft dit opnieuw te bedenken. Een " +
        "vakbond, een koepel, een meldpunt: wie een achterban in een " +
        "kwetsbare positie bedient, kan een eigen versie aanbieden — " +
        "eigen naam, eigen voorkant — op dezelfde onderlaag."
    },

    {
      type: "prose",
      paragraphs: [
        "De eigenschappen komen mee: ieders inbreng in een eigen " +
        "ruimte, de bevestig-stap, de drempel voordat iets in een " +
        "breder beeld verschijnt, en geen centrale bak om te lekken. " +
        "Wat een partij zelf invult is de buitenkant en de keuze wie " +
        "de onafhankelijke verwerking doet — zelf, of uitbesteed. Er " +
        "is geen toegang tot de gegevens van andere partijen die " +
        "dezelfde basis gebruiken."
      ]
    },

    {
      type: "prose",
      heading: "Wat de organisatie invult, en wat al klaar staat",
      paragraphs: [
        "Een paar dingen verschillen per organisatie, en moeten dus " +
        "bij de inrichting worden gekozen:"
      ],
      list: [
        "**Wie de achterban is en hoe ze worden uitgenodigd.** Een " +
        "vakbond doet dat anders dan een patiëntenkoepel; een " +
        "meldpunt anders dan een sectorraad.",
        "**Welke onderwerpen er spelen en wanneer er ophalingen " +
        "lopen.** Doorlopend, per kwartaal, of per specifieke " +
        "thematiek.",
        "**Wie de eindcontrole doet.** De organisatie zelf met een " +
        "ingerichte onafhankelijkheid, of een externe partij die de " +
        "verwerking verzorgt.",
        "**De voorkant.** Eigen naam, eigen huisstijl, eigen " +
        "uitnodigingen — geen verplichte herkenningstekens van de " +
        "onderlaag."
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Wat al klaar staat, en niet hoeft te worden uitgevonden: " +
        "de eigen-ruimte-architectuur, de filter-pipeline met " +
        "bevestig-stap, de drempel-mechanismen, de afgeschermde " +
        "verzamelruimte, het scheiden van zware meldingen van " +
        "patroon-bijdragen, en de overdraagbaarheid tussen aanbieders.",
        "Dit is geen los eindproduct maar de gedeelde bodem onder " +
        "alles op deze site, beschikbaar gemaakt voor wie er een " +
        "eigen toepassing op wil zetten. Vooral interessant voor " +
        "partijen die nu een centrale database hebben en daar vanaf " +
        "willen, of die vanwege hun rol juist geen centrale database " +
        "mógen hebben. De techniek staat op [werk en maatschappij, " +
        "technisch gezien](techniek-werk.html); waarom de organisatie " +
        "eromheen onafhankelijk hoort te zijn, op [onafhankelijk " +
        "blijven](onafhankelijkheid.html)."
      ]
    }
  ]
};
