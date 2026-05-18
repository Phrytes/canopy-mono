/* werk.js — sectie 3: Werk & maatschappij. v2 met verwijzing naar
   waarborgen i.p.v. onafhankelijkheid en kleine taal-aanpassingen
   rond de tussenpartij. */
window.ONDERLING_PAGE = {
  key: "werk",
  title: "Werk & maatschappij",
  blocks: [
    {
      type: "hero",
      heading: "Werk & maatschappij: meepraten zonder je bloot te geven",
      lead:
        "Sommige dingen zeg je niet eerlijk als degene die erover " +
        "gaat ook degene is die meeleest. Je werkgever, de gemeente, " +
        "de instelling — zodra zij de afzender kennen, vertel je de " +
        "veilige versie. Hier zit een tussenpartij tussen, en dat " +
        "verandert wat je durft te zeggen."
    },

    {
      type: "prose",
      paragraphs: [
        "Wat deze toepassingen bindt is niet hoe het werkt onder de " +
        "motorkap — dezelfde basis als thuis en in de buurt — maar " +
        "de omstandigheden eromheen. Het gaat om grotere groepen, " +
        "gevoeliger onderwerpen, en een ontvanger die belang heeft " +
        "bij de uitkomst. Daarom werkt rechtstreeks delen hier niet, " +
        "en gaat het anders: jouw bericht telt niet op zichzelf, het " +
        "telt mee in wat veel mensen, los van elkaar, aangeven. En " +
        "jij blijft degene die bepaalt of het meetelt."
      ]
    },

    {
      type: "prose",
      heading: "Een voorbeeld: meepraten over het plein",
      paragraphs: [
        "Stel, de gemeente wil het pleintje bij jou in de wijk anders " +
        "inrichten. De vertrouwde route is een inspraakavond, waar de " +
        "drie felste meningen het gesprek bepalen en de meeste mensen " +
        "niet komen opdagen. De stille meerderheid heeft wel een " +
        "mening, maar geen zin in een zaaltje, of geen tijd, of geen " +
        "behoefte om het hardop tegen de buren te zeggen.",
        "Je krijgt een uitnodiging om mee te denken — per brief, of " +
        "een poster in de straat. Je reageert wanneer het jou " +
        "uitkomt, in een paar zinnen, in je eigen woorden:"
      ]
    },

    {
      type: "dialog",
      turns: [
        { who: "jij", text: "ik ben voor meer groen, maar maak me " +
          "zorgen over parkeerplek voor m'n moeder die slecht ter " +
          "been is" },
        { who: "bot", text: "Genoteerd in je eigen ruimte. Wil je " +
          "dit meegeven aan de gemeente — zonder dat eruit blijkt " +
          "dat jij het zei?" },
        { who: "jij", text: "ja, maar haal die zin over m'n moeder " +
          "algemener" },
        { who: "bot", text: "Aangepast naar \"zorg om parkeerplek " +
          "voor minder mobiele bewoners\". Je ziet straks het hele " +
          "stuk voordat er iets meegaat." }
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Wat de gemeente terugkrijgt is niet jouw zin, en al helemaal " +
        "niet jouw naam. Het is het beeld dat ontstaat als honderden " +
        "mensen onafhankelijk van elkaar iets hebben ingebracht: niet " +
        "\"iemand wil parkeerplek\", maar \"meer groen wordt breed " +
        "gedragen, mits de parkeerdruk voor minder mobiele bewoners " +
        "wordt opgevangen\". Een nuance die op een inspraakavond " +
        "zelden de zaal haalt, en die nu wél meetelt — zonder dat " +
        "iemand zich bloot hoefde te geven.",
        "En het is geen eenrichtingsverkeer. De gemeente reageert op " +
        "het beeld, niet op personen, en via dezelfde weg zie je " +
        "terug wat er met de inbreng is gedaan. Per onderwerp gaat " +
        "het aan en weer uit; er blijft geen permanent platform " +
        "staan dat onderhouden en gevoed moet worden."
      ]
    },

    {
      type: "prose",
      heading: "Waarom een tussenpartij?",
      paragraphs: [
        "Als de gemeente dit zelf zou beheren, ben je terug bij af: " +
        "dan weet de ontvanger weer wie wat zei, of kan dat in elk " +
        "geval. Daarom zit er een tussenpartij tussen die de " +
        "verwerking doet en die niet aan de gemeente verantwoording " +
        "schuldig is voor de inhoud. Hoe die rol bedoeld is te " +
        "werken en welke eisen daaraan moeten worden gesteld — staat " +
        "onder [de waarborgen](waarborgen.html). De werking stap voor " +
        "stap staat op [hoe werkt het](hoe-het-werkt.html); hoe de " +
        "keten technisch in elkaar zit op [werk en maatschappij, " +
        "technisch gezien](techniek-werk.html)."
      ]
    },

    {
      type: "cards",
      heading: "Dezelfde basis, andere situaties",
      intro:
        "Het plein is één geval. Op dezelfde basis liggen er meer, " +
        "elk met een eigen tussenpartij die niet door de afnemer wordt " +
        "aangestuurd:",
      items: [
        { title: "Meedenken over je werk",
          body: "Via de ondernemingsraad, niet via HR.",
          href: "werk-meedenken.html" },
        { title: "Ervaringen delen in de zorg",
          body: "Naar een onafhankelijke patiëntenorganisatie.",
          href: "werk-zorg.html" },
        { title: "Misstanden veilig melden",
          body: "Een meldweg die niet van de werkgever is.",
          href: "werk-melden.html" },
        { title: "Meedoen aan onderzoek",
          body: "Eindredacteur blijven, ook achteraf.",
          href: "werk-onderzoek.html" },
        { title: "Meepraten met de overheid",
          body: "Zoals het plein hierboven, breder.",
          href: "werk-overheid.html" },
        { title: "Een eigen versie op dezelfde basis",
          body: "Voor organisaties die dit zelf willen aanbieden.",
          href: "werk-eigen-versie.html" }
      ]
    },

    {
      type: "faq",
      heading: "Vragen",
      items: [
        {
          q: "Hoe voorkom je dat één iemand een anonieme ophaling vertekent?",
          a: "Twee dingen. Eén: jouw inbreng wordt in één keer " +
             "samengevat en als geheel meegeteld, niet als losse " +
             "berichten. Stel je voor dat iemand dezelfde klacht " +
             "tien keer indient — dat telt als één stem, niet als " +
             "tien. Twee: iets verschijnt pas in de uitkomst als " +
             "genoeg verschillende mensen er onafhankelijk aan " +
             "bijdragen. En daar bovenop doet de tussenpartij de " +
             "eindcontrole."
        },
        {
          q: "Wat als ik iets ernstigs te melden heb en niemand anders zegt het?",
          a: "Voor zware kwesties — intimidatie, een veiligheids- of " +
             "integriteitskwestie — werkt de drempel niet logisch: " +
             "één melding kan al genoeg zijn om in actie te komen. " +
             "Die loopt daarom langs een aparte weg, met jouw " +
             "uitdrukkelijke toestemming, naar een vooraf afgesproken " +
             "bestemming (een vertrouwenspersoon, een meldpunt). " +
             "Zonder drempel, wel zorgvuldige afhandeling."
        },
        {
          q: "Hoe weet de gemeente of organisatie wie er echt is of mag meedoen?",
          a: "Daar is een idee voor — verificatie en groeps-" +
             "acceptatie — maar de praktische kant (hoe deel je " +
             "toegang uit aan bijvoorbeeld werknemers of bewoners " +
             "van een wijk?) is nog niet rond. Eerlijk: dat is een " +
             "open vraag, geen afgevinkt vakje. Per situatie zal er " +
             "een passende afspraak gemaakt moeten worden."
        },
        {
          q: "Komt mijn bericht ergens definitief vast te liggen?",
          a: "De ruwe versie staat in jouw ruimte zolang jij dat " +
             "wilt — en zo lang het meetelt voor een lopende ronde. " +
             "Wat boven de drempel komt en in het samengestelde beeld " +
             "wordt opgenomen, krijgt wél een vaste vorm: anders kan " +
             "de ontvanger er niet op terugkoppelen, en kan een " +
             "rapport niet jaren later worden gecheckt. Wat per " +
             "situatie precies kan en niet kan, wordt vooraf " +
             "afgesproken — en de afspraak ken je voordat je " +
             "meedoet."
        }
      ]
    }
  ]
};
