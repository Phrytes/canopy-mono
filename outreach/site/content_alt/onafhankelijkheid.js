/* onafhankelijkheid.js — 0c: het plan om onafhankelijk te blijven.
   Eerlijk als intentie, niet als bestaand feit. Nu met expliciete
   passage over wat de onafhankelijke partij wel en niet ziet.
   key:"home" zodat nav-state ergens redelijks landt; staat ook in
   footer-nav. */
window.ONDERLING_PAGE = {
  key: "home",
  title: "Onafhankelijk blijven",
  blocks: [
    { type: "backlink", href: "index.html", label: "Wat & waarom" },

    {
      type: "hero",
      heading: "Hoe het onafhankelijk hoort te blijven",
      lead:
        "Techniek die je gegevens bij je laat, is maar de helft. De " +
        "andere helft is dat de organisatie eromheen geen reden en " +
        "geen mogelijkheid heeft om daar alsnog misbruik van te " +
        "maken. Zo is dat bedoeld — dit deel is nog plan, geen " +
        "bestaande structuur."
    },

    {
      type: "prose",
      paragraphs: [
        "Een gewoon bedrijf met winstoogmerk is hier het verkeerde " +
        "signaal: dan zit er altijd een prikkel om tóch iets met de " +
        "data te doen. Daarom is het idee dit onder te brengen in " +
        "een onafhankelijke vorm — een stichting of coöperatie — " +
        "waarvan de opzet zelf de onafhankelijkheid afdwingt, en " +
        "niet de goede bedoelingen van wie er toevallig werkt.",
        "Concreet hoort daar het volgende bij:"
      ],
      list: [
        "een externe raad van toezicht met op z'n minst een privacy-" +
        "jurist, iemand namens de doelgroep, en een ethicus of " +
        "wetenschapper uit het veld;",
        "een jaarlijks openbaar verslag: hoeveel berichten verwerkt, " +
        "hoeveel onder de drempel weggegooid, hoeveel verwijder-" +
        "verzoeken en klachten;",
        "een klachtenregeling voor wie vindt dat z'n inbreng " +
        "verkeerd is samengevat, met de mogelijkheid om naar de " +
        "raad van toezicht te escaleren;",
        "geen aparte, stille toegang voor de partij waar het over " +
        "gaat — ook niet als die meebetaalt."
      ]
    },

    {
      type: "prose",
      heading: "Wat deze partij wél en niet kan zien",
      paragraphs: [
        "Belangrijk om expliciet te maken: ook de onafhankelijke " +
        "partij die de eindcontrole doet, heeft geen toegang tot " +
        "ruwe bijdragen of tot wie ze heeft ingebracht. Wat zij ziet " +
        "is de samenvoeging die boven de drempel uitkwam, plus de " +
        "mogelijkheid om die te beoordelen, te corrigeren of terug " +
        "te sturen. Het is een redactionele rol, geen toegangsrol.",
        "Zware meldingen lopen langs een aparte weg, met de " +
        "uitdrukkelijke instemming van de melder, naar een vooraf " +
        "afgesproken bestemming (vertrouwenspersoon, meldpunt, " +
        "vertrouwenscommissie). De technische scheiding tussen die " +
        "weg en de samenvoeg-weg is hard: nooit raakt het een het " +
        "ander ongemerkt."
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Dit is bewust extra werk en extra rem. Het verschilt " +
        "daarmee van diensten die wel \"privacy\" beloven maar er " +
        "technisch en bestuurlijk niet op gebouwd zijn. Hoe deze " +
        "structuur er precies uit gaat zien, en wie erin komt, is " +
        "nog niet uitgewerkt — het staat hier als richting, niet als " +
        "gedane zaak."
      ]
    }
  ]
};
