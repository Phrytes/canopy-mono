/* gebruik-leren.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Wat een organisatie vasthoudt",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Wat een organisatie vasthoudt",
      lead:
        "Wat mensen in een organisatie opvalt — “die stap klopt " +
        "niet als …”, “klanten vragen steeds hetzelfde” — " +
        "blijft nu hangen bij personen of in documenten die niemand " +
        "bijhoudt. Hier kun je het kwijt op het moment zelf; losse " +
        "opmerkingen worden zichtbaar als patroon, met verbeterpunten in " +
        "plaats van scores."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "een observatie of frustratie kwijt op het moment zelf, in een " +
        "kanaal waar je al werkt;",
        "het blijft in je eigen ruimte tot je het vrijgeeft;",
        "wat losse signalen worden zichtbaar als patroon, met de bron " +
        "erbij;",
        "je bouwt vanzelf je eigen logboek op van wat je dit jaar " +
        "opmerkte;",
        "het management ziet patronen en verbeterpunten, geen scores of " +
        "ranglijsten."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "jij", text: "het inwerken van nieuwe mensen loopt " +
          "telkens vast op de toegang tot systemen" },
        { who: "bot", text: "Genoteerd in je eigen ruimte. Vergelijkbare " +
          "opmerking kwam deze maand van een paar anderen. Meenemen in " +
          "het maandoverzicht, geanonimiseerd?" },
        { who: "jij", text: "ja" },
        { who: "bot", text: "Je ziet het overzicht voordat het naar het " +
          "team gaat; je kunt je deel er dan nog uit halen." }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je deelt een observatie",
          body:
            "Op het moment zelf, in een kanaal waar je al werkt. Het " +
            "komt in je eigen ruimte."
        },
        {
          title: "Herleidbare details eruit",
          body: "Privé; niemand anders kan meelezen."
        },
        {
          title: "Jij bevestigt",
          body:
            "Je ziet wat er geanonimiseerd meegaat en kunt je deel er " +
            "nog uit halen."
        },
        {
          title: "Patroon, geen scores",
          body:
            "Eén opmerking is anekdote; pas bij meerdere mensen wordt " +
            "het een patroon. Het management ziet verbeterpunten, geen " +
            "ranglijsten."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
