/* gebruik-onderzoek.js — detailpagina. Eerlijk: aanpassen kan tot een
   vooraf met de onderzoeker afgesproken moment, daarna ligt het vast. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Meedoen aan onderzoek en interviews",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Meedoen aan onderzoek en interviews",
      lead:
        "Wat je in een interview zegt verdwijnt nu in een transcript dat " +
        "je daarna niet meer in de hand hebt. Hier zie en bevestig je " +
        "wat de onderzoeker krijgt, en kun je het aanpassen tot een " +
        "moment dat je vooraf met de onderzoeker afspreekt — daarna ligt " +
        "het vast, zodat het onderzoek klopt."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "in tekst of spraak meedoen, gestructureerd of als open " +
        "dagboek;",
        "na een bijdrage even afkoelen en daarna nalezen wat de " +
        "onderzoeker zou zien;",
        "context toevoegen of iets aanpassen tot een vooraf afgesproken " +
        "moment;",
        "wat er ná dat moment met je bijdrage kan, spreek je vooraf met " +
        "de onderzoeker af — en dat staat dan vast;",
        "achteraf is aantoonbaar dat alles wat gebruikt is, door jou is " +
        "goedgekeurd."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "bot", text: "Je vertelde net over je ervaring met de " +
          "wachtlijst. Dit is wat de onderzoeker zou zien — wil je iets " +
          "weghalen of toevoegen?" },
        { who: "jij", text: "haal die laatste zin eruit, die was te " +
          "stellig" },
        { who: "bot", text: "Verwijderd. Aanpassen kan tot de afgesproken " +
          "datum; wat er daarna met je bijdrage gebeurt, staat in de " +
          "afspraak met de onderzoeker." }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je doet mee",
          body:
            "In tekst of spraak, gestructureerd of als open dagboek. Je " +
            "bijdrage komt in je eigen ruimte."
        },
        {
          title: "Herleidbare details eruit",
          body: "Privé; niemand anders kan meelezen."
        },
        {
          title: "Je leest na en bevestigt",
          body:
            "Je ziet wat de onderzoeker zou zien en past aan tot een " +
            "vooraf afgesproken moment."
        },
        {
          title: "Daarna ligt het vast",
          body:
            "Wat er na dat moment met je bijdrage kan, is vooraf met de " +
            "onderzoeker afgesproken."
        },
        {
          title: "Aantoonbaar goedgekeurd",
          body:
            "Er is een spoor van wie wat wanneer goedkeurde; ethische " +
            "toetsing hoeft daardoor minder aan te nemen."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
