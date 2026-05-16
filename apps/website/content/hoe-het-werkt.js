/* hoe-het-werkt.js — techniek-pagina voor de nieuwsgierige. Gewone
   taal, echte begrippen genoemd, eerlijk, zonder hype of pitch. */
window.ONDERLING_PAGE = {
  key: "techniek",
  title: "Hoe het werkt",
  blocks: [
    {
      type: "hero",
      heading: "Hoe het werkt",
      lead:
        "Je gebruikt het via een chat, een scherm of automatisch. " +
        "Daaronder zitten een paar vaste stappen, hetzelfde ongeacht hoe " +
        "je het gebruikt. Hieronder in gewone taal, met de echte " +
        "begrippen erbij voor wie ze wil opzoeken."
    },

    {
      type: "steps",
      heading: "De stappen",
      items: [
        {
          title: "Eigen opslag",
          body:
            "Elke gebruiker heeft een eigen, persoonlijke ruimte " +
            "(gebaseerd op de open standaard Solid — een “pod”). " +
            "Wat je inbrengt staat daar, niet in een centrale database. " +
            "Die ruimte kan bij een aanbieder naar keuze staan, en je " +
            "kunt hem meenemen."
        },
        {
          title: "Lokaal opschonen",
          body:
            "Voordat er iets de deur uit kan, worden herleidbare details " +
            "(namen, evidente kenmerken) eruit gehaald. Dat gebeurt zo " +
            "dicht mogelijk bij jou, niet op een centrale plek. De ruwe " +
            "versie blijft van jou."
        },
        {
          title: "Zelf bevestigen",
          body:
            "Je ziet wat er van jou zou meegaan en kunt het aanpassen of " +
            "terugnemen. Verzenden is een tussenstap, geen eindpunt — " +
            "niet de computer is eindredacteur, maar jij."
        },
        {
          title: "Een drempel",
          body:
            "Een patroon, citaat of thema verschijnt pas als een " +
            "minimaal aantal mensen er los van elkaar aan heeft " +
            "bijgedragen (k-anonimiteit). Daaronder wordt het verwijderd; " +
            "niemand ziet het ooit."
        },
        {
          title: "Onafhankelijke verwerking",
          body:
            "Een onafhankelijke partij maakt er een overzicht van. " +
            "Degene waar het over gaat zit daar niet tussen. Een zwaar, " +
            "los signaal kan — met jouw expliciete akkoord — apart " +
            "worden gehouden in plaats van te wachten op een patroon."
        }
      ]
    },

    {
      type: "prose",
      heading: "Slimme hulp: optioneel en privé",
      paragraphs: [
        "Het begrijpen van gewone berichten en het weghalen van " +
        "herleidbare details gebeurt met een taalmodel — een privé-AI; " +
        "technisch een LLM. Dat draait lokaal, op je eigen apparaat, " +
        "niet in de cloud van een bedrijf.",
        "Het is optioneel: het kan ook via gewone schermen, zonder " +
        "slimme hulp. En een model in de cloud gebeurt alleen als je dat " +
        "zelf expliciet aanzet — nooit stilzwijgend."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Geldt overal: niets gaat automatisch buiten jou om; er wordt " +
        "niet uit zichzelf contact opgenomen met anderen, en het is geen " +
        "hulpverlener."
    },

    {
      type: "prose",
      heading: "Voor wie nog dieper wil",
      paragraphs: [
        "Onder de motorkap is het een netwerk waarin kleine helpers " +
        "(programmaatjes) taken kunnen oppakken naast mensen. De " +
        "gegevens blijven bij de gebruiker; de helpers zijn " +
        "verplaatsbaar tussen apparaten en aanbieders, zodat je niet aan " +
        "één leverancier vastzit.",
        "De onderlaag is open en wordt deels met publieke fondsen voor " +
        "digitale infrastructuur ontwikkeld. Een deel werkt al, een deel " +
        "is ontwerp — zie [stand van zaken](roadmap.html)."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Dit is een schets op hoofdlijnen, geen technische documentatie. " +
        "Wil je het naadje van de kous weten? Onderaan staat een " +
        "mailknop."
    }
  ]
};
