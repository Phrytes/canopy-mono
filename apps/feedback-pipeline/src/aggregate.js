// Step 5 aggregation with a k-anonymity threshold (commerciele_verkenning.md):
// "een patroon, citaat of thema verschijnt pas in de output als minimaal N
// (instelbaar, typisch 4-7) verschillende gebruikers er onafhankelijk aan
// hebben bijgedragen. Onder die drempel: data wordt verwijderd."
//
// Two tracks come out:
//   • statistical — themes raised by ≥ k DISTINCT users (translated to the
//     project language, then summarized). Below-threshold themes are DROPPED
//     (only their counts are kept, for the transparency report).
//   • signal — serious single incidents (crisis / safety / high integrity).
//     No threshold: one report is enough (the signaal-spoor).
//
// Step 4 (co-redactie) is assumed AUTO-APPROVED here — the user agrees with
// their filtered messages, so the cleaned text goes straight to aggregation.

import { cleanMessage, translate, summarize } from './pipeline.js';
import { labelMessages, canonicalDomain } from './triage.js';
import { isSensitiveDomain, detectReident, detectSensitiveContent, detectContactRequest, sensitivityFlags } from './signals.js';
import { sensitiveCategory, rejectReason, ESCALATION_CATEGORIES } from './categories.js';
import { PREFERRED_LANGUAGE } from './config.js';

/** Layer-2 (server-side) signal routing gate. An LLM-labelled escalation routes to
 *  the signal track only if the project enables that category; a floor-confirmed
 *  signal (`via` set) always routes (the deterministic guarantee). `integrity` is a
 *  sensitive singleton that is always pulled out, not subject to the project filter. */
export function routesToSignalLabel(label, escalationCategories = null) {
  if (!label) return false;
  if (label.signal === 'integrity') return true;
  if (!ESCALATION_CATEGORIES.includes(label.signal)) return false;
  if (label.via) return true;                                       // floor-confirmed
  return !escalationCategories || escalationCategories.includes(label.signal);
}

/**
 * Pure: split domain groups into those meeting the k-threshold and those
 * dropped. `groups` is { theme: { users:Set<string>, msgs:[] } }.
 */
export function partitionByThreshold(groups, k) {
  const meeting = [], dropped = [];
  for (const [theme, g] of Object.entries(groups)) {
    const userCount = g.users instanceof Set ? g.users.size : g.users;
    const entry = { theme, userCount, messageCount: g.msgs?.length ?? g.messageCount ?? 0 };
    (userCount >= k ? meeting : dropped).push(entry);
  }
  // most-supported themes first
  meeting.sort((a, b) => b.userCount - a.userCount);
  dropped.sort((a, b) => b.userCount - a.userCount);
  return { meeting, dropped };
}

/**
 * @param {string} model
 * @param {Array<{user:string, text:string, lang?:string}>} items
 * @param {{ kThreshold?:number, lang?:string }} [opts]
 */
export async function aggregateWithThreshold(model, items, opts = {}) {
  const k = opts.kThreshold ?? 3;
  const lang = opts.lang || PREFERRED_LANGUAGE;
  const escCats = opts.escalationCategories || null;          // D3 — Layer-2 escalation filter
  const belowThreshold = opts.belowThreshold || 'drop';       // D5 — drop | quarantine | rephrase

  // step 2.5 — reject prompt-injection / exfiltration attempts BEFORE cleaning
  // (they are attacks, not feedback). step 3 — clean the rest.
  const rejected = [];
  const cleaned = [];
  // optional per-message routing trace (for scoring), aligned to `items`.
  const trace = opts.trace
    ? items.map((it) => ({ user: it.user, raw: it.text, track: null, theme: null, signal: null, cleaned: null }))
    : null;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const reason = rejectReason(it.text);
    if (reason) {
      rejected.push({ user: it.user, reason });
      if (trace) { trace[idx].track = 'rejected'; trace[idx].reason = reason; }
      continue;
    }
    // skipClean: the items are already cleaned + CONSENTED (e.g. from the central
    // pod) — do not re-edit them, only label + aggregate.
    const c = opts.skipClean
      ? { cleaned: it.text, lang: it.lang || lang, hits: [] }
      : await cleanMessage(model, it.text, { userLang: it.lang, ...opts });
    cleaned.push({ user: it.user, raw: it.text, text: c.cleaned ?? `⚠ ${c.error}`, lang: c.lang, hits: (c.hits || []).map((h) => h.type), _idx: idx });
  }

  // step 5a — label cleaned messages (LLM + deterministic crisis/safety nets).
  const labels = await labelMessages(model, cleaned.map((c) => c.text), opts);

  const signals = [];
  const contact = [];        // refinement A — PII-only "contact me" messages
  const groups = {};         // theme -> { users:Set, msgs:[], sensitive }
  cleaned.forEach((c, i) => {
    const l = labels[i];
    const sensitiveMsg = detectReident(c.raw).isReident || detectSensitiveContent(c.raw).isSensitive || !!sensitiveCategory(c.raw);
    if (routesToSignalLabel(l, escCats)) {
      signals.push({
        user: c.user, text: c.text, signal: l.signal, severity: l.severity,
        via: l.via || 'LLM',
        // confirmed = a deterministic lexicon floor fired (vs an LLM-only guess,
        // which is noisier — B showed dubious medical-emergency/abuse via LLM).
        // Both still route to the signal track; the human triages by this flag.
        confirmed: !!l.via,
      });
      if (trace) { const t = trace[c._idx]; t.track = 'signal'; t.signal = l.signal; t.cleaned = c.text; }
      return;
    }
    // Refinement A — a "contact me" message that carries PII but no real
    // allegation: don't fold it into a statistical theme (it inflated `fraud`).
    const hasPII = c.hits.some((t) => t === 'phone' || t === 'email' || t === 'bsn');
    if (!sensitiveMsg && hasPII && detectContactRequest(c.raw).isContact) {
      contact.push({ user: c.user, text: c.text });
      if (trace) { const t = trace[c._idx]; t.track = 'contact'; t.cleaned = c.text; }
      return;
    }
    // Otherwise group; sensitivity is decided by DETERMINISTIC detectors on the
    // RAW text, not the LLM's (sometimes wrong) domain label.
    const dom = canonicalDomain(l.domain);
    const g = (groups[dom] ||= { users: new Set(), msgs: [], sensitive: false });
    g.users.add(c.user);
    g.msgs.push(c);
    if (sensitiveMsg) g.sensitive = true;
    if (trace) { const t = trace[c._idx]; t.theme = dom; t.cleaned = c.text; }
  });

  // step 5b — apply the k-anonymity threshold.
  const { meeting, dropped: belowK } = partitionByThreshold(groups, k);

  // FIX #1 (hardened) — never delete a SENSITIVE below-threshold theme:
  // quarantine it to a human-review queue (with its messages). Sensitivity =
  // sensitive domain OR a deterministic content/re-id hit on any message.
  // D5 below-threshold policy: a SENSITIVE below-k theme is ALWAYS quarantined (the
  // never-silently-drop guarantee). For a NON-sensitive theme the project policy
  // decides: 'drop' (default) discards it; 'quarantine'/'rephrase' send it to review.
  // ('rephrase'-until-untraceable is not yet implemented — treated as quarantine. TODO.)
  const review = [], dropped = [];
  for (const d of belowK) {
    const g = groups[d.theme];
    const byDomain = isSensitiveDomain(d.theme);
    if (byDomain || g.sensitive || belowThreshold === 'quarantine' || belowThreshold === 'rephrase') {
      // Refinement B — re-label by DETECTED sensitivity and attach per-message
      // flags so a soft/wrong theme label ("workload") doesn't lull the human
      // reviewer. The flags are DERIVED from the raw text, but the raw text is
      // deliberately NOT included in the output — raw stays in the user's pod
      // (no central store of identifiable data); a reviewer pulls the original
      // from the source under protocol if needed (4th-audit decision).
      const messages = g.msgs.map((m) => ({ user: m.user, text: m.text, flags: sensitivityFlags(m.raw) }));
      const detected = [...new Set(messages.flatMap((m) => m.flags))];
      review.push({ theme: d.theme, userCount: d.userCount, messageCount: d.messageCount, via: byDomain ? 'domain' : 'content/re-id', detected, messages });
      if (trace) for (const m of g.msgs) trace[m._idx].track = 'review';
    } else {
      dropped.push(d);
      if (trace) for (const m of g.msgs) trace[m._idx].track = 'dropped';
    }
  }

  // step 6 (statistical track only) — translate to `lang`, then summarize.
  const statistical = [];
  for (const m of meeting) {
    const g = groups[m.theme];
    if (trace) for (const msg of g.msgs) trace[msg._idx].track = 'statistical';
    const translated = [];
    for (const msg of g.msgs) translated.push(msg.lang === lang ? msg.text : await translate(model, msg.text, lang, opts));
    const summary = translated.length === 1
      ? `- ${translated[0]}`
      : ((await summarize(model, translated, { lang, ...opts })).text || '');
    statistical.push({ ...m, summary });
  }

  return {
    statistical, signals, review, contact, rejected, dropped,
    kThreshold: k, lang,
    totalUsers: new Set(items.map((i) => i.user)).size,
    totalMessages: items.length,
    ...(trace ? { trace } : {}),
  };
}
