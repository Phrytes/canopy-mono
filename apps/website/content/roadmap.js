/* roadmap.js — "Stand van zaken". Concreter uitgewerkte tijdlijn,
   feitelijk van toon, geen spoor-tags, geen financiële details. */
window.ONDERLING_PAGE = {
  key: "roadmap",
  title: "Stand van zaken",
  blocks: [
    {
      type: "hero",
      heading: "Stand van zaken",
      lead:
        "Wat er nu is en wat de richting is. Concreet waar het kan; geen " +
        "exacte data, want die liggen niet vast."
    },

    {
      type: "prose",
      heading: "Wat er nu draait",
      paragraphs: [
        "Op dit moment draait er in een huishouden een chat die " +
        "boodschappen, taken en herinneringen bijhoudt, voor meerdere " +
        "huisgenoten tegelijk. Dagelijks in gebruik; daar wordt nu " +
        "geleerd wat werkt en wat schuurt.",
        "De rest hieronder is grotendeels plan. Naast de chat wordt voor " +
        "de buurt- en taken-kant ook aan een gewoon app-scherm gewerkt."
      ]
    },

    {
      type: "timeline",
      heading: "De lijn",
      items: [
        {
          period: "Nu",
          status: "bezig",
          heading: "Eerste versie in een huishouden",
          body:
            "Boodschappen, taken en herinneringen via een chat, meerdere " +
            "huisgenoten tegelijk. In gebruik; nu vooral stabieler maken " +
            "en bijschaven aan de hand van wat in de praktijk schuurt."
        },
        {
          period: "Komende maanden",
          status: "bezig",
          heading: "Eigen opslag per persoon, en de bevestig-stap",
          body:
            "Iedere deelnemer een eigen opslagruimte, plus één gedeelde " +
            "voor het huishouden. En de stap waarin de assistent iets " +
            "voorstelt en jij het bevestigt of aanpast voordat er iets " +
            "gebeurt — die stap komt in elke latere toepassing terug."
        },
        {
          period: "Daarna",
          status: "volgende",
          heading: "Een groep buiten een huishouden",
          body:
            "Een groep met verschillende mensen en wat formele " +
            "besluitvorming: wie ziet wat, aanmelden zonder " +
            "techniekuitleg, en een eerste ronde “wat vinden " +
            "jullie van X” waarbij een losse reactie pas meetelt " +
            "als meer mensen hetzelfde inbrengen."
        },
        {
          period: "En daarna",
          status: "volgende",
          heading: "Een eerste proef in een buurt",
          body:
            "Samen met een lokale partner, rond één concreet thema, met " +
            "mensen die elkaar niet allemaal kennen. Het punt is zien wat " +
            "er anders loopt zodra de mensen elkaar niet kennen."
        },
        {
          period: "Parallel",
          status: "bezig",
          heading: "Gesprekken met wie dit herkent",
          body:
            "Verkennen waar onafhankelijke verwerking nodig is, met " +
            "mensen en organisaties die deze vragen kennen. Luisteren, " +
            "nog niet aanbieden."
        },
        {
          period: "Verderop · richting 2027",
          status: "later",
          heading: "Bredere toepassingen",
          body:
            "Toepassingen rond werk, zorg en meepraten met de overheid, " +
            "en een vorm die de onafhankelijkheid borgt. Hangt af van wat " +
            "de eerdere stappen laten zien."
        }
      ]
    },

    {
      type: "note",
      variant: "plan",
      text:
        "Geen harde toezeggingen. Volgorde en tempo kunnen schuiven; de " +
        "richting niet. Vragen of meedenken? Onderaan staat een mailknop."
    }
  ]
};
