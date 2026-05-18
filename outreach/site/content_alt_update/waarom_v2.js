/* waarom.js — 0a: waarom dit project. v2 met open source als
   onderdeel van het uitgangspunt en verwijzing naar waarborgen.
   key:"home" zodat de nav "Wat & waarom" actief blijft. */
window.ONDERLING_PAGE = {
  key: "home",
  title: "Waarom dit project",
  blocks: [
    { type: "backlink", href: "index.html", label: "Wat & waarom" },

    {
      type: "hero",
      heading: "Waarom dit project bestaat",
      lead:
        "Niet uit afkeer van techniek, maar uit de simpele gedachte " +
        "dat je een gedeeld hulpmiddel zou moeten kunnen gebruiken " +
        "zonder je woorden af te staan."
    },

    {
      type: "prose",
      paragraphs: [
        "Bijna elk gereedschap waarmee een groep iets regelt, vraagt " +
        "tegenwoordig hetzelfde van je: je gegevens komen op een " +
        "centrale plek te staan en je vertrouwt erop dat het wel " +
        "goed zit. Meestal denk je er niet over na. Maar zodra het " +
        "ergens om spant — een klacht, een mening die niet iedereen " +
        "hoeft te horen, iets kwetsbaars — merk je hoe ongemakkelijk " +
        "dat eigenlijk is. Dan zeggen mensen liever niets, en gaat " +
        "juist de informatie verloren die ertoe doet.",
        "Het kan anders, en de techniek om het anders te doen " +
        "bestaat al. Solid pods, decentrale verbindingen, " +
        "afgeschermde slimme hulp: stuk voor stuk geen nieuwigheid " +
        "uit een lab. Wat zelden gebeurt is ze samenbrengen tot iets " +
        "dat in echte situaties bruikbaar is, niet als demonstratie " +
        "maar als iets dat mensen dagelijks gebruiken. Dit project " +
        "probeert dat."
      ]
    },

    {
      type: "prose",
      heading: "Waar het op rust",
      paragraphs: [
        "Twee uitgangspunten lopen overal doorheen. Het eerste is " +
        "dat wat je inbrengt staat in een ruimte die van jou is, " +
        "niet in één grote verzamelbak. Een chat-assistent, een " +
        "scherm met lijstjes, een prikbord-weergave: dat zijn " +
        "ingangen tot dezelfde gegevens, niet de plek waar ze " +
        "wonen. Dat verandert wat er fundamenteel kan gebeuren " +
        "met wat je zegt — er valt geen centrale bak te lekken, " +
        "want die bestaat niet.",
        "Het tweede is dat voordat er iets gedeeld of samengevat " +
        "wordt, jij degene bent die het nog kan bijstellen of " +
        "terugtrekken. Waar het over een grotere groep gaat, zit " +
        "niet de partij waar het over gaat aan de knoppen, maar " +
        "wordt het beheer ergens anders ondergebracht. En je " +
        "gebruikt het zoals het je uitkomt — slimme hulp mag, maar " +
        "hoeft niet."
      ]
    },

    {
      type: "prose",
      heading: "Open, controleerbaar, niet aan één partij gebonden",
      paragraphs: [
        "Een belangrijke voorwaarde voor dat dit alles geloofwaardig " +
        "kan zijn: de code is open en de standaarden waarop het rust " +
        "zijn open. Zonder dat zou je voor elke belofte op deze site " +
        "moeten geloven dat we het wel goed doen. Met open code kan " +
        "iedereen die wil zelf nagaan of het werkt zoals beschreven; " +
        "en als deze versie ooit stopt, kan iemand anders verder met " +
        "dezelfde basis zonder dat de mensen die het gebruikten " +
        "opnieuw beginnen.",
        "Hoe het verder structureel overeind wordt gehouden — " +
        "architectonisch, in hoe slimme hulp wordt ingezet, in welke " +
        "eisen aan een dragende organisatie worden gesteld — staat " +
        "onder [de waarborgen](waarborgen.html)."
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Het is bewust een langlopend ontwerp. Het begint klein en " +
        "concreet, dichtbij huis, en groeit pas verder als dat " +
        "werkt. Wat er nog niet is, staat er niet als belofte maar " +
        "als plan."
      ]
    }
  ]
};
