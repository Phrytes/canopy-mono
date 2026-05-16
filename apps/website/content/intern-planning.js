/* intern-planning.js — INTERN. NIET PUBLICEREN.
 *
 * Volledig werkplan tot eind 2027, met cijfers (runway, drempels,
 * subsidieroutes). Deze pagina is alleen voor eigen gebruik en hoort
 * NIET mee te gaan naar een publieke host. Zie README.md.
 *
 * Bron: Project Files/Aanpak/intern_werkplan_v2.md (samengevat tot
 * webvorm; de cijfers en de scharnierpunten zijn bewust behouden).
 */
window.ONDERLING_PAGE = {
  key: "intern",
  title: "Intern werkplan",
  internBanner: "INTERN — NIET PUBLICEREN · alleen voor eigen gebruik",
  blocks: [
    {
      type: "hero",
      heading: "Intern werkplan — gelaagde bouw met steun-spoor",
      lead:
        "Werkdocument voor solo-ontwikkeling, juni 2026 – eind 2027. " +
        "Niet voor publicatie.",
      sub:
        "Uitgangssituatie: solo, 32–45 uur effectief per week. Werkende " +
        "v0 van een chatbot in een huishouden. Eigen-opslag-koppeling in " +
        "voorbereiding. Sterke Groningse netwerken, nauw contact met een " +
        "vooruitstrevend VvE-bestuur, huisgenoten die al meedraaien."
    },

    {
      type: "intern",
      text:
        "Deze pagina bestaat alleen lokaal. Niet linken vanuit de " +
        "publieke navigatie, niet mee deployen. De publieke roadmap is de " +
        "ontdane versie hiervan: zonder runway, drempels en bedragen."
    },

    /* ---- Deel I — financiële werkelijkheid ---- */
    {
      type: "prose",
      heading: "I. De financiële werkelijkheid",
      paragraphs: [
        "Eerst geld, dan plan. Runway: 2–4 maanden zonder inkomen, 6–8 " +
        "maanden bij €1000/maand vanaf juli. Geen jaar.",
        "**Drie scharnierpunten (diagnostiek, geen doel):**"
      ],
      list: [
        "**Eind augustus 2026 (~3 mnd):** zicht op een eerste concrete " +
        "geldbron — toegezegde subsidie, getekend contract, of een " +
        "gesprek dat met serieuze kans binnen 6–8 weken tot geld leidt.",
        "**Eind oktober 2026 (~5 mnd):** €1000+/maand binnen. Eén klein " +
        "contract, een uitbetaalde subsidie, of een parttime constructie. " +
        "Anders het noodluik openen.",
        "**Eind januari 2027 (~8 mnd):** €1500–2500/maand structureel, of " +
        "duidelijkheid over een grotere subsidie of betalende eerste " +
        "klant. Anders strategie fundamenteel herzien."
      ]
    },
    {
      type: "prose",
      heading: "De vier inkomensroutes",
      list: [
        "**Route 1 — snelle kleine subsidie** (Inwonersbudget Nij Begun, " +
        "€1–10K). Weken tot enkele maanden. Buurt-/bewonersgroep als " +
        "formele aanvrager, jij technische partner. Dekt een pilot; via " +
        "begeleidingsbudget €4–6K voor 1–2 maanden werk.",
        "**Route 2 — middelgrote regionale subsidie** (Impulsloket NPG " +
        "€25K, of via Sociale Agenda). 2–6 maanden. Sterkere coalitie, " +
        "gepubliceerd plan, soms eerste pilot. Dekt enkele maanden werk.",
        "**Route 3 — Toukomstproject-partnership.** Betaald werk in een " +
        "lopend project (Roemte, Oogst van Groningen, Het Stille Goud, " +
        "VanOnderen!). 2–4 maanden tot eerste factuur. €5K–€30K per " +
        "opdracht.",
        "**Route 4 — noodluik:** technische consultancy / lesgeven / " +
        "AI-implementatie. €60–90/uur MKB, €80–120/uur specialistisch. " +
        "Twee dagen/week = €2000–3500 bruto/maand."
      ]
    },
    {
      type: "prose",
      heading: "Cash-flow-prioritering",
      paragraphs: [
        "Niet alles parallel met gelijke energie. **Eerst Route 1** " +
        "(snelste tijd tot uitbetaling, sluit aan op huishouden→buurt). " +
        "**Parallel Route 3 verkennen, niet uitwerken** — 2–3 gesprekken " +
        "(Roemte voorop), geen voorstellen tot er aanleiding is. **Route " +
        "2 voorbereiden, niet activeren** — relevant zodra Route 1 een " +
        "pilot opleverde (maand 4–6). **Route 4 in de la, maar tastbaar** " +
        "— één pagina aanbod, 2–3 klantprofielen, klaar om binnen twee " +
        "weken te starten.",
        "**NLnet-vervolg bewust apart.** Voor de onderliggende techniek, " +
        "niet voor loon op korte termijn. Beslis-termijn 2–4 maanden, " +
        "uitbetaling per milestone over 12–18 maanden. Relevant voor 2027."
      ]
    },

    { type: "divider" },

    /* ---- Deel II — gelaagde bouw ---- */
    {
      type: "prose",
      track: "lokaal",
      heading: "II. De gelaagde bouw — drie ringen",
      paragraphs: [
        "Drie concentrische ringen, elk met eigen leerdoel en " +
        "exit-criteria."
      ]
    },
    {
      type: "prose",
      heading: "Laag 1 — Huishouden",
      paragraphs: [
        "**Stand:** loopt al, huisgenoten gebruiken een eerste versie.",
        "**Komende 6–8 weken:** stabiele eigen-opslag-koppeling (één per " +
        "huisgenoot + een gedeelde huishouden-ruimte); eerste versie van " +
        "de bevestig-flow (bot stelt voor, gebruiker bevestigt/past aan " +
        "vóór actie); multi-user getest; opschrijven wat werkt en schuurt.",
        "**Exit naar laag 2:** huisgenoten gebruiken het zonder ergernis " +
        "— openen het ongevraagd voor minstens twee doelen, geen klachten " +
        "meer over basis-UX. Realistisch 4–6 weken."
      ]
    },
    {
      type: "prose",
      heading: "Laag 2 — VvE",
      paragraphs: [
        "**Stand:** bestuur bereikbaar, vooruitstrevend. Voorwaarde: laag " +
        "1 werkt eerst thuis.",
        "**Wordt:** praktische organisatie eerst (gemeenschappelijke " +
        "taken, agenda's, herinneringen, simpele participatie), niet " +
        "meteen feedback. Onboarding voor mensen die jou kennen maar hun " +
        "data niet zomaar toevertrouwen; rollen-onderscheid (bestuur ziet " +
        "meer, bewoners minder); eerste echte bevestig-flow met " +
        "drempelwaarde.",
        "**Inzet bestuur:** vooraf afkaarten als experiment, één " +
        "bestuurlijke toezegging op papier (“wij testen van X tot " +
        "Y, leveren feedback, gebruiken het zelf”).",
        "**Exit naar laag 3:** ≥⅓ van de leden actief, bestuur kan uit " +
        "eigen ervaring spreken, minstens één situatie waarin het echt " +
        "waarde toevoegde. Realistisch 2–3 maanden vanaf start."
      ]
    },
    {
      type: "prose",
      heading: "Laag 3 — Buurt / straat / bewonersgroep",
      paragraphs: [
        "**Stand:** wordt voorbereid, nog niet geactiveerd.",
        "**Wordt:** de eerste écht externe pilot, met mensen die je niet " +
        "persoonlijk kent. Hier sluit Route 1 op aan: een buurtinitiatief " +
        "vraagt aan, jij technische partner; de aanvraag dekt coördinator, " +
        "koffie, drukwerk en een vergoeding voor jouw begeleiding.",
        "**Nog nodig vóór start:** werkende laag 1 en 2 als bewijslast; " +
        "een lokale aanvrager-partner (kritieke pad); subsidie of betaalde " +
        "opdracht in voorbereiding. Realistische start: maand 4–6."
      ]
    },
    {
      type: "prose",
      heading: "Doorlooptijd van de gedeelde bouw",
      list: [
        "**Maand 1–2 (jun–jul):** bevestig-flow basis, " +
        "aggregatie-architectuur. Voor laag 1.",
        "**Maand 3–4 (aug–sep):** uitbreiding laag 2 — rollen/rechten, " +
        "multi-user, eerste filtering.",
        "**Maand 5–7 (okt–dec):** voor laag 3 — drempelwaarde, " +
        "curatie-werkbank primitief, splitsing in sporen.",
        "Geen volledig uitontwikkeld geheel vóór een externe pilot — wel " +
        "“goed genoeg”, met expliciete documentatie van wat nog " +
        "niet af is."
      ]
    },

    { type: "divider" },

    /* ---- Deel III — subsidie-portefeuille ---- */
    {
      type: "prose",
      track: "lokaal",
      heading: "III. Subsidie-portefeuille",
      list: [
        "**Kort (≤3–4 mnd):** Inwonersbudget Nij Begun (€1–10K, eerste " +
        "echte aanvraag, buurt/VvE als aanvrager, €4–6K voor eigen werk); " +
        "Loket Leefbaarheid; kleine gemeentepotten (<€5K, combineerbaar).",
        "**Midden (4–9 mnd):** Impulsloket NPG (€25K, na eerste pilot); " +
        "Sociale Agenda Nij Begun (sterker, meerjarig, met coöperatie); " +
        "Toukomst-partnership (Roemte voorop); stimuleringsbudget van een " +
        "coöperatie zelf.",
        "**Lang (6–18 mnd):** NLnet-vervolg (techniek, jaar 2); NGI / " +
        "Sovereign Tech Fund (publieke infrastructuur, 2027); ZonMw / NWO " +
        "(onderzoekstoepassing, 2027); grotere provinciale programmagelden.",
        "**Regel:** max. twee aanvragen tegelijk in actieve voorbereiding, " +
        "rest in de la met een overzichtsdocument."
      ]
    },

    { type: "divider" },

    /* ---- Deel IV — bedrijfsvoorbereiding ---- */
    {
      type: "prose",
      track: "betaald",
      heading: "IV. Voorbereiding betaalde kant (parallel, maand 1–6)",
      list: [
        "**Stichtingsvorm onderzoeken, niet activeren** — één gesprek met " +
        "een Groningse notaris (kosten, statuten, raad van toezicht).",
        "**Raad-van-toezicht-longlist** — privacyjurist, OR/vakbond-stem, " +
        "ethicus, iemand met zorg-achtergrond. Nog geen verzoeken.",
        "**Eerste juridische check** — privacy-jurist over de " +
        "feedback-architectuur (filter-falen, drempelwaarde, " +
        "aggregatie). Voorkomen dat je tegen een blinde muur bouwt.",
        "**Casestudy-template** klaarzetten; eerste invulling na laag 2.",
        "**Parallel meedenken (niet activeren):** burgerparticipatie " +
        "(sluit op laag 3 aan), OR-tool (één gesprek met een OR-voorzitter " +
        "— luisteren), onderzoek (één gesprek RUG). Rest in de la tot " +
        "eind 2027."
      ]
    },

    { type: "divider" },

    /* ---- Deel V — tijdpad met scharnierpunten ---- */
    {
      type: "timeline",
      heading: "V. Tijdpad met scharnierpunten",
      items: [
        {
          period: "Maand 1–2 · jun–jul 2026",
          status: "bezig",
          track: "lokaal",
          heading: "Fundament",
          body:
            "Bevestig-flow basis, eigen-opslag voor huishouden afronden, " +
            "aggregatie-architectuur. Laag 1 stabiliseren. Twee " +
            "oriëntatiegesprekken (Inwonersbudget-loket; een potentiële " +
            "partner). Notaris + privacy-jurist. Noodluik-één-pager in de " +
            "la. Scharnier eind juli: is laag 1 stabiel? Is er een gesprek " +
            "dat tot een partner-toezegging kan leiden?"
        },
        {
          period: "Maand 3–4 · aug–sep 2026",
          status: "volgende",
          track: "lokaal",
          heading: "Uitbreiding",
          body:
            "Multi-user, rollen/rechten, eerste filtering. Introductie " +
            "laag 2 in de VvE met formele toezegging. Eerste " +
            "Inwonersbudget-aanvraag met partner (indienen vóór eind " +
            "september). Twee gesprekken (OR-voorzitter, RUG-onderzoeker). " +
            "Scharnier eind september: toegezegde subsidie of concreet " +
            "gesprek-met-uitzicht? Zo nee — noodluik openen."
        },
        {
          period: "Maand 5–6 · okt–nov 2026",
          status: "later",
          track: "lokaal",
          heading: "Externe pilot",
          body:
            "Drempelwaarde, curatie-werkbank eerste versie. Laag 3 " +
            "voorbereiden mits subsidie/partner concreet — anders laag 2 " +
            "verdiepen. Bij lopende subsidie: vervolgaanvraag voorbereiden. " +
            "Scharnier eind oktober: komt er €1000+/maand binnen? Zo nee, " +
            "noodluik activeren in november."
        },
        {
          period: "Maand 7–9 · dec 2026 – feb 2027",
          status: "later",
          track: "betaald",
          heading: "Consolidatie",
          body:
            "Splitsing in sporen, verdere volwassenheid. Laag 3 actief of " +
            "laag 2 uitbreiden. NLnet-vervolg schrijven indien eerste " +
            "subsidie loopt. Eerste betalende klant verkennen voor laat " +
            "2027? Scharnier eind januari: €1500–2500/maand structureel? " +
            "Zo nee — parttime intensiveren of strategie herzien."
        },
        {
          period: "Maand 10–18 · mrt – dec 2027",
          status: "later",
          track: "betaald",
          heading: "Groei en richting (speculatiever)",
          body:
            "Bij goed verloop: tweede/derde pilot, eerste betalende klant, " +
            "eerste medewerker overwegen, stichting daadwerkelijk " +
            "oprichten, raad van toezicht installeren. Eén van de " +
            "richtingen actief in voorbereiding (waarschijnlijk OR-tool of " +
            "doorgegroeide laag 3 / burgerparticipatie)."
        }
      ]
    },

    { type: "divider" },

    /* ---- Deel VI — deze week / maand ---- */
    {
      type: "prose",
      heading: "VI. Wat deze week en deze maand",
      paragraphs: ["**Deze week:**"],
      list: [
        "Een halve A4 vastleggen: huidige stand van de bot, wat " +
        "huisgenoten doen, wat in 4 weken voor laag 1 wordt opgeleverd.",
        "Drie gesprekken plannen: Roemte (kennismaking), VvE-bestuur " +
        "(informeel, pilot bespreekbaar maken), iemand die naar het " +
        "Inwonersbudget-loket kan introduceren."
      ]
    },
    {
      type: "prose",
      paragraphs: ["**Deze maand:**"],
      list: [
        "Laag 1 stabiel voor de huisgenoten.",
        "Drie oriëntatiegesprekken gevoerd.",
        "Notaris-afspraak over stichtingsvorm ingepland of gevoerd.",
        "Noodluik-één-pager geschreven.",
        "Eén vervolgvraag beantwoord: welke buurt/dorp past het best bij " +
        "een eerste laag 3-pilot?"
      ]
    },

    { type: "divider" },

    /* ---- Deel VII — bewust niet beslissen ---- */
    {
      type: "prose",
      heading: "VII. Wat ik bewust niet beslis",
      list: [
        "Welke betaalde toepassing eerst opschaalbaar wordt — OR-tool en " +
        "burgerparticipatie nu het waarschijnlijkst, niet vastpinnen vóór " +
        "maand 9–12.",
        "Hoe groot de organisatie eind 2027 is — 1 tot 3 mensen " +
        "realistisch; freelancers, stichting of coöperatie hangt af van " +
        "waar het geld vandaan komt.",
        "Of de feedback-kant of de buurt-/taken-kant het primaire " +
        "betaalde product wordt — beide kan, de pilots wijzen het uit.",
        "De rol van de eigen-opslag-standaard op lange termijn — nu " +
        "bouwen we erop, over twee jaar evalueren."
      ]
    },
    {
      type: "note",
      variant: "plan",
      text:
        "Het kritieke pad blijft het vinden van lokale partners — daar " +
        "zit het meeste risico én de grootste hefboom. Het plan is broos " +
        "op precies twee punten: de financiële drempels in oktober en " +
        "januari, en een laag 3-partner vóór maand 6. Op beide is een " +
        "fallback (noodluik; langer doorgaan op laag 2). Geen plan zonder " +
        "risico — dat is in deze fase niet realistisch."
    },
    {
      type: "intern",
      text:
        "Herinnering: niet publiceren. Bij het online zetten van de site " +
        "moeten **intern-planning.html** en " +
        "**content/intern-planning.js** worden uitgesloten. Zie README.md."
    }
  ]
};
