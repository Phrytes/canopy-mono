/* gebruik-infrastructuur.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Een eigen versie op dezelfde basis",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "verkenning",
      heading: "Een eigen versie op dezelfde basis",
      lead:
        "Niet elke organisatie hoeft dit opnieuw te bouwen. Een vakbond, " +
        "een koepel of een meldpunt kan een eigen versie aanbieden — " +
        "eigen naam, eigen voorkant — op dezelfde onderlaag, met de " +
        "privacy-eigenschappen die meekomen en zonder centrale database."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "een eigen toepassing bouwen op de bestaande onderlaag, met je " +
        "eigen naam en vormgeving;",
        "de eigenschappen komen mee: eigen opslag, zelf bevestigen, een " +
        "drempel voordat iets een patroon wordt;",
        "geen toegang tot de gegevens van andere partijen die dezelfde " +
        "onderlaag gebruiken;",
        "de onafhankelijke verwerking kan je zelf doen of uitbesteden;",
        "de onderlaag is open, zodat je er niet aan één leverancier " +
        "vastzit."
      ]
    },

    {
      type: "prose",
      heading: "Voor wie dit is",
      paragraphs: [
        "Voor partijen die nu een centrale database hebben en daar " +
        "vanaf willen, of die een doelgroep in een kwetsbare positie " +
        "bedienen: een vakbond in een ander land, een meldplatform, een " +
        "onderzoeksgroep, een koepelorganisatie.",
        "Dit is geen los eindproduct maar de gedeelde basis onder de " +
        "andere toepassingen op deze site."
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Eigen voorkant",
          body:
            "Je bouwt je eigen scherm en naam erbovenop; de jouw-gebruikers " +
            "zien jouw merk."
        },
        {
          title: "Dezelfde basis eronder",
          body:
            "Eigen ruimte per gebruiker, zelf bevestigen, een drempel — " +
            "die eigenschappen komen mee."
        },
        {
          title: "Gescheiden",
          body:
            "Geen toegang tot de gegevens van andere partijen die " +
            "dezelfde basis gebruiken."
        },
        {
          title: "Verwerking naar keuze",
          body:
            "De onafhankelijke verwerking doe je zelf of besteed je uit; " +
            "de basis is open, dus geen vendor-lock-in."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
