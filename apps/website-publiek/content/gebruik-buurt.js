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
      type: "mockup",
      kind: "prikbord",
      heading: "En zo op het prikbord",
      title: "Prikbord · jouw buurt",
      items: [
        { tag: "Vraag",  text: "Wie kan m'n fiets maken?", hint: "200 m" },
        { tag: "Aanbod", text: "Ladder te leen",           hint: "3 buren" },
        { tag: "Vraag",  text: "Oppas gezocht, donderdagavond" },
        { tag: "Lenen",  text: "Boormachine — vrij dit weekend" }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je plaatst een vraag of aanbod",
          body:
            "“Wie kan helpen met X”, of iets dat je aanbiedt " +
            "of uitleent — via een bericht of in de app."
        },
        {
          title: "Buren zien wat je vrijgeeft",
          body:
            "Je profiel toont aan de buurt alleen wat jij deelt; de rest " +
            "blijft in je eigen ruimte."
        },
        {
          title: "Reageert iemand, dan komen jullie in contact",
          body:
            "De match is een opening; verder regel je het samen — " +
            "chatten, bellen, of afspreken."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
