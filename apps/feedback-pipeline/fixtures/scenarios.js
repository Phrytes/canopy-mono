// Scenario fixtures drawn from the three commercial directions in
// Project Files/Aanpak/commerciele_verkenning.md. All content is SYNTHETIC —
// no real people, employers, institutions, numbers or accounts.
//
// These go deliberately BEYOND household chat to stress the pipeline on the
// real product domains and surface gaps the household fixtures don't:
//   • Richting A — works-council / workplace feedback: manager & colleague
//     names, departments, salaries, retaliation/intimidation ("signaal-spoor").
//   • Richting B — emotion-heavy, SPECIAL-CATEGORY data (zorg / UWV): health
//     conditions, care-institution names, BSN numbers, and CRISIS signals
//     that the design says must ESCALATE (113), not be quietly aggregated.
//
// Each scenario has `clean` (per-message fixtures) and `batch` (a set to
// summarize, with deliberate cross-user / cross-language duplicates).
// `userDefault` is the per-user language spine for the hybrid resolver; the
// English messages should still be detected and routed as EN (override).

export const SCENARIOS = [
  {
    id: 'A',
    name: 'OR-feedbacktool — works council / workplace',
    userDefault: 'nl',
    clean: [
      {
        id: 'A1', lang: 'nl',
        text: 'Mijn teamleider Karin maakt me constant belachelijk in vergaderingen, ik word er echt gek van. Haar nummer is 0612345678 als jullie het willen checken.',
        notes: 'regex: phone. name Karin. intimidation/signaal. keep: manager belittles in meetings.',
      },
      {
        id: 'A2', lang: 'nl',
        text: 'De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR (hr@bedrijf.nl) doet niks.',
        notes: 'regex: email. GAP: department "Logistiek" identifies a small team — not regex-caught. keep: workload after reorg.',
      },
      {
        id: 'A3', lang: 'nl',
        text: 'Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon klote.',
        notes: 'name Ahmed; profanity (klote). GAP: salary figures are quasi-identifying, not regex PII. keep: unequal pay for same work.',
      },
      {
        id: 'A4', lang: 'en',
        text: "My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.",
        notes: 'EN (should override nl default). intimidation/signaal + fear of retaliation. no PII to strip; keep emotional truth.',
      },
      {
        id: 'A5', lang: 'nl',
        text: "Godverdomme alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.",
        notes: 'profanity (godverdomme); surname Pietersen; retaliation framing. keep: forced weekend teambuilding + retaliation.',
      },
    ],
    batch: [
      'De reorganisatie heeft de werkdruk enorm verhoogd, niemand houdt dit zo vol.',
      'Sinds de reorg draaien we veel te veel uren, het is niet vol te houden.',     // dup
      'Workload since the restructuring is simply unsustainable.',                    // dup (EN)
      'Teamleider Karin gedraagt zich kleinerend richting haar team.',
      'Ik voel me vernederd door mijn leidinggevende in meetings.',                   // related (intimidation)
      'De salarisverschillen tussen collega\'s voor hetzelfde werk zijn oneerlijk.',
      'Verplichte teambuilding in het weekend valt heel slecht.',
    ],
  },
  {
    id: 'B',
    name: 'Emotion-heavy sectors — care / UWV (special category)',
    userDefault: 'nl',
    clean: [
      {
        id: 'B1', lang: 'nl',
        text: 'Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is 123456782 voor het dossier.',
        notes: 'name Smeets. GAP: BSN 123456782 (9 digits) is NOT caught by the phone rule. GAP: "Radboud" institution name. health/incident. keep: wrong medication during admission.',
      },
      {
        id: 'B2', lang: 'nl',
        text: 'De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.',
        notes: 'special category (mental health). GAP: "GGZ" + condition (depressie) are health data, not regex PII. keep: 8-month wait worsens condition.',
      },
      {
        id: 'B3', lang: 'nl',
        text: 'Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma), bel me op 0687654321.',
        notes: 'regex: phone. health (reuma). UWV experience. keep: treated as fraud while ill.',
      },
      {
        id: 'B4', lang: 'en',
        text: 'After my surgery at the clinic no one followed up. I felt completely abandoned and started having dark thoughts.',
        notes: 'EN (override). health. ⚠ POSSIBLE CRISIS SIGNAL ("dark thoughts") — design says escalate, not silently aggregate.',
      },
      {
        id: 'B5', lang: 'nl',
        text: 'Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.',
        notes: '⚠ CRISIS SIGNAL (suicidal ideation). MUST route to escalation (113 / signaal-spoor), NOT be cleaned+aggregated. Tests whether the pipeline has a safety gap (it currently does).',
      },
    ],
    batch: [
      'De wachttijden bij de GGZ zijn veel te lang.',
      'Ik wacht al maanden op hulp bij de GGZ, dit is onacceptabel.',                 // dup
      'Mental health waiting lists are far too long.',                                // dup (EN)
      'Ik kreeg de verkeerde medicatie tijdens mijn ziekenhuisopname.',
      'Medicatiefouten in het ziekenhuis komen veel te vaak voor.',                   // near-dup
      'Bij het UWV voelde ik me als verdachte behandeld terwijl ik ziek ben.',
    ],
  },
  {
    id: 'C',
    name: 'Onderzoek & interviews — qualitative research respondents',
    userDefault: 'nl',
    clean: [
      {
        id: 'C1', lang: 'nl',
        text: 'Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.',
        notes: 'GAP: employer "Belastingdienst" identifies the org; third-party wrongdoing. keep: manager altered figures, respondent feared speaking up.',
      },
      {
        id: 'C2', lang: 'nl',
        text: 'In het interview zei ik dat mijn collega Fatima werd gepest, maar ik wil haar naam er eigenlijk uit hebben.',
        notes: 'THIRD-PARTY name Fatima (gazetteer miss — not in list). explicit redaction wish. keep: a colleague was bullied.',
      },
      {
        id: 'C3', lang: 'en',
        text: 'Honestly the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.',
        notes: 'EN. GAP: employer descriptor + city (Tilburg) quasi-identify. keep: toxic management, burnout.',
      },
      {
        id: 'C4', lang: 'nl',
        text: 'Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.',
        notes: 'special/sensitive; THIRD-PARTY minor (daughter, age 8). keep: traumatic child-protection experience.',
      },
    ],
    batch: [
      'Veel respondenten noemen een angstcultuur waarin niemand durft te melden.',
      'Mensen durven misstanden niet aan te kaarten uit angst.',                     // dup
      'A culture of fear prevents people from speaking up.',                          // dup (EN)
      'Burn-out door structureel te hoge werkdruk komt vaak terug.',
      'Respondenten beschrijven hoge werkdruk die tot uitputting leidt.',             // near-dup
      'Wantrouwen richting de directie is een rode draad.',
    ],
  },
  {
    id: 'D',
    name: 'Klokkenluiden & integriteit — whistleblowing reports',
    userDefault: 'nl',
    clean: [
      {
        id: 'D1', lang: 'nl',
        text: 'Ik meld dat afdelingshoofd Van Dijk facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678).',
        notes: 'name Van Dijk (surname — gazetteer miss). GAP: KvK number 12345678 (8 digits) NOT caught by regex. fraud allegation.',
      },
      {
        id: 'D2', lang: 'nl',
        text: 'Manager Karim vraagt structureel om seksuele gunsten in ruil voor promotie, meerdere collega\'s durven niets te zeggen.',
        notes: 'name Karim (gazetteer miss). SERIOUS (sexual harassment) + pattern across colleagues. keep substance, drop name.',
      },
      {
        id: 'D3', lang: 'en',
        text: "Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.",
        notes: 'EN. role "CFO" quasi-identifies. financial misconduct + fear of retaliation (signaal). keep substance.',
      },
      {
        id: 'D4', lang: 'nl',
        text: 'Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een dodelijk ongeluk.',
        notes: '⚠ HIGH-SEVERITY safety signal — should route to urgent escalation, not just aggregate. keep urgency.',
      },
    ],
    batch: [
      'Meerdere meldingen over intimidatie door hetzelfde afdelingshoofd.',
      'Collega\'s klagen over een leidinggevende die mensen kleineert en bedreigt.',  // related/dup
      'Reports of financial irregularities in procurement keep surfacing.',
      'Er wordt geknoeid met inkoopfacturen, meerdere mensen zien het.',              // dup (NL)
      'Veiligheidsprocedures worden stelselmatig genegeerd op de werkvloer.',
    ],
  },
  {
    id: 'E',
    name: 'Lerende organisatie — operational observations (low-PII)',
    userDefault: 'en',
    clean: [
      {
        id: 'E1', lang: 'en',
        text: "The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.",
        notes: 'NO PII. TEST: pipeline must NOT over-redact "CI/CD". keep verbatim.',
      },
      {
        id: 'E2', lang: 'nl',
        text: 'Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.',
        notes: 'product name "Salesforce" (company, not person). TEST: keep it; no personal PII to strip.',
      },
      {
        id: 'E3', lang: 'nl',
        text: 'Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.',
        notes: 'TEST over-redaction: "Acme" is a SUPPLIER (company), not a person — gazetteer must not catch it, LLM should keep it.',
      },
      {
        id: 'E4', lang: 'en',
        text: 'Customers keep asking for the same export feature; support is overwhelmed by it.',
        notes: 'NO PII. operational pattern. keep verbatim.',
      },
    ],
    batch: [
      'The CI/CD pipeline is too slow and blocks deploys.',
      'Onze build-pipeline duurt veel te lang, het kost ons elke dag tijd.',          // dup (NL)
      'Multiple devs flagged the deploy pipeline as a bottleneck this month.',        // dup (EN)
      'Klanten vragen herhaaldelijk om dezelfde export-functie.',
      'Support wordt overspoeld door dezelfde feature-vraag.',                        // near-dup
      'De documentatie loopt achter op de laatste release.',
    ],
  },
  {
    id: 'F',
    name: 'Burgerparticipatie — citizen feedback on local policy',
    userDefault: 'nl',
    clean: [
      {
        id: 'F1', lang: 'nl',
        text: 'Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op de Lindenlaan 8 woont.',
        notes: 'regex: address (Lindenlaan 8). THIRD-PARTY (moeder). NUANCED non-binary opinion — must survive. location "Marktplein" is the topic, keep.',
      },
      {
        id: 'F2', lang: 'nl',
        text: 'De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht is veel te veel voor de bestaande infrastructuur.',
        notes: 'GAP: neighbourhood "Overvecht" identifies area, not regex-caught (and is the topic). nuanced opinion. keep.',
      },
      {
        id: 'F3', lang: 'en',
        text: 'I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on Dorpsstraat 23.',
        notes: 'EN. regex: address (Dorpsstraat 23). nuanced for/against — must survive.',
      },
      {
        id: 'F4', lang: 'nl',
        text: 'Mijn buurman Klaas en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.',
        notes: 'THIRD-PARTY name Klaas (gazetteer miss). keep: playground unsafe, needles around.',
      },
    ],
    batch: [
      'Veel bewoners maken zich zorgen over parkeerdruk na de herinrichting.',
      'Parkeerplekken verdwijnen en dat baart mensen zorgen.',                        // dup
      'Residents worry there will not be enough parking.',                            // dup (EN)
      'De voorgestelde woningdichtheid wordt als te hoog ervaren.',
      'Mensen steunen de energietransitie maar vrezen horizonvervuiling door windmolens.',
      'De speeltuin wordt als onveilig ervaren.',
    ],
  },
];
