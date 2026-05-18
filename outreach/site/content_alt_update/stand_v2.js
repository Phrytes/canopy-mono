/* stand.js — v2 met aangescherpt open-source-FAQ-antwoord en
   verwijzing naar waarborgen waar relevant. */
window.ONDERLING_PAGE = {
  key: "stand",
  title: "Stand van zaken",
  blocks: [
    {
      type: "hero",
      heading: "Stand van zaken & voortgang",
      lead:
        "Wat er nu echt draait, hoe het verder groeit, en wat met " +
        "opzet nog openligt — zonder het mooier voor te stellen dan " +
        "het is."
    },

    {
      type: "prose",
      heading: "Wie hier werkt",
      paragraphs: [
        "Eerlijk vooraf: dit is op dit moment werk van één persoon, " +
        "parttime. Geen team, geen bedrijf om mij heen. De keuze om " +
        "de site al online te zetten is niet om groter te lijken dan " +
        "ik ben, maar om met partijen in gesprek te kunnen over wat " +
        "er bedoeld is — buurtorganisaties, vakbonden, " +
        "patiëntenkoepels, onderzoekers. Wie ik ben en wat ik tot nu " +
        "toe heb gedaan staat op [over ons](over.html)."
      ]
    },

    {
      type: "prose",
      heading: "Hoe het groeit: van binnen naar buiten",
      paragraphs: [
        "Het meeste op deze site beschrijft hoe het bedoeld is. Eén " +
        "deel is verder dan beschrijving: in een huishouden draait " +
        "een werkende versie, dagelijks in gebruik. Dat is geen " +
        "toeval maar de aanpak — eerst dichtbij, waar de inzet laag " +
        "is en je meteen merkt wat schuurt, en pas verder als dat " +
        "echt werkt.",
        "Elke ring leert iets dat de volgende nodig heeft. Een " +
        "huishouden leert hoe de basis aanvoelt in dagelijks gebruik. " +
        "Een grotere groep — bijvoorbeeld een Vereniging van " +
        "Eigenaren — leert hoe het is als niet iedereen elkaar even " +
        "goed kent en als er wat besluitvorming bij komt. Een buurt " +
        "leert hoe het gaat met mensen die je niet kent. Pas daarna " +
        "is het eerlijk om de zwaardere toepassingen in werk en " +
        "maatschappij echt te bouwen."
      ]
    },

    {
      type: "timeline",
      heading: "Waar het staat",
      items: [
        {
          period: "Nu",
          status: "bezig",
          heading: "Een werkende versie in een huishouden",
          body:
            "Boodschappen, klusjes en herinneringen, via een chat en " +
            "een scherm, voor meerdere huisgenoten. In gebruik; de " +
            "aandacht gaat naar stabieler maken en naar wat in de " +
            "praktijk wringt — niet naar nieuwe toeters."
        },
        {
          period: "Komende tijd",
          status: "volgende",
          heading: "Eigen ruimte per persoon, en de bevestig-stap",
          body:
            "Iedere deelnemer een eigen, afgeschermde ruimte, plus " +
            "de stap waarin jij ziet en goedkeurt wat er gedeeld " +
            "wordt. Dat is de bouwsteen die overal daarna terugkomt; " +
            "daarom eerst hier goed krijgen."
        },
        {
          period: "Daarna",
          status: "volgende",
          heading: "Eerst een VvE, dan een buurt",
          body:
            "Een Vereniging van Eigenaren als eerste groep buiten " +
            "een huishouden — bekend genoeg om in mee te denken, " +
            "anders genoeg om iets nieuws van te leren. Daarna een " +
            "eerste buurtproef, samen met een lokale partner, rond " +
            "één concreet thema. Begint pas als het dichtbij echt " +
            "zonder ergernis werkt."
        },
        {
          period: "Op papier, parallel",
          status: "bezig",
          heading: "Werk & maatschappij wordt uitgewerkt",
          body:
            "Meedenken over je werk, ervaringen in de zorg, melden, " +
            "onderzoek, meepraten met de overheid: voor wie, hoe " +
            "het via een tussenpartij kan, wat het juridisch en " +
            "organisatorisch vraagt. In gesprek en op papier, nog " +
            "niet gebouwd."
        },
        {
          period: "Verderop",
          status: "later",
          heading: "Breder bouwen en de dragende organisatie vormen",
          body:
            "De uitgewerkte toepassingen daadwerkelijk bouwen en " +
            "uitproberen, en een organisatievorm kiezen die de " +
            "eisen onder [de waarborgen](waarborgen.html) kan " +
            "dragen. Hangt af van wat de eerdere stappen laten zien."
        }
      ]
    },

    {
      type: "prose",
      heading: "Waar het op staat of valt",
      paragraphs: [
        "Het grootste risico zit niet in de techniek maar in de " +
        "mensen eromheen: het vinden van de juiste partners — een " +
        "buurt of dorp dat iets wil proberen, een passende organisatie " +
        "die een doelgroep echt kent. Eén goede partner kan veel in " +
        "beweging zetten; daarom worden de binnenste ringen eerst " +
        "afgemaakt, zodat die partner zorgvuldig gekozen kan worden " +
        "in plaats van uit nood."
      ]
    },

    {
      type: "prose",
      heading: "Wat bewust nog niet vastligt",
      paragraphs: [
        "Een paar dingen blijven met opzet open, om geen " +
        "schijnzekerheid te wekken:"
      ],
      list: [
        "welke toepassing buiten het huishouden als eerste echt " +
        "groeit;",
        "of het zwaartepunt bij de buurt-kant ligt of bij werk & " +
        "maatschappij;",
        "hoe verificatie en wie-mag-meedoen in de praktijk geregeld " +
        "wordt (technisch bedacht, praktisch nog niet rond);",
        "welke vorm de dragende organisatie precies krijgt — alleen " +
        "de eisen waaraan ze moet voldoen liggen vast."
      ]
    },

    {
      type: "faq",
      heading: "Algemene vragen",
      items: [
        {
          q: "Kan ik het nu al gebruiken?",
          a: "Een werkende versie draait in een huishouden. De rest " +
             "is plan of in uitwerking. Voor een specifieke ring " +
             "(thuis, buurt, werk & maatschappij) staat onderaan " +
             "die pagina iets meer over wat er per situatie al kan."
        },
        {
          q: "Wat gebeurt er met mijn gegevens als dit project ophoudt?",
          a: "Dat is in de opzet voorzien. Jouw gegevens staan in " +
             "een eigen ruimte die niet aan dit project " +
             "vastgekoppeld is — Solid is een open standaard. " +
             "Stopt deze versie, dan blijft je ruimte staan en kun " +
             "je hem bij een andere aanbieder onderbrengen, of zelf " +
             "draaien. En omdat de code open is, kan iemand anders " +
             "verder bouwen op dezelfde basis. Dat is geen losse " +
             "belofte; het is hoe het in elkaar zit."
        },
        {
          q: "Is dit open source?",
          a: "Ja, en dat is geen detail maar een fundament. De code " +
             "is publiek beschikbaar en blijft dat — wie wil kan " +
             "zelf nagaan dat het werkt zoals op deze site staat. " +
             "De standaarden waarop het rust (zoals Solid) zijn " +
             "open. Een deel van het werk wordt ondersteund door " +
             "fondsen die expliciet eisen dat resultaten publiek " +
             "blijven, zoals NLnet. Waarom open code in dit verhaal " +
             "essentieel is, staat onder [de waarborgen]" +
             "(waarborgen.html). Voor de concrete repositories: kom " +
             "over een tijdje terug, die staan nu nog niet publiek."
        },
        {
          q: "Hoe wordt dit gefinancierd?",
          a: "Op dit moment uit eigen middelen en een eerste " +
             "Europese fondsbijdrage voor het protocol-werk. Voor " +
             "concrete toepassingen wordt gekeken naar lokale " +
             "fondsen via een buurt- of dorpspartner; voor de " +
             "zwaardere toepassingen naar samenwerking met " +
             "vakbonden, koepels en sectorraden. Geen advertenties, " +
             "geen verkoop van gegevens — dat staat de architectuur " +
             "ook niet toe."
        }
      ]
    },

    {
      type: "note",
      variant: "plan",
      text:
        "Geen harde toezeggingen: volgorde en tempo kunnen schuiven. " +
        "Wat hier als plan staat, staat er als plan — niet als " +
        "belofte."
    }
  ]
};
