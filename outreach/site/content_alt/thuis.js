/* thuis.js — sectie 1: Thuis. Het doorlopende, concrete voorbeeld
   (de spil). Verhalend proza + chat-voorbeeld + lijst-mockup. Nu
   met expliciet data-items-model (lijsten en chat zijn ingangen op
   dezelfde gegevens) en FAQ-blok onderaan voor algemene + thuis-
   specifieke vragen. */
window.ONDERLING_PAGE = {
  key: "thuis",
  title: "Thuis",
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
        "met het bekende resultaat dat de boodschappen tussen de " +
        "memes verdwenen en niemand meer wist wie er zou koken. Nu " +
        "loopt er een assistent naast die groepsapp. Je laat iets " +
        "weten zoals je dat altijd al deed, in gewone taal, en het " +
        "komt op een gedeelde lijst die voor iedereen klopt. Geen " +
        "formulier, geen apart systeem dat je moet leren — je zegt " +
        "het, en het staat er."
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
        "Dezelfde lijst, dezelfde afspraken — alleen aangetikt in " +
        "plaats van getypt. Het is niet zo dat de twee ingangen elkaar " +
        "berichten sturen; ze kijken naar dezelfde plek. Wat de een " +
        "via een berichtje aanvult, ziet de ander op het scherm " +
        "verschijnen."
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
        "De huisgenoten zien de gedeelde lijst, en verder niets. Wat " +
        "jij tussendoor aan de assistent vroeg, een herinnering die " +
        "je voor jezelf zette, een bericht dat je toch maar niet " +
        "deelde — dat blijft in jouw ruimte staan, alleen voor jou. " +
        "De gedeelde lijst en je persoonlijke notities zijn niet twee " +
        "kopieën van iets; het zijn twee soorten gegevens met andere " +
        "toegangsrechten. Wat gedeeld is, is gedeeld; wat van jou " +
        "alleen is, blijft bij jou.",
        "Er is geen centrale plek waar het allemaal samenkomt; er " +
        "valt niets te verzamelen wat jij niet hebt vrijgegeven. Het " +
        "is hetzelfde mechanisme dat verderop zwaarder weegt — in " +
        "een [buurt](buurt.html), of op [werk en in de " +
        "maatschappij](werk.html). Wil je weten hoe het onder de " +
        "motorkap zit: [thuis, technisch gezien](techniek-thuis.html)."
      ]
    },

    {
      type: "faq",
      heading: "Vragen",
      items: [
        {
          q: "Werkt dit alleen met Telegram?",
          a: "Op dit moment is Telegram de eerste chat-ingang, omdat " +
             "die het makkelijkst werkt voor een bot zoals deze. Maar " +
             "het idee is uitdrukkelijk dat verschillende ingangen " +
             "naast elkaar werken — een ander chat-platform, een " +
             "scherm, of iets eigens. De gegevens zelf liggen niet " +
             "in de chat."
        },
        {
          q: "Moet ik dit ergens online aanzetten, of werkt het ook lokaal?",
          a: "Een huishouden kan helemaal op een toestel in huis " +
             "draaien — een oud laptopje, een kleine server, een " +
             "Raspberry Pi. Geen abonnement, geen internetverbinding " +
             "strikt nodig. Wil je later op afstand bij je gegevens, " +
             "of iets delen met iemand die niet in huis woont, dan " +
             "kan dat erbij komen; het is geen voorwaarde om te " +
             "beginnen."
        },
        {
          q: "Wat als er een huisgenoot vertrekt?",
          a: "Eén persoon in het huishouden heeft beheerderstoegang " +
             "en kan iemand toevoegen of verwijderen. Die rol is " +
             "overdraagbaar. Wat de vertrokken huisgenoot in haar " +
             "eigen ruimte had staan blijft bij haar — dat verhuist " +
             "mee, zoals het hoort."
        },
        {
          q: "Gebruikt het AI?",
          a: "Een taalmodel helpt om wat je in gewone taal zegt op " +
             "de juiste plek te zetten (\"de koffie is bijna op\" → " +
             "boodschappenlijst). Dat draait afgeschermd, op je " +
             "eigen toestel of in een omgeving waar niemand " +
             "meeleest. En het is optioneel: een huishouden dat " +
             "alleen het scherm wil gebruiken kan dat ook."
        }
      ]
    }
  ]
};
