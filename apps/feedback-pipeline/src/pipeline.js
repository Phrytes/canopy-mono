// Glue for the 3-step local filter pipeline:
//   step 1  redact()        — deterministic regex (./redact.js)
//   step 2  cleanMessage()  — LLM removes names + profanity (./prompts.js)
//   step 3  summarize()     — LLM merges duplicates across messages
//
// Pure orchestration; all model I/O goes through ./ollama.js. The smoke
// scripts in ../scripts use these three functions.

import { redact } from './redact.js';
import { redactNames } from './names.js';
import { resolveLang } from './lang.js';
import { chat } from './ollama.js';
import { SUMMARIZE_SYSTEM, SUMMARIZE_EXAMPLE_POOL } from './prompts.js';
import { identifierPass, decursePass } from './passes.js';
import { sample, pairsToTurns, shield, unshield } from './util.js';
import { PREFERRED_LANGUAGE, langName } from './config.js';

/**
 * Step 1 (structured regex) + 1b (name gazetteer) + 2 (LLM) for one message.
 * Structured redaction runs first so the name pass skips [tokens]. Language
 * is resolved from the RAW text (most signal) + an optional per-user default,
 * then routed to a monolingual prompt.
 *
 * @param {string} model
 * @param {string} rawText
 * @param {{ userLang?:'nl'|'en' }} [opts]
 * @returns {Promise<{raw, redacted, hits, lang, langSource, cleaned:?string, error:?string, ms:number}>}
 */
export async function cleanMessage(model, rawText, opts = {}) {
  const { userLang, ...rest } = opts;
  // PII pass + name gazetteer (deterministic floors).
  const structured = redact(rawText);
  const named = redactNames(structured.text);
  const redacted = named.text;
  const hits = [...structured.hits, ...named.hits];
  const { lang, source } = resolveLang({ text: rawText, userDefault: userLang });
  // Specialized LLM passes (each narrow, shielded, self-checked).
  const id = await identifierPass(model, redacted, lang, rest);   // names + only-X + leftover PII
  const dc = await decursePass(model, id.text, lang, rest);       // swearing only + profanity floor
  return {
    raw:        rawText,
    redacted,
    hits,
    lang,
    langSource: source,
    cleaned:    dc.text,
    error:      id.error || dc.error || null,
    ms:         (id.ms || 0) + (dc.ms || 0),
  };
}

/**
 * Step 3 over a set of (already cleaned) messages.
 * @returns {Promise<{ok:boolean, text:?string, error:?string, ms:number}>}
 */
export async function summarize(model, messages, opts = {}) {
  const lang = opts.lang || PREFERRED_LANGUAGE;
  const system = `${SUMMARIZE_SYSTEM}\n\nWrite the summary in ${langName(lang)}.`;
  const user = messages.map((m, i) => `${i + 1}. ${m}`).join('\n');
  const { shielded, map } = shield(user);                       // protect [tokens] from rewording
  const pool = SUMMARIZE_EXAMPLE_POOL[lang] || SUMMARIZE_EXAMPLE_POOL.nl;
  const examples = pairsToTurns(sample(pool, 1));               // rotated, in target language
  const r = await chat(model, system, shielded, { examples, ...opts });
  const text = r.ok ? unshield(r.text, map) : null;
  return { ok: r.ok, text, error: r.ok ? null : r.error, ms: r.ms };
}

/**
 * Translate text to a target language, protecting [tokens] via shielding so
 * they survive verbatim. Falls back to the original text on error.
 */
export async function translate(model, text, targetLang, opts = {}) {
  if (!text || !text.trim()) return text;
  const { shielded, map } = shield(text);
  const system = `Translate the user's message into ${langName(targetLang)}. Keep any [[number]] markers and any numbers exactly as they are. Do not add or remove information. Output only the translation, no preamble or quotes.`;
  const r = await chat(model, system, shielded, opts);
  return r.ok ? unshield(r.text.trim(), map) : text;
}

/**
 * Full pipeline: clean every message, then summarize the cleaned set.
 */
export async function runPipeline(messages, { cleanModel, summarizeModel, ...opts } = {}) {
  const cleaned = [];
  for (const m of messages) cleaned.push(await cleanMessage(cleanModel, m, opts));
  const cleanedTexts = cleaned.map((c) => c.cleaned).filter(Boolean);
  const summary = await summarize(summarizeModel, cleanedTexts, opts);
  return { cleaned, summary };
}

// Structured tokens the LLM must keep verbatim. [naam] is intentionally
// EXCLUDED: name handling is allowed to vary (keep [naam], or turn it into
// "iemand"/a role), so penalising that as a "drop" was a measurement bug.
const STRUCTURED_TOKEN = /\[(?:telefoonnummer|e-mailadres|rekeningnummer|postcode|adres|link)\]/g;

/** Did the LLM preserve every STRUCTURED [token] the regex produced? */
export function placeholdersPreserved(redacted, cleaned) {
  if (!cleaned) return false;
  const tokens = redacted.match(STRUCTURED_TOKEN) || [];
  return tokens.every((t) => cleaned.includes(t));
}
