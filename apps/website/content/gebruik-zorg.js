/* gebruik-zorg.js — detailpagina. Bewust geen belofte dat de bot zelf
   met een zorgaanbieder of hulpinstantie contact opneemt; delen kan met
   een onafhankelijke patiëntenorganisatie, of je houdt het voor jezelf. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Ervaringen delen in de zorg",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Ervaringen delen in de zorg",
      lead:
        "Een formulier vlak na een nare ervaring werkt voor bijna " +
        "niemand, en wie nog in behandeling is durft z'n naam er niet " +
        "onder te zetten. Hier houd je het op je eigen tempo bij voor " +
        "jezelf, en deel je het — als je wilt — met een onafhankelijke " +
        "patiëntenorganisatie."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "in vrije woorden of spraak vertellen wat je meemaakte;",
        "een symptoom of ervaring over langere tijd voor jezelf " +
        "bijhouden, met geheugen (“vorige week schreef je …”);",
        "herleidbare details worden eraf gehaald — privé, op je eigen " +
        "apparaat — voordat er iets samenkomt;",
        "jij beslist per keer wat er met een onafhankelijke " +
        "patiëntenorganisatie wordt gedeeld, en kunt het later intrekken."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "bot", text: "Hoe ging het deze week met de pijn 's " +
          "nachts? Vorige keer schreef je dat het rond 3 uur erger werd." },
        { who: "jij", text: "nog steeds, en ik maak me zorgen omdat " +
          "niemand er iets mee lijkt te doen" },
        { who: "bot", text: "Genoteerd in je eigen ruimte. Wil je het " +
          "stuk over de nachtpijn meenemen in wat — geanonimiseerd — naar " +
          "de patiëntenorganisatie gaat, zonder de zin over je zorgen?" },
        { who: "jij", text: "ja, alleen dat eerste" }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je vertelt wat je meemaakte",
          body:
            "In tekst of spraak, op je eigen tempo. Het komt in je eigen " +
            "ruimte, die niet vastzit aan één instelling."
        },
        {
          title: "Herleidbare details eruit",
          body: "Privé; niemand anders kan meelezen."
        },
        {
          title: "Jij bevestigt",
          body:
            "Je beslist per keer wat er meegaat, en kunt het later " +
            "intrekken."
        },
        {
          title: "Een drempel",
          body:
            "Voor een breder beeld telt iets pas mee als meer mensen het " +
            "los van elkaar inbrengen."
        },
        {
          title: "Onafhankelijke patiëntenorganisatie",
          body:
            "Die maakt er een overzicht van — niet de zorgaanbieder. De " +
            "assistent is geen hulpverlener en neemt niet uit zichzelf " +
            "contact op met een zorgaanbieder of instantie."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
