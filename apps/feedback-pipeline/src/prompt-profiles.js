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
2. Haal scheldwoorden/beledigingen weg; behoud het punt.
3. Neem overdreven toon weg, maar verzwak NIET hoe ernstig iets is.
Geef ALLEEN de opgeschoonde tekst terug. Geen aanhalingstekens, geen uitleg.`,
  en: `You lightly clean ONE feedback message. Personal data is already removed and shown as bracketed markers — leave those EXACTLY as they are, do not change or remove them and do not add new ones.
Do only this, in the same language, preserving meaning:
1. Replace any remaining PERSON's name with "someone" (or a role, e.g. "the manager"). Keep organisation, company and place names.
2. Remove profanity/insults; keep the point.
3. Remove over-the-top tone, but do NOT downplay how serious something is.
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
