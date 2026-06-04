// Task 1 — per-participant orchestration (build proposal §4), the decision-free core.
//
// Per raw message: floorMessage() (deterministic floors + detection, client-side)
// → LLM clean nuance → cleaned text. Then dedup the participant's cleaned messages
// into a POINT LIST (the distinct points they raised). Serious-flagged messages are
// surfaced separately for the SIGNAL-SPOOR offer (destination/opt-in deferred to
// decisions D3/D4). Attacks are rejected.
//
// What this core does NOT do (needs the surrounding system / open decisions):
//   • the per-message review touchpoint (D2) and the per-point consent UI
//   • writing approved points to the central pod (consent = the write action)
//   • the signal-spoor destination + opt-in routing (D3/D4)
// It returns exactly the data those steps consume.

import { floorMessage } from './floors/index.js';
import { cleanMessage, summarize } from './pipeline.js';

/** Does an on-device (Layer-1) signal ACT as an escalation for this project?
 *  Only if Layer-1 is enabled AND the detected category is in the project's
 *  escalation list. Otherwise the message stays a normal point (Layer-2, the
 *  server-side LLM pass in Task 2, remains the reliable backstop). */
export function escalates(signal, { layer1OnDevice = true, escalationCategories = null } = {}) {
  if (!signal || !layer1OnDevice) return false;
  return !escalationCategories || escalationCategories.includes(signal.category);
}

/** Parse a summarised bullet list into structured, addressable points. */
export function parsePoints(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•]\s*\S/.test(l))
    .map((l, i) => ({ id: `p${i + 1}`, text: l.replace(/^[-•]\s*/, '').trim() }));
}

/**
 * Run Task 1 for ONE participant's raw messages.
 * @param {string} model
 * @param {string[]} rawMessages
 * @param {{ userDefault?:'nl'|'en', lang?:'nl'|'en' }} [opts]
 * @returns {Promise<{
 *   perMessage: Array<{raw,cleaned,lang,signal,sensitive,flags,hits}>,
 *   points: Array<{id,text}>,     // deduped non-signal points → consent → central pod
 *   signals: Array<object>,       // escalation-flagged → signal-spoor offer (D3/D4)
 *   rejected: Array<{raw,reason}>,
 *   lang: 'nl'|'en',
 * }>}
 */
export async function runTask1(model, rawMessages, opts = {}) {
  const userDefault = opts.userDefault || opts.lang;
  // Layer-1 (on-device) signal handling is per-project (ProjectConfig.signal):
  // provisional/off by default in a config, but ON by default for a direct call.
  const gate = { layer1OnDevice: opts.layer1OnDevice ?? true, escalationCategories: opts.escalationCategories || null };
  const perMessage = [], rejected = [], signals = [];

  for (const raw of rawMessages) {
    const fm = floorMessage(raw, { userDefault });
    if (fm.reject) { rejected.push({ raw, reason: fm.reject }); continue; }
    const c = await cleanMessage(model, raw, { ...opts, userLang: fm.lang });
    const rec = {
      raw, cleaned: c.cleaned ?? `⚠ ${c.error}`, lang: c.lang || fm.lang,
      signal: fm.signal, sensitive: fm.sensitive, flags: fm.flags,
      escalated: escalates(fm.signal, gate),
      hits: (c.hits || []).map((h) => h.type),
    };
    perMessage.push(rec);
    if (rec.escalated) signals.push(rec);   // → signal-spoor offer (opt-in, D3/D4)
  }

  // The point list (→ central pod, statistical track) is built from the messages NOT
  // escalated on-device: serious individual incidents go to the signal-spoor, not the
  // anonymous aggregate. (When Layer-1 is off, nothing escalates here — Layer-2 in
  // Task 2 catches it.) Whether a signal ALSO enters the aggregate is a deferred decision.
  const regular = perMessage.filter((m) => !m.escalated);
  const lang = opts.lang || regular[0]?.lang || perMessage[0]?.lang || 'nl';
  let points = [];
  if (regular.length === 1) {
    points = parsePoints('- ' + regular[0].cleaned);
  } else if (regular.length > 1) {
    const s = await summarize(model, regular.map((m) => m.cleaned), { ...opts, lang });
    points = parsePoints(s.ok ? s.text : regular.map((m) => '- ' + m.cleaned).join('\n'));
  }

  return { perMessage, points, signals, rejected, lang };
}
