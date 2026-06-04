// A pool of realistic, SYNTHETIC raw feedback messages spanning several
// domains, languages, duplicates, PII, and a few serious signals (crisis /
// safety / integrity). The full-pipeline smoke draws a ROTATING subset each
// run (so results aren't overfit to one fixed set) and runs it end-to-end:
// raw → clean → triage → per-domain summaries.

export const FULL_DATASET = [
  // care / health (duplicates across languages)
  'De wachttijd bij de GGZ is hier al 8 maanden, mijn depressie wordt alleen maar erger.',
  "Mental health waiting lists are far too long, I've been waiting for months.",
  'Ik kreeg de verkeerde medicatie van dokter Smeets tijdens mijn opname, ik was doodsbang.',
  'Medicatiefouten in het ziekenhuis komen veel te vaak voor.',

  // workplace / workload
  'De werkdruk is niet te doen sinds de reorganisatie, we draaien 60 uur per week.',
  'Workload since the restructuring is unsustainable, everyone is exhausted.',
  'Mijn teamleider Karin kleineert me constant in vergaderingen, bel haar op 0612345678.',
  "I'm terrified to report this but my manager is a bastard who threatened to fire me.",
  'Ik verdien €2400 bruto terwijl mijn collega voor exact hetzelfde werk €3100 krijgt.',

  // crisis signals
  'Ik wil zo niet meer verder leven, niemand helpt me.',
  'After my surgery no one followed up, I started having dark thoughts.',

  // safety signals
  'Op de bouwplaats wordt met veiligheid gerommeld, het is wachten op een dodelijk ongeluk.',
  'The scaffolding on site is a death trap, someone will get hurt.',

  // integrity / whistleblowing (with a name + BSN)
  'Afdelingshoofd Van Dijk vervalst facturen en sluist geld weg, mijn BSN is 123456782.',
  'Manager Karim vraagt structureel seksuele gunsten in ruil voor promotie.',

  // civic
  'Ik ben vóór de herinrichting maar maak me zorgen over parkeerplekken, ik woon op Lindenlaan 8.',
  'I support the energy transition but the wind turbines will ruin the view from our village.',
  'De speeltuin is onveilig geworden, er slingeren naalden rond.',
  'Veel bewoners maken zich zorgen over de parkeerdruk na de herinrichting.',

  // operational (low-PII)
  "The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.",
  'Onze build-pipeline duurt veel te lang, het kost ons elke dag tijd.',
  'Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.',

  // research / sensitive
  'Ik heb meegemaakt dat mijn baas structureel cijfers liet aanpassen, ik durfde niets te zeggen.',
  'Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst.',
];
