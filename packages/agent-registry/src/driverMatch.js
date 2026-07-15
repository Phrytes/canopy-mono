// Personal-drivers matcher (#4) — the ON-DEVICE engine. Your private drivers never leave the device;
// each device scores an incoming item's driver signature against its OWN drivers locally and surfaces
// the matches. No network, no new crypto (invariant #7); the deterministic layer needs no model at all.
//
// EXPLAINABILITY IS A HARD INVARIANT (Frits, 2026-07-15): a match may only be surfaced if it can state
// its reason in plain language. So there are exactly two match sources, both explainable:
//   1. tag overlap        → reason { kind:'tags', tags:[shared…] }   (deterministic, offline, no model)
//   2. an injected LLM     → reason { kind:'llm', text:'…' }          (semantic, only WHEN a judge is wired)
// A raw similarity score is NEVER a match reason on its own (that was the TF-IDF trap: unexplainable
// mismatches). TF-IDF, if ever added, may only PRE-FILTER candidates INTO the judge — never surface.
//
// Pure deterministic core + an optional async judge-aware wrapper. web ≡ mobile.

import { normalizeTags, driversFromProperties } from './drivers.js';

/**
 * A "driver signature" is what an item carries for matching: `{ text, tags[] }` (#5 puts it on
 * questions/tasks). Normalises to the same tag space as a driver so overlap is stable.
 * @param {{text?:string, tags?:string[]}} sig
 */
export function deriveSignature({ text = '', tags = [] } = {}) {
  return { text: String(text ?? '').trim(), tags: normalizeTags(tags) };
}

/**
 * Derive a driver signature FROM an item. An item that carries an explicit `driverSignature`
 * (#5 — questions/tasks author it) uses that; otherwise fall back to the item's own `{text, tags}`
 * (so a plain tagged post still matches). Returns a normalised `{text, tags}`.
 *
 * @param {{driverSignature?:object, text?:string, title?:string, tags?:string[]}} item
 */
export function itemSignature(item) {
  // Broadcast payloads carry these at the top level; a STORED item nests them under `source`. Accept both.
  const src = (item?.source && typeof item.source === 'object') ? item.source : {};
  const sig = item?.driverSignature ?? src.driverSignature;
  if (sig && typeof sig === 'object' && !Array.isArray(sig)) return deriveSignature(sig);
  // Fall back to the author's EXISTING tags — `tags`, or a post's `skillTags` / `requiredSkills`
  // (which already ride the broadcast) — so a normally-tagged post is matchable with no new field.
  const tags = [
    ...(Array.isArray(item?.tags) ? item.tags : []),
    ...(Array.isArray(item?.skillTags) ? item.skillTags : []),
    ...(Array.isArray(item?.requiredSkills) ? item.requiredSkills : []),
    ...(Array.isArray(src.skillTags) ? src.skillTags : []),
    ...(Array.isArray(src.requiredSkills) ? src.requiredSkills : []),
  ];
  return deriveSignature({ text: item?.text ?? item?.title ?? '', tags });
}

/**
 * Convenience bridge: match an item against the DRIVER properties held on a profile's property map
 * (pulls the drivers out with `driversFromProperties`, derives the item signature, then matches).
 * Deterministic when no `judge`; semantic when one is wired. This is the seam the app calls per
 * incoming feed item — the private drivers stay in the profile, on-device.
 *
 * @param {object} a
 * @param {Record<string, any>} a.properties   the profile's full property map
 * @param {object} a.item                       the incoming item (carries a driverSignature or text/tags)
 * @param {Function} [a.judge]                   optional injected LLM judge
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<object>>}
 */
export function matchProfileDrivers({ properties, item, judge, minShared = 1 } = {}) {
  return matchDriversSemantic({
    drivers: driversFromProperties(properties),
    signature: itemSignature(item),
    judge,
    minShared,
  });
}

/** The tags two tag-lists share (normalised inputs assumed), first-seen order of `a`. */
export function sharedTags(a = [], b = []) {
  const set = new Set(b);
  return a.filter((t) => set.has(t));
}

/** Jaccard overlap ∈ [0,1] over two tag sets — used ONLY to RANK explainable matches, never to gate. */
export function jaccard(a = [], b = []) {
  if (!a.length && !b.length) return 0;
  const A = new Set(a); const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Deterministic score of ONE driver against a signature. Returns a match ONLY when they share at
 * least `minShared` tags (the explainable signal); otherwise null. `score` (Jaccard) is for ranking.
 *
 * @param {{kind:string, text:string, tags:string[]}} driver
 * @param {{text:string, tags:string[]}} signature
 * @param {{minShared?:number}} [opts]
 * @returns {{kind:string, score:number, sharedTags:string[], reason:{kind:'tags',tags:string[]}}|null}
 */
export function scoreDriver(driver, signature, { minShared = 1 } = {}) {
  const shared = sharedTags(driver?.tags ?? [], signature?.tags ?? []);
  if (shared.length < minShared) return null;
  return {
    kind: driver?.kind ?? 'driver',
    score: jaccard(driver?.tags ?? [], signature?.tags ?? []),
    sharedTags: shared,
    reason: { kind: 'tags', tags: shared },
  };
}

/**
 * DETERMINISTIC on-device match: score every private driver against the item signature, keep the
 * explainable (tag-overlapping) ones, ranked by score desc. `drivers` is a `{ key → driverValue }`
 * map (as stored on the profile) OR an array of driver values.
 *
 * @param {object} a
 * @param {Record<string,object>|Array<object>} a.drivers
 * @param {{text?:string, tags?:string[]}} a.signature
 * @param {number} [a.minShared=1]
 * @returns {Array<{key:string|null, kind:string, score:number, sharedTags:string[], reason:object}>}
 */
export function matchDrivers({ drivers, signature, minShared = 1 } = {}) {
  const sig = deriveSignature(signature);
  const entries = Array.isArray(drivers)
    ? drivers.map((v, i) => [String(i), v])
    : Object.entries(drivers ?? {});
  const out = [];
  for (const [key, driver] of entries) {
    const m = scoreDriver(driver, sig, { minShared });
    if (m) out.push({ key: Array.isArray(drivers) ? null : key, ...m });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

/**
 * SEMANTIC on-device match: the deterministic matches PLUS, when an LLM `judge` is wired, the drivers
 * that DON'T share tags but the judge rules resonant (catching the synonyms tag-overlap misses). The
 * judge runs locally/privatemode/companion — the drivers still never leave a trusted environment.
 * Every judge match carries the judge's own reason, so the explainability invariant holds.
 *
 * `judge({ driver, signature })` resolves `{ match:boolean, reason?:string }`. A judge that throws (or
 * a missing judge) simply yields no semantic additions — the deterministic layer always stands.
 *
 * @param {object} a
 * @param {Record<string,object>|Array<object>} a.drivers
 * @param {{text?:string, tags?:string[]}} a.signature
 * @param {(x:{driver:object, signature:object})=>Promise<{match:boolean, reason?:string}>} [a.judge]
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<{key:string|null, kind:string, score:number, sharedTags:string[], reason:object}>>}
 */
export async function matchDriversSemantic({ drivers, signature, judge, minShared = 1 } = {}) {
  const sig = deriveSignature(signature);
  const isArray = Array.isArray(drivers);
  // One pass over a uniform [key, driver] list (arrays keyed by index → null in output, like matchDrivers).
  const entries = isArray
    ? drivers.map((v, i) => [i, v])
    : Object.entries(drivers ?? {});

  const tagMatches = [];
  const judgeCandidates = [];
  for (const [key, driver] of entries) {
    const outKey = isArray ? null : key;
    const shared = sharedTags(driver?.tags ?? [], sig.tags);
    if (shared.length >= minShared) {
      tagMatches.push({
        key: outKey, kind: driver?.kind ?? 'driver',
        score: jaccard(driver?.tags ?? [], sig.tags),
        sharedTags: shared, reason: { kind: 'tags', tags: shared },
      });
    } else {
      judgeCandidates.push([outKey, driver]);   // no tag overlap → only a judge can explain a match
    }
  }
  tagMatches.sort((x, y) => y.score - x.score);
  if (typeof judge !== 'function') return tagMatches;

  const semantic = [];
  for (const [outKey, driver] of judgeCandidates) {
    let verdict;
    try { verdict = await judge({ driver, signature: sig }); }
    catch { verdict = null; }   // a judge failure never removes the deterministic layer
    if (verdict?.match) {
      semantic.push({
        key: outKey, kind: driver?.kind ?? 'driver',
        score: 0,                              // no tag overlap → ranked below every tag match
        sharedTags: [],
        reason: { kind: 'llm', text: String(verdict.reason ?? '').trim() || 'a semantic match' },
      });
    }
  }
  // Tag matches first (explainable by shared tags), then judge matches (explainable by the judge's reason).
  return [...tagMatches, ...semantic];
}
