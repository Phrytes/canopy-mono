/* vragen.js — Vragen (FAQ). Duidelijk ingedeeld: algemeen vs. de
   situaties waar veel mensen samen een beeld vormen (werk &
   maatschappij). Eerlijk, geen belofte, geen e-mail. */
window.ONDERLING_PAGE = {
  key: "vragen",
  title: "Vragen",
  blocks: [
    {
      type: "hero",
      heading: "Vragen",
      lead:
        "Een paar dingen die opkomen, zo eerlijk mogelijk beantwoord — " +
        "ook waar het antwoord “nog niet” is."
    },

    {
      type: "faq",
      heading: "Algemeen",
      items: [
        {
          q: "Kan ik het nu al gebruiken?",
          a: "Een werkende versie draait in een huishouden. De rest is " +
             "plan of in uitwerking; zie [stand van " +
             "zaken](stand-van-zaken.html)."
        },
        {
          q: "Gaat het via een chat of via een app?",
          a: "Allebei kan. Je typt tegen een assistent, of je tikt het " +
             "aan op een scherm met lijstjes — daaronder is het dezelfde " +
             "onderlaag. Slimme hulp is optioneel."
        },
        {
          q: "Gebruikt het AI?",
          a: "Soms, om gewone berichten te begrijpen of gevoelige " +
             "details weg te halen. Dat draait lokaal of in een " +
             "afgeschermde omgeving, zo dat niemand anders kan meelezen — " +
             "ook het bedrijf erachter niet, anders dan bij veel bekende " +
             "AI-assistenten. En het kan ook zonder."
        },
        {
          q: "Is mijn inbreng veilig?",
          a: "Wat je inbrengt staat in een afgesloten ruimte waar alleen " +
             "jij bij kunt; er gaat alleen iets verder als jij het " +
             "vrijgeeft. Een sluitende garantie bestaat nergens — daarom " +
             "is er geen centrale bak waar alles samenkomt, en zit die " +
             "bevestig-stap ertussen."
        }
      ]
    },

    {
      type: "faq",
      heading: "Bij werk & maatschappij: veel mensen, één beeld",
      intro:
        "Deze gaan over de situaties waarin veel mensen samen een beeld " +
        "vormen — meedenken over je werk, ervaringen in de zorg, " +
        "meepraten met de overheid. Thuis en in de buurt deel je " +
        "rechtstreeks met mensen die je kent; daar spelen ze niet.",
      items: [
        {
          q: "Hoe voorkom je dat één iemand een anonieme ophaling " +
             "vertekent?",
          a: "Vooral doordat jóuw inbreng in één keer wordt samengevat " +
             "en als geheel meetelt, niet als losse berichten. Je kunt " +
             "het beeld dus niet kleuren door dezelfde klacht tien keer " +
             "in te sturen — het telt als één stem. Daar bovenop " +
             "verschijnt iets pas als genoeg verschillende mensen er " +
             "onafhankelijk aan bijdragen, en doet een onafhankelijke " +
             "partij de eindcontrole."
        },
        {
          q: "Maar hoe weet je dan wie er echt is, of wie mag meedoen?",
          a: "Daar is een idee voor — verificatie en groepsacceptatie — " +
             "maar de praktische kant (hoe deel je toegang uit onder " +
             "bijvoorbeeld werknemers of zorgafnemers?) is nog niet " +
             "rond. Eerlijk: dat is een open vraag, geen afgevinkt vakje."
        }
      ]
    }
  ]
};
