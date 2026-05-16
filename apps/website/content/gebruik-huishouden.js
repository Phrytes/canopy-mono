/* gebruik-huishouden.js — detailpagina. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Een huishouden of woongroep",
  blocks: [
    { type: "backlink", href: "wat-los-je-ermee-op.html",
      label: "Alle toepassingen" },

    {
      type: "hero",
      status: "loopt",
      heading: "Een huishouden of woongroep",
      lead:
        "Boodschappen, klusjes, herinneringen en afspraken bijhouden en " +
        "verdelen — zonder dat het versnippert in honderden berichten, " +
        "en zonder dat het ergens centraal belandt."
    },

    {
      type: "prose",
      heading: "Wat je ermee kunt",
      list: [
        "een boodschap of klus toevoegen met een gewoon bericht;",
        "vragen wat er op de lijst staat of wie aan de beurt is;",
        "een herinnering klaarzetten die op tijd terugkomt;",
        "met meerdere huisgenoten tegelijk, ieder met eigen berichten;",
        "wat jij bijdraagt blijft in je eigen ruimte staan."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe het werkt in gebruik",
      turns: [
        { who: "jij",  text: "we zijn door de koffie heen" },
        { who: "bot",  text: "Op de boodschappenlijst gezet. Ook " +
          "filters erbij? Die waren er vorige keer ook bijna op." },
        { who: "jij",  text: "ja doe maar" },
        { who: "jij",  text: "wie was er aan de beurt voor de wasruimte?" },
        { who: "bot",  text: "Sam deed het het laatst (vorige week). " +
          "Daarvoor jij." }
      ],
      after:
        "Zo gaat het in een chat; het kan ook via een scherm."
    },

    {
      type: "mockup",
      kind: "lijst",
      heading: "En zo op het scherm",
      title: "Huishouden",
      groups: [
        {
          heading: "Boodschappen · gedeeld",
          items: [
            { done: false, text: "melk",    who: "jij" },
            { done: false, text: "filters" },
            { done: true,  text: "koffie",  who: "Sam" }
          ]
        },
        {
          heading: "Klusjes",
          items: [
            { done: false, text: "wasruimte — aan de beurt: jij" },
            { done: true,  text: "vuilnis buiten", who: "Sam" }
          ]
        }
      ]
    },

    {
      type: "steps",
      heading: "Hoe het werkt, stap voor stap",
      items: [
        {
          title: "Je voegt iets toe",
          body:
            "Een berichtje of via een scherm: “melk halen”, " +
            "“klusje voor zaterdag”."
        },
        {
          title: "De assistent zet het op z'n plek",
          body:
            "Op de gedeelde lijst van het huishouden; jij bevestigt of " +
            "past aan als het niet klopt. De slimme hulp is optioneel; " +
            "niemand anders kan je gesprekken meelezen."
        },
        {
          title: "Iedereen ziet de lijst, jij houdt je eigen",
          body:
            "De huisgenoten zien de gedeelde lijst; wat jij inbrengt " +
            "blijft in je eigen ruimte."
        }
      ],
      after:
        "Wat de basis bijzonder maakt: [hoe het " +
        "werkt](hoe-het-werkt.html)."
    }
  ]
};
