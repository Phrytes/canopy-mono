// Triage-then-summarize: the set-summarization flow that (1) pulls serious
// single-incident SIGNALS out before aggregation so they can't be diluted
// away, and (2) labels each remaining message with a domain and summarizes
// PER DOMAIN (a narrower dedup task → less cross-topic over-merging).
//
//   batch
//    ├─ stage 1  labelMessages(): one LLM call → {domain, signal, severity}
//    │           + deterministic crisis override (src/signals.js)
//    ├─ split    signals (crisis | safety | high integrity) vs regular
//    └─ stage 2  summarize() per domain group
//   → { signals, summaryByDomain, labels }

import { escalationCategory, ESCALATION_CATEGORIES } from './categories.js';
import { chat } from './ollama.js';
import { LABEL_SYSTEM } from './prompts.js';
import { profileFor, MINIMAL_LABEL, thinkingFor } from './prompt-profiles.js';
import { summarize, cleanMessage, translate } from './pipeline.js';
import { PREFERRED_LANGUAGE } from './config.js';

function blankLabels(n) {
  return Array.from({ length: n }, () => ({ domain: 'general', signal: 'none', severity: 'low', sensitive: false }));
}

/** Tolerant parse of the label pass: full-array parse, else recover individual
 *  objects (so a TRUNCATED label output doesn't collapse every domain to
 *  "general" — the cause of the B `general:16` bug). */
function parseLabels(text, n) {
  const out = blankLabels(n);
  let arr = [];
  try {
    const a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a >= 0 && b > a) arr = JSON.parse(text.slice(a, b + 1));
  } catch { /* fall through */ }
  if (!arr.length) {
    for (const o of text.match(/\{[^{}]*\}/g) || []) { try { arr.push(JSON.parse(o)); } catch { /* skip */ } }
  }
  arr.forEach((e, idx) => {
    // POSITIONAL FALLBACK: if the model omits/misnumbers "i", use the array order
    // instead of dropping the object to the "general" default (the collapse bug).
    const raw = Number(e?.i);
    const i = Number.isFinite(raw) ? raw - 1 : idx;
    if (i >= 0 && i < n) {
      out[i] = {
        domain:   String(e.domain ?? 'general').trim() || 'general',
        signal:   ['crisis', 'child-safety', 'safety', 'medical-emergency', 'abuse', 'harassment', 'integrity', 'discrimination', 'retaliation', 'none'].includes(e.signal) ? e.signal : 'none',
        severity: ['high', 'medium', 'low'].includes(e.severity) ? e.severity : 'low',
        sensitive: e.sensitive === true || e.sensitive === 'true',
      };
    }
  });
  return out;
}

/** A message is routed to the signal track (not aggregated) if it's a serious
 *  incident. After the stress test, integrity at ANY severity routes (a single
 *  harassment/fraud report must not be aggregated then dropped). */
export function isSignal(label) {
  return ESCALATION_CATEGORIES.includes(label.signal) || label.signal === 'integrity';
}

/** Label every message; the deterministic crisis lexicon overrides the model.
 *  Labels in small CHUNKS: one big call over ~25 msgs emits ~1900 tokens of
 *  JSON and timed out on CPU (→ blankLabels → every domain collapsed to
 *  "general", the B bug). Chunked calls each stay well under the timeout and
 *  parse cleanly; indices are local per chunk, reassembled in order. */
const LABEL_CHUNK = 8;
// `rawMessages` (optional, aligned to `messages`) is the ORIGINAL text the deterministic
// escalation floors must run on — cleaning (esp. the minimal "neutralise tone" pass) can
// erase the lexical triggers a crisis/safety/fraud lexicon matches, so detecting signals on
// the cleaned text silently drops them (a suicidal message → aggregated as feedback).
export async function labelMessages(model, messages, opts = {}, rawMessages = null) {
  const minimal = profileFor(model, opts) === 'minimal';
  const system = minimal ? MINIMAL_LABEL : LABEL_SYSTEM;
  const labels = [];
  for (let start = 0; start < messages.length; start += LABEL_CHUNK) {
    const chunk = messages.slice(start, start + LABEL_CHUNK);
    const user = chunk.map((m, i) => `${i + 1}. ${m}`).join('\n');
    // reasoning models burn tokens BEFORE the JSON → give minimal more headroom.
    const numPredict = Math.min(4096, Math.max(minimal ? 768 : 384, chunk.length * (minimal ? 160 : 80)));
    const r = await chat(model, system, user, { ...opts, numPredict, thinking: thinkingFor('label', opts) });
    labels.push(...(r.ok ? parseLabels(r.text, chunk.length) : blankLabels(chunk.length)));
  }
  // Deterministic CATEGORY floors OVERRIDE the model (precedence + crisis-
  // reservation in categories.js). A floor pins the category and routing.
  const forFloor = rawMessages || messages;   // detect on RAW; cleaning can erase signals
  return labels.map((l, i) => {
    const esc = escalationCategory(forFloor[i]);             // deterministic floor on RAW
    const detCat = esc?.category || null;
    const llmCat = l.signal && l.signal !== 'none' ? l.signal : null;
    const detCrisis = detCat === 'crisis';
    const llmCrisis = llmCat === 'crisis';

    // CRISIS (113-grade) = deterministic AND llm. Exactly one side → "possible-crisis":
    // routed for human review (never dropped), but not auto-categorised crisis.
    if (detCrisis && llmCrisis) return { ...l, signal: 'crisis', severity: 'high', via: esc.via, confirmed: true };
    if (detCrisis || llmCrisis) return { ...l, signal: 'possible-crisis', severity: 'high', via: detCrisis ? esc.via : 'LLM', confirmed: false };

    // OTHER signals = deterministic OR llm (either is enough). Floor-confirmed when the
    // deterministic lexicon fired (via set); llm-only otherwise (confirmed:false).
    if (detCat) return { ...l, signal: detCat, severity: 'high', via: esc.via, confirmed: true };
    if (llmCat) return { ...l, signal: llmCat, confirmed: false };
    return { ...l, signal: 'none', confirmed: false };
  });
}

// Merge near-duplicate domain labels before the k-threshold, so it sees "safety"
// as ONE theme rather than safety / personal-safety / transport-safety (every
// model produced this split → empty statistical track). Conservative: only
// genuine synonyms merge; unrelated labels pass through normalised (lowercased,
// hyphens→spaces) so "Safety" and "safety_" also unify.
const DOMAIN_SYNONYMS = [
  ['safety', /^(personal|public|road|traffic|street|pedestrian|transport|verkeers?|dangerous)?[\s_-]*(safety|crossing|veiligheid)$/],
  ['waiting times', /^(care|ggz|zorg)?[\s_-]*(waiting[\s_-]?times?|wait[\s_-]?lists?|wachttijd(en)?|wachtlijst(en)?)$/],
];
export function canonicalDomain(d) {
  const s = String(d ?? 'general').toLowerCase().trim().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  for (const [canon, re] of DOMAIN_SYNONYMS) if (re.test(s)) return canon;
  return s;
}

/**
 * Full triage: split out signals, then summarize the rest per domain.
 * @returns {Promise<{ signals: Array, summaryByDomain: Object, labels: Array }>}
 */
export async function triageSummarize(model, messages, opts = {}) {
  const labels = await labelMessages(model, messages, opts);

  const signals = [];
  const byDomain = {};
  messages.forEach((m, i) => {
    const l = labels[i];
    if (isSignal(l)) {
      signals.push({ message: m, signal: l.signal, severity: l.severity, via: l.via || 'LLM', confirmed: !!l.via });
    } else {
      (byDomain[l.domain] ||= []).push(m);
    }
  });

  const summaryByDomain = {};
  for (const [domain, msgs] of Object.entries(byDomain)) {
    // A single-message domain doesn't need an LLM round-trip.
    if (msgs.length === 1) { summaryByDomain[domain] = `- ${msgs[0]}`; continue; }
    const s = await summarize(model, msgs, opts);
    summaryByDomain[domain] = s.ok ? s.text : `⚠ ${s.error}`;
  }

  return { signals, summaryByDomain, labels };
}

/**
 * FULL pipeline: raw messages → clean each → triage the CLEANED set →
 * per-domain summaries. Signal detection runs on the RAW text (most faithful);
 * serious incidents are routed out (carrying their raw text, for the human
 * responder) and the rest are cleaned and summarized per domain.
 *
 * @returns {Promise<{ signals, perMessage, summaryByDomain, labels }>}
 */
export async function fullPipeline(model, rawMessages, opts = {}) {
  const labels = await labelMessages(model, rawMessages, opts);

  const signals = [];
  const regular = []; // { i, raw, domain }
  rawMessages.forEach((raw, i) => {
    const l = labels[i];
    if (isSignal(l)) {
      signals.push({ raw, signal: l.signal, severity: l.severity, via: l.via || 'LLM', confirmed: !!l.via });
    } else {
      regular.push({ i, raw, domain: l.domain });
    }
  });

  // Clean each regular message (step 1 + 2), then translate to the project's
  // preferred language so summaries are single-language and dedup compares
  // like with like.
  const lang = opts.lang || PREFERRED_LANGUAGE;
  const perMessage = [];
  for (const r of regular) {
    const c = await cleanMessage(model, r.raw, opts);
    const cleaned = c.cleaned ?? `⚠ ${c.error}`;
    const translated = (c.cleaned && c.lang !== lang)
      ? await translate(model, cleaned, lang, opts)
      : cleaned;
    perMessage.push({ raw: r.raw, cleaned, translated, lang: c.lang, domain: r.domain, hits: c.hits.map((h) => h.type) });
  }

  // Group TRANSLATED messages by domain and summarize each group (in `lang`).
  const byDomain = {};
  for (const m of perMessage) (byDomain[m.domain] ||= []).push(m.translated);
  const summaryByDomain = {};
  for (const [domain, msgs] of Object.entries(byDomain)) {
    if (msgs.length === 1) { summaryByDomain[domain] = `- ${msgs[0]}`; continue; }
    const s = await summarize(model, msgs, { ...opts, lang });
    summaryByDomain[domain] = s.ok ? s.text : `⚠ ${s.error}`;
  }

  return { signals, perMessage, summaryByDomain, labels };
}
