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
      type: "prose",
      heading: "Hoe het ongeveer werkt",
      paragraphs: [
        "Elke huisgenoot heeft een eigen opslagruimte, plus één gedeelde " +
        "voor het huishouden. De assistent stelt iets voor, jij " +
        "bevestigt of past aan voordat het op een gedeelde lijst komt. " +
        "De slimme tekstverwerking erachter draait privé op je eigen " +
        "apparaat, en gebruiken hoeft niet.",
        "Meer hierover: [hoe het werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
