// Specialized clean passes (refactor). Each is a NARROW, single-purpose LLM
// step with a deterministic floor and a faithfulness self-check, so a failure
// in one concern doesn't corrupt the others (the lesson from the stress test,
// where one overloaded prompt would occasionally restructure/mislabel/leak).
//
//   identifierPass — remove leftover names, generalize "only-X", redact
//                    disguised PII (never reconstruct)
//   decursePass    — remove swearing/insults only; deterministic profanity
//                    floor guarantees a fixed set is gone even if the LLM misses
//
// Tokens are shielded around each call so they survive verbatim.

import { chat } from './ollama.js';
import { shield, unshield, sample, pairsToTurns } from './util.js';
import { IDENTIFIER_SYSTEM, IDENTIFIER_EXAMPLE_POOL, DECURSE_SYSTEM, DECURSE_EXAMPLE_POOL } from './prompts.js';
import { decurseDeterministic } from './decurse.js';

// Self-check: did the pass diverge wildly (hallucination / full rewrite)?
// A single-purpose edit should be close in length to its input.
function tooDivergent(before, after) {
  if (!after || !after.trim()) return true;
  const a = after.length, b = before.length || 1;
  return a > b * 1.8 || a < b * 0.4;
}

// Brackets are RESERVED for system placeholders. The identifier LLM sometimes
// INVENTS its own tag for a removed name ("[bystander1]", "[person]") instead of
// using "iemand"/"someone" (a stress-test residual). Collapse any bracket token
// that isn't one of ours to the neutral pronoun — deterministic floor under the
// prompt instruction.
const KNOWN_TOKENS = new Set([
  'telefoonnummer', 'telefoon', 'e-mailadres', 'email', 'e-mail', 'mail', 'adres',
  'postcode', 'iban', 'url', 'datum', 'dossiernummer', 'dossier', 'zaaknummer', 'bsn', 'naam',
]);
export function normalizeUnknownTokens(text, lang) {
  return text.replace(/\[([^[\]]+)\]/g, (m, inner) =>
    KNOWN_TOKENS.has(inner.trim().toLowerCase()) ? m : (lang === 'en' ? 'someone' : 'iemand'));
}

/** Names + self-identification + leftover/disguised PII. Floor: return input on error/drift. */
export async function identifierPass(model, text, lang, opts = {}) {
  const { shielded, map } = shield(text);
  const examples = pairsToTurns(sample(IDENTIFIER_EXAMPLE_POOL[lang] || IDENTIFIER_EXAMPLE_POOL.nl, 2));
  const r = await chat(model, IDENTIFIER_SYSTEM[lang] || IDENTIFIER_SYSTEM.nl, shielded, { examples, ...opts });
  let out = r.ok ? unshield(r.text, map) : text;
  if (tooDivergent(text, out)) out = text;
  out = normalizeUnknownTokens(out, lang);  // floor: no invented [bystander1] tokens
  return { text: out, ms: r.ms, error: r.ok ? null : r.error };
}

/** Swearing/insults only. Floors: faithfulness self-check + deterministic profanity sweep. */
export async function decursePass(model, text, lang, opts = {}) {
  const { shielded, map } = shield(text);
  const examples = pairsToTurns(sample(DECURSE_EXAMPLE_POOL[lang] || DECURSE_EXAMPLE_POOL.nl, 1));
  const r = await chat(model, DECURSE_SYSTEM[lang] || DECURSE_SYSTEM.nl, shielded, { examples, ...opts });
  let out = r.ok ? unshield(r.text, map) : text;
  if (tooDivergent(text, out)) out = text;
  out = decurseDeterministic(out).text;   // guarantee: known profanity is gone
  return { text: out, ms: r.ms, error: r.ok ? null : r.error };
}
