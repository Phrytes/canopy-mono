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
import { summarize, cleanMessage, translate } from './pipeline.js';
import { PREFERRED_LANGUAGE } from './config.js';

function blankLabels(n) {
  return Array.from({ length: n }, () => ({ domain: 'general', signal: 'none', severity: 'low' }));
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
  for (const e of arr) {
    const i = (Number(e.i) | 0) - 1;
    if (i >= 0 && i < n) {
      out[i] = {
        domain:   String(e.domain ?? 'general').trim() || 'general',
        signal:   ['crisis', 'child-safety', 'safety', 'medical-emergency', 'abuse', 'harassment', 'integrity', 'discrimination', 'retaliation', 'none'].includes(e.signal) ? e.signal : 'none',
        severity: ['high', 'medium', 'low'].includes(e.severity) ? e.severity : 'low',
      };
    }
  }
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
export async function labelMessages(model, messages, opts = {}) {
  const labels = [];
  for (let start = 0; start < messages.length; start += LABEL_CHUNK) {
    const chunk = messages.slice(start, start + LABEL_CHUNK);
    const user = chunk.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const numPredict = Math.min(2048, Math.max(384, chunk.length * 80));
    const r = await chat(model, LABEL_SYSTEM, user, { ...opts, numPredict });
    labels.push(...(r.ok ? parseLabels(r.text, chunk.length) : blankLabels(chunk.length)));
  }
  // Deterministic CATEGORY floors OVERRIDE the model (precedence + crisis-
  // reservation in categories.js). A floor pins the category and routing.
  return labels.map((l, i) => {
    const esc = escalationCategory(messages[i]);
    if (esc) return { ...l, signal: esc.category, severity: 'high', via: esc.via };
    // CRISIS-RESERVATION in code: the LLM alone may NOT assert "crisis" (the
    // 113-grade category). Without a crisis-lexicon hit its guess is downgraded —
    // parking complaints were being LLM-labelled crisis (civic precision). Other
    // LLM-only escalations stay (a recall backstop), flagged via:'LLM'/confirmed:false.
    if (l.signal === 'crisis') return { ...l, signal: 'none' };
    return l;
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
