/* gebruik.js — hub. Korte intro, statuslegenda, dan twee groepen
   klikbare kaarten. Eén strakke leest: concrete situatie → wat je
   concreet krijgt. Geen vage abstracties, geen te grote beloftes. */
window.ONDERLING_PAGE = {
  key: "gebruik",
  title: "Wat los je ermee op",
  blocks: [
    {
      type: "hero",
      heading: "Wat los je ermee op",
      lead:
        "Je gebruikt het zoals het past — een chat, een gewoon scherm, " +
        "of automatisch. Je merkt vooral de functie. Hieronder de " +
        "toepassingen — klik door voor wat je ermee kunt, een voorbeeld " +
        "uit gebruik, en hoe het ongeveer werkt."
    },

    {
      type: "prose",
      heading: "Waar het staat per toepassing",
      paragraphs: [
        "Bij elke toepassing staat een label, zodat duidelijk is wat er " +
        "al kan en wat nog niet:"
      ],
      list: [
        "**loopt al** — een eerste versie hiervan draait en wordt " +
        "gebruikt;",
        "**gepland** — de eerstvolgende concrete stap, nog niet gebouwd;",
        "**in verkenning** — een richting die wordt onderzocht; nog geen " +
        "bouw."
      ]
    },

    {
      type: "cards",
      heading: "Dichtbij, met elkaar",
      intro:
        "Tussen mensen die elkaar (deels) kennen, zonder iets ertussen.",
      items: [
        {
          status: "loopt",
          title: "Een huishouden of woongroep",
          body:
            "Boodschappen, klusjes en afspraken bijhouden en verdelen — " +
            "overzichtelijk, en niets op een centrale plek.",
          href: "gebruik-huishouden.html"
        },
        {
          status: "gepland",
          title: "Burenhulp en klussen in een buurt",
          body:
            "Een vraag of aanbod plaatsen en buren vinden die kunnen " +
            "helpen — zonder dat het via een groot bedrijf loopt.",
          href: "gebruik-buurt.html"
        }
      ]
    },

    {
      type: "cards",
      heading: "Met een onafhankelijke partij ertussen",
      intro:
        "Voor grotere groepen en organisaties, waar het alleen werkt als " +
        "degene waar het over gaat niet de aanbieder is.",
      items: [
        {
          status: "verkenning",
          title: "Meedenken over je werk",
          body:
            "Iets over je werk kwijt wanneer het speelt; jij bepaalt wat " +
            "er geanonimiseerd naar de ondernemingsraad gaat, niet je " +
            "baas.",
          href: "gebruik-werk.html"
        },
        {
          status: "verkenning",
          title: "Ervaringen delen in de zorg",
          body:
            "Een ervaring op je eigen tempo bijhouden, en zelf bepalen " +
            "wat er geanonimiseerd naar een onafhankelijke " +
            "patiëntenorganisatie gaat.",
          href: "gebruik-zorg.html"
        },
        {
          status: "verkenning",
          title: "Misstanden veilig melden",
          body:
            "Een misstand melden en het verloop volgen, zonder dat je " +
            "identiteit te achterhalen is.",
          href: "gebruik-melden.html"
        },
        {
          status: "verkenning",
          title: "Meedoen aan onderzoek en interviews",
          body:
            "Je ziet en bevestigt wat de onderzoeker krijgt, en kunt het " +
            "aanpassen tot een afgesproken moment.",
          href: "gebruik-onderzoek.html"
        },
        {
          status: "verkenning",
          title: "Wat een organisatie vasthoudt",
          body:
            "Wat mensen opvalt en leren op het moment zelf kwijt — " +
            "samengebracht tot patronen en verbeterpunten, geen scores.",
          href: "gebruik-leren.html"
        },
        {
          status: "verkenning",
          title: "Meepraten met de overheid",
          body:
            "Veel mensen reageren op een plan van de gemeente; de " +
            "gemeente hoort wat er leeft, zonder te zien wie wat zei.",
          href: "gebruik-overheid.html"
        },
        {
          status: "verkenning",
          title: "Een eigen versie op dezelfde basis",
          body:
            "Een organisatie biedt haar leden of medewerkers zoiets zelf " +
            "aan op dezelfde betrouwbare onderlaag — geen centrale " +
            "database.",
          href: "gebruik-infrastructuur.html"
        }
      ]
    },

    {
      type: "prose",
      heading: "De rode draad",
      paragraphs: [
        "Steeds hetzelfde eronder: je bijdrage staat in je eigen ruimte, " +
        "niet centraal. En vóór er iets gedeeld of samengevat wordt, kun " +
        "jij het aanpassen of terugnemen. Een patroon verschijnt pas als " +
        "meerdere mensen los van elkaar hetzelfde inbrengen — een losse " +
        "bijdrage nooit alleen.",
        "Wil je weten hoe dat onder de motorkap zit: [hoe het " +
        "werkt](hoe-het-werkt.html)."
      ]
    }
  ]
};
