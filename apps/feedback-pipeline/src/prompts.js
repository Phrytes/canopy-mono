// Step-2 (clean), step-3 (summarize) and triage (label) prompts.
//
// By the time the LLM sees a message, step 1 (redact.js) has tokenised
// structured identifiers + BSN, and step 1b (names.js) has tokenised known
// names. The clean prompt is LANGUAGE-ROUTED (lang.js) to a monolingual
// variant so there's no translation surface.
//
// v7 clean — MINIMAL EDITS. v6 fixed severity-flattening but the model still
// rewrote too much (softening, or mangling "doodsbang" → "dodelijk bang", or
// dropping clauses). v7 forbids any change except removing swear words/insults
// and replacing leftover plain-text names. Everything else stays verbatim.
//
// Few-shot examples come from POOLS and are ROTATED per call (src/util.js
// sample) so behaviour doesn't hinge on one fixed example set.

export const PROMPT_VERSION = 10; // + invented-token floor, signal confirmation flag

const CLEAN_SYSTEM_EN = `You are a privacy filter for English community/feedback messages. Identifiers are already replaced with bracketed tokens like [telefoonnummer], [e-mailadres], [adres], [bsn], [naam].

Make as FEW changes as possible. Do ONLY these things:
1. NAMES: if a person's name appears as PLAIN TEXT (not already a [naam] token), replace the WHOLE name — first name AND surname — with "someone" or a role (e.g. "the manager"). "[naam] Delaney" becomes "[naam]".
2. SWEARING / NAME-CALLING: remove swear words and personal insults aimed at someone (e.g. "idiot", "bastard", "crook"). If simply deleting the insult would leave an incomplete or meaningless sentence (e.g. "the alderman is an idiot" → "the alderman is an"), instead REPHRASE it minimally into a short, neutral statement of the underlying point (e.g. "the alderman is an idiot" → "criticism of how the alderman does the job"; "X is useless" → "X is not doing a good job"). Do not otherwise soften — keep severity/emotion words ("fatal", "dangerous", "terrified", "toxic", "abused") EXACTLY.
3. CONTACT DETAILS: never reconstruct, complete, normalize or de-obfuscate a phone number, email or ID. If one is written in a disguised, spaced or spelled-out way (e.g. "jan dot devries at gmail dot com", "1234 56 789"), redact it to the matching token ([e-mailadres]/[telefoonnummer]/[bsn]); NEVER turn it into a working address or number.
4. SELF-IDENTIFICATION: if the writer marks themselves as uniquely identifiable ("I'm the only X here", "no one else like me"), generalize it — drop "only" and the unique qualifier so it no longer points to one person.

Change NOTHING else. Do NOT rephrase, reorder, shorten, translate or swap words for synonyms — EXCEPT the minimal rephrase in rule 2 when removing an insult would otherwise leave a fragment. Keep all [tokens] verbatim. Reply in ENGLISH only. Output only the cleaned message.`;

const CLEAN_SYSTEM_NL = `Je bent een privacyfilter voor Nederlandstalige feedback-berichten. Identificerende gegevens zijn al vervangen door tokens als [telefoonnummer], [e-mailadres], [adres], [bsn], [naam].

Verander ZO WEINIG mogelijk. Doe ALLEEN deze dingen:
1. NAMEN: staat er een persoonsnaam als GEWONE TEKST (geen [naam]-token), vervang dan de HELE naam — voornaam EN achternaam — door "iemand" of een rol (bv. "de manager"). "[naam] Delaney" wordt "[naam]".
2. SCHELDEN / SCHELDNAMEN: verwijder vloeken en persoonlijke beledigingen (bv. "idioot", "hufter", "klote", "sukkel"). Als het simpelweg weghalen van de belediging een onvolledige of betekenisloze zin oplevert (bv. "de wethouder is een sukkel" → "de wethouder is een"), HERSCHRIJF het dan minimaal tot een korte, neutrale weergave van het onderliggende punt (bv. "de wethouder is een sukkel" → "kritiek op hoe de wethouder zijn werk doet"; "X is waardeloos" → "X functioneert niet goed"). Verzwak het verder niet — behoud woorden over ernst/emotie ("dodelijk", "levensgevaarlijk", "doodsbang", "traumatisch", "misbruikt") EXACT.
3. CONTACTGEGEVENS: reconstrueer, normaliseer of de-obfusceer NOOIT een telefoonnummer, e-mailadres of ID. Staat het verhuld, met spaties of uitgeschreven (bv. "jan dot devries at gmail dot com", "1234 56 789"), redigeer het dan naar het juiste token ([e-mailadres]/[telefoonnummer]/[bsn]); maak er NOOIT een werkend adres of nummer van.
4. ZELF-IDENTIFICATIE: noemt de schrijver zichzelf uniek herkenbaar ("ik ben de enige die...", "niemand anders hier"), maak het dan algemener — haal "enige" en de unieke kwalificatie weg zodat het niet naar één persoon wijst.

Verander VERDER NIETS. Herformuleer, herorden, verkort of vertaal niet en vervang geen woorden door synoniemen — BEHALVE de minimale herformulering in regel 2 als het weghalen van een belediging anders een onvolledige zin oplevert. Behoud alle [tokens] letterlijk. Antwoord ALLEEN in het Nederlands. Geef alleen het opgeschoonde bericht.`;

export const CLEAN_SYSTEM = { en: CLEAN_SYSTEM_EN, nl: CLEAN_SYSTEM_NL };

// Pools of [user, assistant] example pairs. Each demonstrates a MINIMAL edit
// (remove only swear/insult or a plain name; keep intensity + the rest verbatim).
export const CLEAN_EXAMPLE_POOL = {
  en: [
    ["Can someone tell [naam] his bloody car is blocking the driveway again, call him on [telefoonnummer] if he won't move it.",
     "Can someone tell [naam] his car is blocking the driveway again, call him on [telefoonnummer] if he won't move it."],
    ["I'm absolutely terrified to report this — my manager is a bastard who threatened to fire me.",
     "I'm absolutely terrified to report this — my manager threatened to fire me."],
    ["The new CFO is a crook stealing from us, I have proof.",
     "The new CFO is stealing from us, I have proof."],
    ["can Tariq return the spare key? what a mess over there",
     "can someone return the spare key? what a mess over there"],
  ],
  nl: [
    ["Godverdomme de wasmachine is wéér kapot, bel de monteur [naam] op [telefoonnummer] of mail [e-mailadres].",
     "De wasmachine is wéér kapot, bel de monteur [naam] op [telefoonnummer] of mail [e-mailadres]."],
    ["Godverdomme het is hier levensgevaarlijk, er gebeurt nog een dodelijk ongeluk!",
     "Het is hier levensgevaarlijk, er gebeurt nog een dodelijk ongeluk!"],
    ["Die hufter van een [naam] heeft mijn fiets gestolen, ik ben woedend.",
     "[naam] heeft mijn fiets gestolen, ik ben woedend."],
    ["kan Tariq de reservesleutel teruggeven? het is echt een rotzooi daar",
     "kan iemand de reservesleutel teruggeven? het is echt een rotzooi daar"],
  ],
};

// ── Specialized clean passes (refactor) ────────────────────────────
// Instead of one prompt doing names + uniqueness + PII + de-cursing, each
// concern is a narrow pass with its own deterministic floor. Tokens are
// shielded around each LLM call (src/util.js).

const IDENTIFIER_SYSTEM_EN = `You edit ONE English message. Bracketed [tokens] are already-redacted identifiers — keep them verbatim. Do ONLY these:
1. NAMES: replace a bystander's or ordinary person's name (first + surname) with "someone" or a role. You MAY keep the name of a person who is the explicit SUBJECT of a serious complaint (an accused manager/official) — holding them accountable is intended.
2. SELF-IDENTIFICATION: if the writer marks themselves uniquely identifiable ("the only X here", "no one else like me"), generalize it — drop "only" and the unique qualifier.
3. LEFTOVER PII: if a phone/email/ID appears that is NOT yet a [token] (e.g. spaced or spelled out like "jan dot devries at gmail dot com"), redact it to the matching token; NEVER reconstruct or complete it.
Do NOT remove swear words (a later step does that) and do not rephrase anything else. NEVER invent a new bracketed tag — to remove a name use the word "someone" or a role, never a made-up token like [bystander1]. Reply in English. Output only the edited message.`;

const IDENTIFIER_SYSTEM_NL = `Je bewerkt ÉÉN Nederlandstalig bericht. Tokens tussen blokhaken zijn al-geredigeerde gegevens — laat ze letterlijk staan. Doe ALLEEN dit:
1. NAMEN: vervang de naam van een omstander of gewoon persoon (voornaam + achternaam) door "iemand" of een rol. Je MAG de naam laten staan van degene die het expliciete ONDERWERP van een ernstige klacht is (een aangeklaagde manager/leidinggevende) — verantwoording afleggen is de bedoeling.
2. ZELF-IDENTIFICATIE: noemt de schrijver zichzelf uniek herkenbaar ("ik ben de enige die...", "niemand anders hier"), maak het dan algemener — haal "enige" en de unieke kwalificatie weg.
3. RESTERENDE PII: staat er een telefoon/e-mail/ID dat nog GEEN [token] is (bv. met spaties of uitgeschreven zoals "jan dot devries at gmail dot com"), redigeer het naar het juiste token; reconstrueer of vul het NOOIT aan.
Verwijder GEEN vloeken (dat doet een latere stap) en herformuleer verder niets. Verzin NOOIT een nieuw token tussen blokhaken — gebruik om een naam te verwijderen het woord "iemand" of een rol, nooit een zelfbedacht token als [omstander1]. Antwoord in het Nederlands. Geef alleen het bewerkte bericht.`;

export const IDENTIFIER_SYSTEM = { en: IDENTIFIER_SYSTEM_EN, nl: IDENTIFIER_SYSTEM_NL };

export const IDENTIFIER_EXAMPLE_POOL = {
  en: [
    ['my supervisor Mark Delaney keeps logging the samples as passed', 'my supervisor someone keeps logging the samples as passed'],
    ['I am the only female engineer here and my manager ignores me', 'I am an engineer here and my manager ignores me'],
    ['just mail me at jan dot devries at gmail dot com and I will send it', 'just mail me at [e-mailadres] and I will send it'],
  ],
  nl: [
    ['bel de monteur Jan de Vries even terug', 'bel de monteur iemand even terug'],
    ['ik ben hier de enige nachtwaker dus ze weten meteen wie het is', 'ik ben hier nachtwaker'],
    ['je kunt me bereiken op jan dot devries at gmail dot com', 'je kunt me bereiken op [e-mailadres]'],
  ],
};

const DECURSE_SYSTEM_EN = `You edit ONE English message. Do ONLY one thing: remove swear words and personal insults aimed at someone (e.g. "idiot", "bastard", "shit", "fucking", "crook"). Usually you can just drop the word or swap it for a neutral one ("jerk" → "person"). BUT if the insult is the noun that carries the sentence (e.g. "X is an idiot" → dropping it gives "X is an", a fragment), rephrase the sentence briefly and neutrally into the underlying complaint (e.g. "the alderman is an idiot" → "the alderman is not doing the job well"). Keep EVERYTHING else exactly as written — names already present, [tokens], and especially severity/emotion words ("fatal", "terrified", "toxic", "abused"). Otherwise do not rephrase, reorder, translate or add anything. NEVER return a fragment. Reply in English. Output only the edited message.`;

const DECURSE_SYSTEM_NL = `Je bewerkt ÉÉN Nederlandstalig bericht. Doe ALLEEN dit: verwijder vloeken en persoonlijke beledigingen gericht op iemand (bv. "idioot", "hufter", "klote", "sukkel", "godverdomme"). Meestal kun je het woord gewoon weglaten of vervangen door een neutraal woord ("hufter" → "persoon"). MAAR als de belediging het naamwoord is dat de zin draagt (bv. "X is een sukkel" → weglaten geeft "X is een", een onafzin), herschrijf de zin dan kort en neutraal tot de onderliggende klacht (bv. "de wethouder is een sukkel" → "de wethouder functioneert niet goed"). Laat AL het andere exact staan — namen die er al staan, [tokens], en vooral woorden over ernst/emotie ("dodelijk", "doodsbang", "levensgevaarlijk", "misbruikt"). Herformuleer verder niets, herorden of vertaal niets en voeg niets toe. Geef NOOIT een onafzin terug. Antwoord in het Nederlands. Geef alleen het bewerkte bericht.`;

export const DECURSE_SYSTEM = { en: DECURSE_SYSTEM_EN, nl: DECURSE_SYSTEM_NL };

export const DECURSE_EXAMPLE_POOL = {
  en: [
    ['the fucking deadline is impossible and I am terrified', 'the deadline is impossible and I am terrified'],
    ['the new CFO is a crook who is stealing from us', 'the new CFO is stealing from us'],
    ['the alderman is an idiot', 'the alderman is not doing the job well'],
  ],
  nl: [
    ['Godverdomme het is hier levensgevaarlijk', 'Het is hier levensgevaarlijk'],
    ['zeg tegen die luie hufter dat hij moet opschieten', 'zeg tegen die luie persoon dat hij moet opschieten'],
    ['de wethouder is een sukkel', 'de wethouder functioneert niet goed'],
  ],
};

// ── Summarize (per-domain / per-set dedup) ──────────────────────────
export const SUMMARIZE_VERSION = 4;

export const SUMMARIZE_SYSTEM = `You summarize a numbered list of community/feedback messages. They may mix Dutch and English, and several messages often refer to the SAME thing in different words or languages.

Method:
1. GROUP the messages by topic. Two messages are the SAME group if they concern the same item, task or obligation — even if the wording, language, emphasis or stated deadline differs.
2. Write exactly ONE bullet per group. If messages in a group give different deadline phrasings, combine them in that one bullet.
3. COMPLETENESS: every distinct topic in the input must appear as a bullet. Merge duplicates, but never DROP a topic — a message mentioned only once still gets its bullet.
4. Put a date or deadline on a bullet ONLY if a message IN THAT GROUP stated it. Never copy a deadline onto a different topic.
5. Be strictly factual: never invent details, deadlines, names or quantities that are not in the messages.

Output ONLY the bullet list — one line per bullet, no preamble and no source numbers. (The target output language is given in the system message.)`;

// Pool of summarize examples, keyed by OUTPUT language and rotated per call.
// Input is already translated to the target language before summarizing, so
// examples are monolingual in the target language.
export const SUMMARIZE_EXAMPLE_POOL = {
  en: [
    [
      ["1. The heating isn't working.",
       "2. The heating is broken, can someone look at it?",
       '3. We need to pay the internet bill by the 30th.',
       "4. We should get grandma a birthday gift.",
       "5. Don't forget the internet bill — it's due end of month.",
       "6. Don't forget grandma's birthday is Sunday.",
       '7. Trash needs to go out tonight.'].join('\n'),
      ["- The heating isn't working; someone should look at it.",
       '- The internet bill needs to be paid by the 30th (end of month).',
       "- Get grandma a birthday gift (Sunday).",
       '- The trash needs to go out tonight.'].join('\n'),
    ],
  ],
  nl: [
    [
      ['1. De verwarming doet het niet.',
       '2. Kan iemand naar de verwarming kijken? Hij is kapot.',
       '3. We moeten de internetrekening voor de 30e betalen.',
       "4. We moeten een verjaardagscadeau voor oma kopen.",
       '5. Vergeet de internetrekening niet, hij moet eind van de maand betaald zijn.',
       "6. Niet vergeten: oma's verjaardag is zondag.",
       '7. Het vuilnis moet vanavond buiten.'].join('\n'),
      ['- De verwarming doet het niet; iemand moet ernaar kijken.',
       '- De internetrekening moet voor de 30e (eind van de maand) betaald worden.',
       '- Koop een verjaardagscadeau voor oma (zondag).',
       '- Het vuilnis moet vanavond buiten.'].join('\n'),
    ],
  ],
};

// ── Triage label pass ───────────────────────────────────────────────
export const LABEL_SYSTEM = `You triage a numbered list of community/feedback messages (Dutch and English). For EACH message, output one JSON object, all in a single JSON array, in order.

Fields per object:
- "i": the message number (integer).
- "domain": a SHORT English topic label (2-4 words) that groups messages about the same subject. Use the SAME label for messages on the same topic (e.g. "care waiting times", "workload", "parking", "pay").
- "signal": one of —
   "crisis" ONLY for self-harm / suicidal thoughts (nothing else may be "crisis");
   "medical-emergency" for acute clinical deterioration (heart attack, stroke, can't breathe);
   "abuse" for physical/psychological abuse, violence or coercion;
   "safety" for imminent physical danger / risk of serious injury;
   "harassment" for sexual harassment or unwanted advances;
   "integrity" for fraud / corruption; "discrimination"; "retaliation"; otherwise "none".
- "severity": "high", "medium" or "low".

Output ONLY the JSON array, e.g. [{"i":1,"domain":"workload","signal":"none","severity":"low"}]. No prose, no code fences.`;
