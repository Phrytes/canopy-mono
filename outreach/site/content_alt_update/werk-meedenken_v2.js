/* werk-meedenken.js — v2 met verwijzing naar waarborgen. */
window.ONDERLING_PAGE = {
  key: "werk",
  title: "Meedenken over je werk",
  blocks: [
    { type: "backlink", href: "werk.html", label: "Werk & maatschappij" },

    {
      type: "hero",
      heading: "Meedenken over je werk",
      lead:
        "Een medewerkersonderzoek komt eens per twee jaar, wordt door " +
        "of namens HR uitgevoerd, en daarom weinig vertrouwd en " +
        "zelden eerlijk ingevuld. De wandelgangen horen alleen de " +
        "mensen die toevallig langslopen. Daartussen valt het meeste."
    },

    {
      type: "prose",
      paragraphs: [
        "De ondernemingsraad heeft één ding dat HR niet heeft: een " +
        "wettelijke positie die los staat van de werkgever. Daarom " +
        "is de OR hier de ontvanger, niet de directie. Voor jou als " +
        "medewerker is dat het verschil tussen \"de baas leest mee\" " +
        "en \"de OR verzamelt wat er leeft, en ik beslis wat ervan " +
        "meegaat\".",
        "Je laat iets weten op het moment dat het speelt — niet " +
        "wachtend op een enquête, via een kanaal dat je toch al " +
        "gebruikt. Voor het kwartaaloverzicht naar de OR krijg je " +
        "het terug te zien: dít zou er, geanonimiseerd, mee kunnen " +
        "— jij haalt eruit wat je er niet in wilt, of trekt het " +
        "terug."
      ]
    },

    {
      type: "dialog",
      heading: "Hoe dat voelt in de praktijk",
      turns: [
        { who: "jij", text: "deze week weer drie keer overgewerkt " +
          "tot half acht omdat de planning niet klopt" },
        { who: "bot", text: "Genoteerd in je eigen ruimte. Wil je " +
          "dit meenemen naar het OR-overzicht van dit kwartaal?" },
        { who: "jij", text: "ja, maar laat de tijden eruit, dat is " +
          "te herleidbaar" },
        { who: "bot", text: "Aangepast naar \"structureel overwerken " +
          "doordat de planning niet sluit\". Je ziet alles vóór het " +
          "kwartaaloverzicht nog terug." }
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Een zware kwestie — intimidatie, onveiligheid — hoeft niet " +
        "te wachten tot er een breder beeld is; die kun je, met jouw " +
        "uitdrukkelijke akkoord, apart laten lopen naar de " +
        "vertrouwenscommissie van de OR of een aangewezen " +
        "vertrouwenspersoon. De werkgever ziet nooit losse berichten, " +
        "alleen wat veel mensen samen aangeven. Hoe die scheiding " +
        "precies werkt, staat op [hoe werkt het](hoe-het-werkt.html); " +
        "welke eisen aan een onafhankelijke OR-rol worden gesteld, " +
        "staat onder [de waarborgen](waarborgen.html)."
      ]
    }
  ]
};
