// Test fixtures for the clean/anonymize + summarize experiment.
//
// CLEAN_FIXTURES: single raw messages mixing personal/identifying details
// (names, phone, email, address, IBAN, postcode, URL), profanity/insults,
// and a real request that must survive. Mix of English (en) and Dutch (nl).
// `notes` describes what a good cleaned output should/should not contain —
// for human eyeballing only (not auto-graded).
//
// All content is SYNTHETIC. No real people, numbers or accounts.

export const CLEAN_FIXTURES = [
  {
    id: 'en-1', lang: 'en',
    text: "Can someone PLEASE tell Mark that his damn car is blocking the driveway again, call him on 06-1234 5678 if he doesn't move that piece of shit.",
    notes: 'regex: phone. llm: drop "Mark", drop profanity. keep: a car blocks the driveway, owner should move it.',
  },
  {
    id: 'en-2', lang: 'en',
    text: "we're out of milk and bread, also Sarah still owes me 20 euros from the pizza, email her sarah.jansen@gmail.com",
    notes: 'regex: email. llm: drop "Sarah". keep: out of milk and bread; a 20 euro pizza debt (de-named).',
  },
  {
    id: 'nl-1', lang: 'nl',
    text: "Godverdomme de wasmachine is wéér kapot, bel de monteur Jan op 0612345678 of mail jan@reparatie.nl, dit is echt klote.",
    notes: 'regex: phone + email. llm: drop "Jan", drop profanity (godverdomme/klote). keep: washing machine broken again, call/mail repair.',
  },
  {
    id: 'nl-2', lang: 'nl',
    text: "Kan iemand de huur overmaken naar IBAN NL12 RABO 0123 4567 89 voor vrijdag? En zeg tegen die luie hufter van een Peter dat hij de afwas moet doen.",
    notes: 'regex: IBAN. llm: drop "Peter", drop insult (luie hufter). keep: transfer rent before Friday; someone do the dishes.',
  },
  {
    id: 'en-3', lang: 'en',
    text: "good morning everyone!! hope you all slept well, beautiful day today 😄",
    notes: 'control: no PII, no profanity. should come back essentially unchanged, in English.',
  },
  {
    id: 'nl-3', lang: 'nl',
    text: "We wonen op Kerkstraat 12 in Utrecht — de pakketbezorger moet bij de buren zijn, niet bij ons, stomme idioot.",
    notes: 'regex: street+number (Kerkstraat 12). llm: drop insult (stomme idioot); "Utrecht" (city) is a known regex gap — see if llm drops it. keep: parcel goes to neighbours, not us.',
  },
  {
    id: 'nl-4', lang: 'nl',
    text: "Lisa woont op postcode 3512 JK, vraag haar of ze de reservesleutel teruggeeft, het is echt een rotzooi daar.",
    notes: 'regex: postcode (3512 JK). llm: drop "Lisa", soften "rotzooi". keep: ask her to return the spare key.',
  },
  {
    id: 'en-4', lang: 'en',
    text: "John shared the signup form at https://forms.example/abc123 — fill it in already you lazy idiots!",
    notes: 'regex: URL. llm: drop "John", drop insult (lazy idiots). keep: please fill in the signup form at [link].',
  },
];

// A single batch to summarize together. Deliberate SEMANTIC DUPLICATES:
// milk/bread (1, 2, 9) and the broken washing machine (3, 4) each appear
// more than once in different words/languages; rent appears twice (5, 8).
// Distinct singletons: dishes (6), parcel (7), dentist (10).
export const SUMMARIZE_BATCH = [
  "We're out of milk and bread.",
  "Kan iemand melk en brood halen? We hebben niks meer.",       // dup of 1 (nl)
  "The washing machine broke down again.",
  "De wasmachine is alweer stuk, moet gemaakt worden.",          // dup of 3 (nl)
  "Rent needs to be transferred before Friday.",
  "Someone has to do the dishes tonight.",
  "Reminder: the parcel should go to the neighbours, not to us.",
  "Don't forget rent is due this week!",                          // near-dup of 5
  "We really need to buy bread, ran out this morning.",           // near-dup of 1
  "Can someone book the dentist appointment for the kids?",
];

// A mixed batch for the triage flow: serious SIGNALS (crisis / safety /
// integrity) embedded among ordinary, duplicated feedback across two+ domains.
// Tests that signals get pulled out and the rest summarizes per domain.
export const TRIAGE_BATCH = [
  'De wachttijden bij de GGZ zijn veel te lang.',                                    // domain: care waiting times
  'Ik wacht al maanden op hulp bij de GGZ, dit is onacceptabel.',                    // dup
  'Ik wil zo niet meer verder leven.',                                               // SIGNAL: crisis
  'Op de bouwplaats wordt met veiligheid gerommeld, het is wachten op een dodelijk ongeluk.', // SIGNAL: safety
  'De werkdruk is veel te hoog sinds de reorganisatie.',                             // domain: workload
  'Te veel uren, dit is gewoon niet vol te houden.',                                 // dup workload
  'Mijn leidinggevende vraagt structureel seksuele gunsten in ruil voor promotie.',  // SIGNAL: integrity (high)
  'I support the new plan but I worry about parking in our street.',                 // domain: parking
  'Mental health waiting lists are far too long.',                                   // dup of GGZ (EN)
];
