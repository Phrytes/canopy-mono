/* hoe.js — sectie 0b: hoe werkt het, in gewone taal. Bouwt op het
   data-items-model: gegevens staan bij jou, ingangen zijn vensters
   erop. Per sfeer is de toegang anders. Geen architectuur, geen
   jargon — die staan op de techniek-pagina's. */
window.ONDERLING_PAGE = {
  key: "hoe",
  title: "Hoe werkt het",
  blocks: [
    {
      type: "hero",
      heading: "Hoe werkt het — en waarom houd jij de controle",
      lead:
        "De korte versie: jouw gegevens staan op een plek die van " +
        "jou is, niet bij een bedrijf of in een gedeelde database. " +
        "Een chat, een scherm, of een andere ingang laat je erbij " +
        "komen — en bepalen wat je met wie deelt. Hieronder iets " +
        "uitgebreider."
    },

    {
      type: "prose",
      heading: "Gegevens, ingangen, toegang",
      paragraphs: [
        "Het is makkelijker te begrijpen als je het in drie stukken " +
        "uit elkaar haalt. Wat je hebt zijn **gegevens**: lijstjes, " +
        "taken, afspraken, foto's, vragen, aanbod, ervaringen. Die " +
        "staan in een ruimte die van jou is.",
        "Wat je gebruikt om erbij te komen is een **ingang** — een " +
        "chat-assistent, een scherm met lijstjes, een prikbord-weergave. " +
        "Verschillende ingangen kunnen naast elkaar bestaan en komen " +
        "uit op dezelfde gegevens.",
        "Wat regelt wie er bij wat mag is **toegang**. Sommige " +
        "gegevens deel je breed met een groep, andere helemaal niet. " +
        "Soms zit er een tussenpartij die controleert wat de " +
        "ontvanger te zien krijgt; soms is het direct. Welke vorm " +
        "logisch is, hangt af van wat je doet en met wie."
      ]
    },

    {
      type: "prose",
      heading: "Wat altijd zo is",
      paragraphs: [
        "Alles wat je typt of inspreekt komt eerst in jouw ruimte. " +
        "Daar kun jij bij, en verder niemand: geen bedrijf, geen " +
        "beheerder, ook niet degene die de ingang aanbiedt. Zolang " +
        "je niets deelt, blijft het daar staan en kun je het " +
        "weghalen wanneer je wilt.",
        "Wil je iets met de groep delen, dan gebeurt dat omdat jíj " +
        "het doet, en je kunt het daarna nog terugnemen. Die stap " +
        "waarin jij beslist, zit er altijd tussen. Wát er daarna " +
        "gebeurt verschilt per situatie — en juist daar zit het " +
        "onderscheid tussen een boodschappenlijstje en een gevoelig " +
        "onderwerp."
      ]
    },

    {
      type: "prose",
      heading: "Thuis: rechtstreeks, en klaar",
      paragraphs: [
        "In een huishouden of woongroep is de toegang ruim en " +
        "wederzijds. Je laat iets weten, en wat op de gedeelde lijst " +
        "hoort gaat naar de gedeelde lijst — de anderen zien precies " +
        "dat, en niets meer. Er is geen tussenstation, en niets wordt " +
        "ergens centraal verzameld. Meer staat op [thuis](thuis.html); " +
        "de techniek erachter op [thuis, technisch gezien]" +
        "(techniek-thuis.html)."
      ]
    },

    {
      type: "prose",
      heading: "In de buurt: jij bepaalt wat zichtbaar is",
      paragraphs: [
        "Tussen buren die elkaar minder goed kennen komt er één ding " +
        "bij: zichtbaarheid. Je hangt een vraag of aanbod op een " +
        "prikbord, en je profiel laat aan de buurt alleen zien wat " +
        "jij wilt; de rest blijft in je eigen ruimte. Een match " +
        "brengt je bij elkaar, daarna regel je het zelf — er zit " +
        "geen platform tussen dat meeleest. Meer staat op " +
        "[buurt](buurt.html); de techniek erachter op " +
        "[buurt, technisch gezien](techniek-buurt.html)."
      ]
    },

    {
      type: "prose",
      heading: "Werk & maatschappij: niet jouw losse zin, maar het beeld",
      paragraphs: [
        "Hier zijn de groepen groter, de onderwerpen gevoeliger, en " +
        "heeft de ontvanger belang bij de uitkomst. Dan is het niet " +
        "de bedoeling dat jouw losse bericht ergens verschijnt, maar " +
        "dat het meetelt in een breder beeld. Daarvoor komt er een " +
        "paar stappen bij:"
      ]
    },

    {
      type: "steps",
      items: [
        {
          title: "In je eigen ruimte",
          body:
            "Je bericht komt eerst bij jou terecht, voor niemand " +
            "anders leesbaar."
        },
        {
          title: "Opgeschoond, als je dat wilt",
          body:
            "Een privé-helper kan namen, scherpe bewoordingen en " +
            "herleidbare details eruit halen. Die draait afgeschermd; " +
            "er kan niemand anders bij, ook geen achterliggend " +
            "bedrijf. Het is optioneel."
        },
        {
          title: "Jij geeft het vrij",
          body:
            "Je ziet eerst wat er — opgeschoond en zonder je naam — " +
            "zou meegaan, en past het aan of trekt het terug. Pas " +
            "als jij akkoord bent, gaat het verder."
        },
        {
          title: "Anoniem samengebracht",
          body:
            "Goedgekeurde bijdragen komen samen in een afgeschermde " +
            "verzamelruimte waar niemand rechtstreeks in kan kijken, " +
            "en worden daar samengevat."
        },
        {
          title: "Pas zichtbaar als meer mensen het zeggen",
          body:
            "Iets verschijnt niet zolang het van één of een handvol " +
            "mensen komt. Het wordt pas zichtbaar als genoeg mensen, " +
            "onafhankelijk van elkaar, in dezelfde richting wijzen. " +
            "Daaronder ziet niemand het ooit."
        },
        {
          title: "Naar de ontvanger, via een onafhankelijke partij",
          body:
            "Het samengevatte beeld gaat naar wie erom vroeg. Degene " +
            "waar het over gaat beheert dit niet zelf; een " +
            "onafhankelijke partij doet de eindcontrole."
        }
      ],
      after:
        "Zo is het niet jouw losse zin die rondgaat, maar wat veel " +
        "mensen samen aangeven. Meer staat op [werk & " +
        "maatschappij](werk.html); hoe de keten technisch in elkaar " +
        "zit op [werk en maatschappij, technisch gezien]" +
        "(techniek-werk.html)."
    },

    {
      type: "note",
      variant: "info",
      text:
        "Geldt overal: er gebeurt niets automatisch buiten jou om, " +
        "er wordt niet uit zichzelf contact met anderen opgenomen, " +
        "en de assistent is geen hulpverlener."
    }
  ]
};
