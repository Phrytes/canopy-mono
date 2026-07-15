// Prompt PROFILES — two prompt sets, EXPLICITLY assigned per model.
//
//   • 'verbose' — the original prompts (src/prompts.js): long, heavily few-shot.
//     Tuned for small LOCAL models (qwen2.5:7b, mistral, geitje) that need the
//     hand-holding. Kept verbatim — local behaviour is unchanged.
//   • 'minimal' — short prompts for capable models (Kimi, gpt-oss). Less is more:
//     these models over-think a big prompt (the cause of the gpt-oss `general`
//     collapse). Also collapses the 2 clean passes into ONE (fewer calls → less
//     rate-limit pressure).
//
// Assignment is EXPLICIT per model in MODEL_PROFILE (no name-guessing). A model
// not listed gets DEFAULT_PROFILE. For quick experiments, FP_PROMPT_PROFILE or an
// opts.promptProfile override wins, so you can try a model on 'minimal' before
// committing it to the map.

// ── explicit model → profile map (edit this to assign a model) ──────────────
export const MODEL_PROFILE = {
  // local models — the verbose prompts they were tuned on:
  'qwen2.5:7b-instruct': 'verbose',
  'qwen2.5:7b': 'verbose',
  'mistral:7b-instruct': 'verbose',
  // Privatemode / capable models — minimal prompts. IDs per docs.privatemode.ai/models;
  // confirm against your deployment with: curl http://localhost:8080/v1/models
  'gpt-oss-120b': 'minimal',
  'openai/gpt-oss-120b': 'minimal',   // namespaced alias from /v1/models
  'kimi-k2.6': 'minimal',
  'kimi-latest': 'minimal',   // alias → latest Kimi
  'gemma-4-31b': 'minimal',
};
export const DEFAULT_PROFILE = 'verbose';   // unmapped models keep the safe, tested path

const envProfile = () => (typeof process !== 'undefined' && process.env ? process.env.FP_PROMPT_PROFILE : undefined);

/** Resolve the prompt profile for a model. Priority: explicit opts > env > map > default. */
export function profileFor(model, opts = {}) {
  return opts.promptProfile || envProfile() || MODEL_PROFILE[model] || DEFAULT_PROFILE;
}

// Per-task reasoning ("thinking") control. Each LLM step passes thinkingFor('<task>') as
// opts.thinking, so you can disable reasoning where the task is clear (crisis/signal
// detection) and keep it where it helps (summarising). Tasks: 'label' (signal/crisis/domain),
// 'clean', 'summarize', 'translate'. Set FP_THINKING_<TASK>=off|on (e.g. FP_THINKING_LABEL=off).
//
// Resolution order: ProjectConfig → FP_THINKING_<TASK> env → PROFILE DEFAULT → model default.
// The profile default matters: capable reasoning models on the `minimal` profile (Kimi,
// gpt-oss, gemma) spend their completion-token budget on reasoning and return EMPTY content
// for these short, structured tasks — so they default to 'off' (which is also the config that
// produced the 100% scorecards). Verbose/local models keep their own default (reason → on).
export function thinkingFor(task, opts = {}) {
  const fromConfig = opts.reasoning?.[task];   // the ProjectConfig form (single source)
  const fromEnv = (typeof process !== 'undefined' && process.env) ? process.env[`FP_THINKING_${String(task).toUpperCase()}`] : undefined;
  const v = fromConfig ?? fromEnv;             // config first, env fallback (tests)
  if (v === 'off') return 'off';
  if (v === 'on') return 'on';
  // no explicit setting → profile default: minimal-profile models reason themselves blank here
  if (opts.model && profileFor(opts.model, opts) === 'minimal') return 'off';
  return undefined;   // inherit global FP_LLM_THINKING / model default
}

// ── minimal prompts ─────────────────────────────────────────────────────────
// Clean runs AFTER the deterministic floors (regex PII + name gazetteer), and the
// caught PII is shielded as [[n]] markers — so the model only handles the fuzzy
// remainder. ONE pass (vs verbose identifier+decurse).
export const MINIMAL_CLEAN = {
  nl: `Je schoont één feedbackbericht licht op. Persoonsgegevens zijn al verwijderd en staan als markeringen tussen haken — laat die EXACT staan, verander of verwijder ze niet en voeg geen nieuwe toe.
Doe alleen dit, in dezelfde taal en met behoud van de betekenis:
1. Vervang een eventuele resterende PERSOONSnaam door "iemand" (of een rol, bv. "de manager"). Laat namen van organisaties, bedrijven en plaatsen staan.
2. Haal scheldwoorden/beledigingen weg. Levert dat een onvolledige zin op (bv. "de wethouder is een sukkel" → "de wethouder is een"), herschrijf het dan minimaal tot een korte, neutrale weergave van het punt (bv. → "kritiek op hoe de wethouder zijn werk doet"). Behoud anders het punt zoals het staat.
3. Neem overdreven toon weg, maar verzwak NIET hoe ernstig iets is.
Geef ALLEEN de opgeschoonde tekst terug. Geen aanhalingstekens, geen uitleg.`,
  en: `You lightly clean ONE feedback message. Personal data is already removed and shown as bracketed markers — leave those EXACTLY as they are, do not change or remove them and do not add new ones.
Do only this, in the same language, preserving meaning:
1. Replace any remaining PERSON's name with "someone" (or a role, e.g. "the manager"). Keep organisation, company and place names.
2. Remove profanity/insults. If that leaves an incomplete sentence (e.g. "the alderman is an idiot" → "the alderman is an"), rephrase it minimally into a short, neutral statement of the point (e.g. → "criticism of how the alderman does the job"). Otherwise keep the point as written.
3. Remove over-the-top tone, but do NOT downplay how serious something is.
Return ONLY the cleaned text. No quotes, no notes.`,
};

// ── CANDIDATE clean prompts (geo/profanity tuning, 2026-07-16) ────────────────
// DRAFT variants for A/B validation against the privatemode route — NOT wired into
// the pipeline (the tested MINIMAL_CLEAN above stays the default). The harness
// `scripts/prompt-tuning-geo-profanity.js` runs baseline vs candidate via the new
// `opts.cleanSystem` override so Frits can compare on real output before adopting.
// Two changes vs MINIMAL_CLEAN:
//   • GEO: coarsen fine-grained locations that pinpoint a person/home (street+number,
//     house number, postcode, exact coords → neighbourhood), while KEEPING
//     municipality/district/organisation/public-place names. (Aligns with the
//     requested-attributes `place` coarsening — a small address is a re-id vector.)
//   • PROFANITY: remove insults aimed at a PERSON but always keep the substantive
//     point, and explicitly DON'T sanitise strong non-insulting words about a
//     SITUATION ("belachelijk"/"schandalig"/"ridiculous") — reduce over-removal.
export const MINIMAL_CLEAN_CANDIDATE = {
  nl: `Je schoont één feedbackbericht licht op. Persoonsgegevens zijn al verwijderd en staan als markeringen tussen haken — laat die EXACT staan, verander of verwijder ze niet en voeg geen nieuwe toe.
Doe alleen dit, in dezelfde taal en met behoud van de betekenis:
1. Vervang een eventuele resterende PERSOONSnaam door "iemand" (of een rol, bv. "de manager").
2. PLAATSEN: laat namen van gemeenten, wijken, buurten, organisaties en bedrijven staan. Maak fijnmazige locaties die naar één persoon of woning wijzen ALGEMENER: vervang een straat + huisnummer of exact adres door de buurt (bv. "Kerkstraat 12" → "in die buurt"), en verwijder huisnummers, postcodes en exacte coördinaten. Een openbare plek of instelling (bv. "het gemeentehuis", "het station") blijft staan.
3. Haal scheldwoorden/beledigingen die op een PERSOON gericht zijn weg, maar behoud ALTIJD het inhoudelijke punt (wat er mis is en waarom). Levert weghalen een onvolledige zin op (bv. "de wethouder is een sukkel" → "de wethouder is een"), herschrijf dan minimaal tot een korte, neutrale weergave (bv. → "kritiek op hoe de wethouder zijn werk doet"). Laat sterke maar niet-beledigende woorden over een SITUATIE staan (bv. "belachelijk", "schandalig").
4. Neem overdreven toon weg, maar verzwak NIET hoe ernstig iets is.
Geef ALLEEN de opgeschoonde tekst terug. Geen aanhalingstekens, geen uitleg.`,
  en: `You lightly clean ONE feedback message. Personal data is already removed and shown as bracketed markers — leave those EXACTLY as they are, do not change or remove them and do not add new ones.
Do only this, in the same language, preserving meaning:
1. Replace any remaining PERSON's name with "someone" (or a role, e.g. "the manager").
2. PLACES: keep municipality, district, neighbourhood, organisation and company names. GENERALISE fine-grained locations that point to a specific person or home: replace a street + house number or exact address with the neighbourhood (e.g. "12 Church Street" → "in that neighbourhood"), and remove house numbers, postcodes and exact coordinates. A public place or institution (e.g. "the town hall", "the station") stays.
3. Remove profanity/insults aimed at a PERSON, but ALWAYS keep the substantive point (what is wrong and why). If removal leaves an incomplete sentence (e.g. "the alderman is an idiot" → "the alderman is an"), rephrase minimally into a short, neutral statement (e.g. → "criticism of how the alderman does the job"). Keep strong but non-insulting words about a SITUATION (e.g. "ridiculous", "outrageous").
4. Remove over-the-top tone, but do NOT downplay how serious something is.
Return ONLY the cleaned text. No quotes, no notes.`,
};

// Label: one object per message; the parser also falls back to array order, so a
// missing "i" no longer collapses everything to "general".
export const MINIMAL_LABEL = `You triage a numbered list of feedback messages (Dutch and English). Return ONLY a JSON array, one object per message, in order:
{"i":<number>,"domain":"<2-4 word English topic>","signal":"<crisis|safety|abuse|harassment|medical-emergency|integrity|discrimination|retaliation|none>","severity":"<high|medium|low>","sensitive":<true|false>}
- domain: group messages about the same subject under the SAME short label (e.g. "care waiting times", "workload", "parking", "pay").
- "crisis" ONLY for self-harm or suicidal thoughts; otherwise "none".
- sensitive: true if it contains special-category personal data (health, sexual, financial-personal, religion/ethnicity) or could re-identify someone.
No prose, no code fences — just the JSON array.`;

// Summarize: caller appends "Write the summary in <lang>."
export const MINIMAL_SUMMARIZE = `Summarise these feedback messages — all about the same topic — into a few short bullets. Merge duplicates and near-duplicates (including across Dutch and English) into ONE bullet each; keep genuinely different points separate. Invent nothing and add no names. Output ONLY bullets, each starting with "- ".`;
