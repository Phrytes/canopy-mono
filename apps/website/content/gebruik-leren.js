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
      type: "prose",
      heading: "Hoe het ongeveer werkt",
      paragraphs: [
        "Eén opmerking is anekdote; meerdere los van elkaar is een " +
        "patroon — en pas dan verschijnt het. Bron blijft volgbaar, " +
        "zonder dat losse bijdragen herleidbaar zijn.",
        "Meer hierover: [hoe het werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
