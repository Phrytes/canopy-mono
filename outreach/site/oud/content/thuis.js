/* thuis.js — sectie 1: Thuis & privé. Het doorlopende, concrete
   voorbeeld (de spil). Verhalend proza + chat-voorbeeld + lijst-mockup.
   Voorbeelden krijgen automatisch de "voorbeeld"-disclaimer. */
window.ONDERLING_PAGE = {
  key: "thuis",
  title: "Thuis & privé",
  blocks: [
    {
      type: "hero",
      heading: "Thuis: samen het huishouden regelen",
      lead:
        "Dit is het meest concrete geval, en het draait al: een " +
        "huishouden dat boodschappen, klusjes en afspraken bijhoudt."
    },

    {
      type: "prose",
      paragraphs: [
        "Stel: drie huisgenoten. Vroeger ging alles via de groepsapp, " +
        "met het bekende resultaat dat de boodschappen tussen de memes " +
        "verdwenen en niemand meer wist wie er zou koken. Nu loopt er een " +
        "assistent naast die groepsapp. Je laat iets weten zoals je dat " +
        "altijd al deed, in gewone taal, en het komt op een gedeelde " +
        "lijst die voor iedereen klopt. Geen formulier, geen apart " +
        "systeem dat je moet leren — je zegt het, en het staat er."
      ]
    },

    {
      type: "dialog",
      heading: "Zo gaat dat in een chat",
      turns: [
        { who: "jij", text: "we zijn bijna door de koffie heen" },
        { who: "bot", text: "Op de boodschappenlijst gezet. Filters " +
          "raken ook bijna op — meenemen?" },
        { who: "jij", text: "ja doe maar" },
        { who: "jij", text: "wie was er aan de beurt voor de wasruimte?" },
        { who: "bot", text: "Sam deed het het laatst, vorige week. " +
          "Daarvoor jij." }
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Wie liever niet de hele dag chat, opent gewoon het scherm. " +
        "Dezelfde lijst, dezelfde afspraken — alleen aangetikt in plaats " +
        "van getypt. Het is dezelfde onderlaag; de vorm kies je zelf."
      ]
    },

    {
      type: "mockup",
      kind: "lijst",
      heading: "En zo in de app",
      title: "Huishouden",
      groups: [
        {
          heading: "Boodschappen · gedeeld",
          items: [
            { done: false, text: "koffie",  who: "jij" },
            { done: false, text: "filters" },
            { done: true,  text: "melk",    who: "Sam" }
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
      type: "prose",
      heading: "Wat blijft van jou, wat ziet de groep",
      paragraphs: [
        "De huisgenoten zien de gedeelde lijst, en verder niets. Wat jij " +
        "tussendoor aan de assistent vroeg, een herinnering die je voor " +
        "jezelf zette, een bericht dat je toch maar niet deelde — dat " +
        "blijft in jouw ruimte staan, alleen voor jou. Er is geen " +
        "centrale plek waar het allemaal samenkomt; er valt niets te " +
        "verzamelen wat jij niet hebt vrijgegeven.",
        "Ook thuis blijft zo niets achter bij partijen die er niets mee " +
        "te maken hebben. Het is hetzelfde mechanisme dat verderop " +
        "zwaarder weegt — in een [buurt](buurt.html), of op [werk en in " +
        "de maatschappij](werk.html). Wil je weten hoe het onder de " +
        "motorkap zit: [techniek](techniek.html)."
      ]
    }
  ]
};
