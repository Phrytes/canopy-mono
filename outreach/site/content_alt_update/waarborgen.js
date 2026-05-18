/* waarborgen.js — vervanger van onafhankelijkheid.js. Vier niveaus
   waarop dit overeind moet blijven: architectuur, slimme hulp,
   organisatie-eisen, en open source als kruisende laag. Geen
   invulling van vormen die nog niet bestaan; wel scherpe eisen.
   key:"home" zodat de nav-state ergens redelijks landt; staat ook
   in footer-nav. */
window.ONDERLING_PAGE = {
  key: "home",
  title: "De waarborgen",
  blocks: [
    { type: "backlink", href: "index.html", label: "Wat & waarom" },

    {
      type: "hero",
      heading: "Wat het overeind houdt",
      lead:
        "De rest van de site beschrijft wat Onderling bedoelt te " +
        "doen — gegevens bij jou laten, je laten beslissen wat je " +
        "deelt, een tussenpartij gebruiken bij zware onderwerpen. " +
        "Deze pagina gaat over de andere vraag: waarom zou je geloven " +
        "dat dat zo blijft? Hieronder de vier dingen die dat moeten " +
        "afdwingen — niet als belofte, maar als structuur."
    },

    {
      type: "prose",
      heading: "Architectuur: er valt geen centrale bak te lekken",
      paragraphs: [
        "Het eerste niveau is technisch. Dat je gegevens bij jou " +
        "staan en niet bij ons is geen instelling die we voor je " +
        "hebben aangezet — het volgt uit hoe het in elkaar zit. " +
        "Jouw bijdragen wonen in een ruimte die door jou wordt " +
        "beheerd, op een aanbieder van jouw keuze (of op een toestel " +
        "thuis). Wij hebben er geen toegang toe. We kunnen niet " +
        "stilletjes meekijken, niet \"per ongeluk\" een log bijhouden, " +
        "niet onder druk van een derde alsnog inhoud overdragen — " +
        "want wat er niet bij ons staat, kunnen we niet geven.",
        "Voor de zware toepassingen (werk en maatschappij) komt daar " +
        "een verzamelruimte bij waar goedgekeurde, geanonimiseerde " +
        "bijdragen samenkomen. Ook daar geldt: niemand heeft " +
        "rechtstreekse toegang, ook degene die de ronde uitzette " +
        "niet, ook de partij die de eindcontrole doet niet. Wat zij " +
        "ziet is een samenvoeging die boven een drempel uitkwam, " +
        "niet de onderliggende stemmen. De drempel zelf is geen " +
        "afspraak maar een filter dat zit ingebouwd in hoe de " +
        "verzamelruimte werkt."
      ]
    },

    {
      type: "prose",
      heading: "Slimme hulp: afgeschermd en optioneel",
      paragraphs: [
        "Het tweede niveau gaat over taalmodellen — slimme hulp die " +
        "begrijpt wat je zegt, helpt bij opschonen, of een " +
        "samenvatting voorbereidt. Dat is nuttig, en tegelijk een " +
        "plek waar veel mis kan gaan: een taalmodel dat naar een " +
        "groot bedrijf belt om elke zin verzonden krijgt, ondergraaft " +
        "de hele architectuur in één klap.",
        "Daarom een paar harde principes voor hoe slimme hulp wordt " +
        "ingezet:"
      ],
      list: [
        "**Afgeschermd draaien.** Lokaal op je eigen toestel, of in " +
        "een omgeving waar niemand anders meeleest — ook het bedrijf " +
        "dat het model maakt niet. Als dat voor een bepaald model " +
        "niet kan, wordt dat model niet gebruikt op een plek waar " +
        "gevoelige inhoud doorheen gaat.",
        "**Optioneel, niet vereist.** Een huishouden of buurt moet " +
        "ook werken zonder taalmodel — met een gewoon scherm en " +
        "knoppen. Slimme hulp is een aanvulling, geen voorwaarde.",
        "**Geen automatische escalatie.** De assistent neemt niet " +
        "uit zichzelf contact op met derden, geeft niets door buiten " +
        "wat jij vrijgeeft, en is geen hulpverlener. Wat ze in jouw " +
        "ruimte ziet, blijft daar.",
        "**Geen training op jouw data.** Wat door slimme hulp wordt " +
        "verwerkt mag niet gebruikt worden om modellen te trainen of " +
        "te verbeteren, ook niet \"geanonimiseerd\". De gebruiker is " +
        "geen leverancier."
      ]
    },

    {
      type: "prose",
      heading: "Organisatie: randvoorwaarden, geen invulling",
      paragraphs: [
        "Het derde niveau is bestuurlijk. Techniek die je gegevens " +
        "bij je laat is maar de helft; de organisatie die het draagt " +
        "mag geen reden hebben om er alsnog iets mee te willen. " +
        "Welke vorm die organisatie precies krijgt — stichting, " +
        "coöperatie, iets anders — staat nog open. Wel duidelijk is " +
        "aan welke eisen ze moet voldoen om geloofwaardig te zijn:"
      ],
      list: [
        "**Geen prikkel om gegevens te benutten.** Geen advertenties, " +
        "geen verkoop van inzichten, geen verdienmodel waarin " +
        "gebruikersgegevens een rol spelen. De financiering komt uit " +
        "publieke fondsen, lidmaatschap, of opdrachten van partijen " +
        "die expliciet voor de dienst betalen — niet voor toegang tot " +
        "wat er doorheen loopt.",
        "**Geen stille toegang voor wie meebetaalt.** Een werkgever, " +
        "instelling of gemeente die een ronde uitzet, koopt een " +
        "dienst — geen kijkje. Dat moet ook bestuurlijk niet kunnen " +
        "veranderen, zelfs als die partij invloed heeft.",
        "**Onafhankelijk toezicht.** Iemand van buiten moet kunnen " +
        "controleren of de organisatie zich aan haar eigen regels " +
        "houdt, en moet de bevoegdheid hebben om in te grijpen. Niet " +
        "een adviesraad zonder tanden; toezicht met sancties.",
        "**Openbaar verantwoorden.** Wat er met bijdragen gebeurt — " +
        "hoeveel verwerkt, hoeveel onder de drempel weggegooid, " +
        "hoeveel klachten, hoeveel verwijderverzoeken — moet " +
        "publiekelijk te zien zijn. Geen marketingrapport; cijfers " +
        "en uitleg.",
        "**Klachtenroute met escalatie.** Wie vindt dat z'n bijdrage " +
        "verkeerd is samengevat, of dat de organisatie zelf in de " +
        "fout ging, moet ergens terechtkunnen — en niet bij dezelfde " +
        "mensen waarover de klacht gaat.",
        "**Overdraagbaarheid.** Stopt de organisatie ermee, of gaat " +
        "ze de verkeerde kant op, dan moet wat ze deed " +
        "overdraagbaar zijn aan een ander. Geen vendor lock-in via " +
        "de achterdeur. Hier helpt het volgende punt."
      ]
    },

    {
      type: "prose",
      heading: "Controleerbaar door iedereen: open source",
      paragraphs: [
        "Het vierde niveau loopt door alle drie de andere heen. Alles " +
        "wat hierboven staat gaat ervan uit dat de techniek doet wat " +
        "hier beschreven staat. Dat is geen kwestie van vertrouwen — " +
        "de code is open, en zo gaat het blijven. Wie wil kan zelf " +
        "nagaan dat het werkt zoals beloofd. Een aanbieder die ooit " +
        "deze stack overneemt of voortzet, kan dat niet stilletjes " +
        "anders doen: een afwijking is zichtbaar voor wie het wil " +
        "zien.",
        "Het hangt samen met de open standaarden (zoals Solid) " +
        "waarop dit rust. Stopt deze versie, dan kan iemand anders " +
        "verder met dezelfde basis; jouw ruimte kun je meenemen naar " +
        "een andere aanbieder. Het project is bedoeld om weg te " +
        "kunnen vallen zonder de mensen die het gebruiken in de " +
        "steek te laten."
      ]
    },

    {
      type: "prose",
      heading: "Waarom dit samen telt",
      paragraphs: [
        "Geen van de vier niveaus is op zichzelf genoeg. Open code " +
        "zonder een organisatie die ernaar handelt, is alleen een " +
        "controleerbare belofte. Een nette organisatie zonder " +
        "passende architectuur is alleen vertrouwen. Architectuur " +
        "zonder principes voor slimme hulp werkt totdat het eerste " +
        "model alles wegstuurt. Toezicht zonder open code kan niet " +
        "controleren of het echt zo werkt als gezegd.",
        "Samen vormen ze iets dat moeilijk uit te hollen is — niet " +
        "omdat één partij belooft het goed te doen, maar omdat er " +
        "vier verschillende plekken zijn waar een afwijking " +
        "zichtbaar of onmogelijk wordt. Dat is wat de site bedoelt " +
        "met \"onafhankelijk\". Niet dat één partij neutraal is, " +
        "maar dat het geheel zo is gebouwd dat de verleiding tot " +
        "afwijken structureel wordt afgeknepen."
      ]
    },

    {
      type: "note",
      variant: "plan",
      text:
        "De architectuur en de open code zijn er; de slimme-hulp-" +
        "principes worden in elke pilot toegepast; de organisatorische " +
        "kant is nog plan. Welke vorm die organisatie precies krijgt " +
        "is een keuze die volgt, niet vooraf. Zie [stand van zaken]" +
        "(stand-van-zaken.html) voor wat al loopt."
    }
  ]
};
