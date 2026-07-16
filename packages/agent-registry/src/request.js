// Request — the typed, minimal, purpose-bound ask a consumer makes of a user's property
// layer (design Phase 1; plans/NOTE-property-layer-design.md §2–3, "Option C canonical").
//
// A Request is the GENERAL shape; @onderling/attribute-charter's charter is the coarse-enum +
// caps + immutable SPECIALISATION of it (a charter is a Request whose items are all
// coarse-enum, capped at 3, over a fixed vocabulary). Kept independent for now — a later
// refactor could have createCharter delegate here (see the design note §7).
//
// Rendering (a form / an allow-block card) reuses the manifest param-form machinery (§3
// Option A); ongoing access rides the ocap grant model (§3 Option D). This module is only
// the canonical wire record + its hash.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Build a canonical, validated Request.
 * @param {object} a
 * @param {string} a.requesterId                      who is asking (webid / circle id / bot id)
 * @param {string} a.purpose                          plain-language "why we ask" (shown to the user)
 * @param {Array<{key:string, why:string, type?:string, minRung?:string}>} a.items
 * @param {object} [a.vocabulary]                     a createVocabulary(...) — validates keys + types when given
 * @returns {{requesterId:string, purpose:string, items:Array}}
 */
export function createRequest({ requesterId, purpose, items, vocabulary = null } = {}) {
  if (typeof requesterId !== 'string' || !requesterId) throw new TypeError('createRequest: requesterId required');
  if (typeof purpose !== 'string' || !purpose.trim()) throw new TypeError('createRequest: purpose required (why you ask)');
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('createRequest: at least one requested item');
  const seen = new Set();
  const normalised = items.map((it) => {
    if (!it || typeof it.key !== 'string' || !it.key) throw new TypeError('createRequest: each item needs a key');
    if (seen.has(it.key)) throw new RangeError(`createRequest: duplicate item key ${it.key}`);
    seen.add(it.key);
    if (typeof it.why !== 'string' || !it.why.trim()) throw new TypeError(`createRequest: item ${it.key} needs a per-item "why"`);
    let type = it.type ?? null;
    if (vocabulary) {
      if (!vocabulary.has(it.key)) throw new RangeError(`createRequest: item ${it.key} is not in the vocabulary`);
      const vt = vocabulary.type(it.key);
      if (type && type !== vt) throw new RangeError(`createRequest: item ${it.key} type ${type} conflicts with vocabulary type ${vt}`);
      type = vt;
    }
    return {
      key: it.key,
      why: it.why.trim(),
      ...(type ? { type } : {}),
      ...(typeof it.minRung === 'string' && it.minRung ? { minRung: it.minRung } : {}),
    };
  });
  normalised.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));   // canonical order → stable hash
  return { requesterId, purpose: purpose.trim(), items: normalised };
}

/** Recursively key-sorted JSON — the canonical form the hash is taken over. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => { acc[k] = canonicalize(value[k]); return acc; }, {});
  }
  return value;
}

/** Deterministic content hash of a Request (lowercase hex sha-256). The signature signs this. */
export function requestHash(request) {
  const content = canonicalize({ requesterId: request.requesterId, purpose: request.purpose, items: request.items });
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(content))));
}

/** The keys a Request asks for. */
export function requestKeys(request) {
  return (request?.items ?? []).map((i) => i.key);
}
