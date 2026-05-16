/* gebruik-buurt.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Burenhulp en klussen in een buurt",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "gepland",
      heading: "Burenhulp en klussen in een buurt",
      lead:
        "Mensen in een buurt kunnen en zoeken van alles, maar vinden " +
        "elkaar niet. Een vraag stellen of iets aanbieden, en daarna " +
        "makkelijk in contact komen — zonder dat het via een groot " +
        "bedrijf loopt."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "een vraag plaatsen (“wie kan mijn fiets maken?”);",
        "iets aanbieden of uitlenen;",
        "een klus uitzetten die iemand kan oppakken, met eventueel " +
        "subtaken eronder;",
        "kiezen wat je deelt en met wie — je profiel ziet er voor de " +
        "buurt anders uit dan voor je eigen kring;",
        "een uitwisseling licht afronden, zonder sterren of " +
        "ranglijsten."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "jij", text: "ik zoek iemand die kan helpen een kast op " +
          "te hangen, dit weekend" },
        { who: "bot", text: "Op het buurt-prikbord gezet. Wil je er een " +
          "tijdstip bij? Twee buren in de buurt geven aan dit soort " +
          "klusjes te willen doen." },
        { who: "jij", text: "zaterdagochtend" },
        { who: "bot", text: "Genoteerd. Zodra iemand reageert, geef ik " +
          "het door — verder regel je het samen." }
      ]
    },

    {
      type: "prose",
      heading: "Hoe het ongeveer werkt",
      paragraphs: [
        "Vraag en aanbod staan in je eigen ruimte; de buurt ziet alleen " +
        "wat je vrijgeeft. De match is een opening — daarna chat of bel " +
        "je, of spreek je af.",
        "Meer hierover: [hoe het werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
