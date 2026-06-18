/**
 * circleRetriever — the circle bot's RAG retriever (shared web + mobile).
 *
 * This is the `retrieve` hook the token gate (`tokenGate.js`) calls on the
 * `via:'llm'` path: given the user's message, return the few circle items most
 * relevant to it, which `interpretCommand.withContext` then weaves into the LLM
 * prompt so the model answers grounded in THIS circle's actual tasks/posts —
 * with far fewer tokens than dumping the whole circle.  Retrieval only fires
 * when a turn is already headed to the model (rules/skip never call it).
 *
 * TIER 1 (this file) — LEXICAL: token-overlap ranking over the circle's items.
 * No model, no embeddings, no network beyond the item load, no privacy leak.
 * Good enough to ground references like "is that ladder thing still open?".
 *
 * TIER 2 — SEMANTIC: cosine over embeddings (better recall — synonyms/paraphrase).
 * `makeSemanticRetriever` embeds the query + candidate items via an injected
 * `embed(texts)→vectors` (an `@canopy/llm-client` `EmbeddingClient`, pointed at
 * the Privatemode enclave / Ollama / any `/v1/embeddings` route — see
 * `circleEmbedProviders` + `embedPicker`), ranks by cosine, and GRACEFULLY FALLS
 * BACK to lexical if the embedder is absent or errors (enclave unreachable).
 * `makeCircleRetriever` auto-tiers (semantic when an embedder is configured, else
 * lexical). The gate/dispatch/interpret are unchanged — same `retrieve` seam.
 *
 * Placement (invariant #7): embeddings go in the SAME trust boundary as the chat
 * LLM — enclave for sealed circles, NOT a plain remote. (V0 here embeds items
 * on-query; the amortized path — store sealed per-item vectors at index-time +
 * `sealedIndex.semanticQuery` — is a follow-up; the `embed` seam is identical.)
 */

// Minimal bilingual stop-word set (EN + NL) so common glue words don't inflate
// the overlap score. Kept tiny on purpose — it's a relevance nudge, not an NLP
// pipeline; the deferred semantic tier handles real paraphrase.
const STOP_WORDS = new Set([
  // EN
  'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or', 'in', 'on',
  'for', 'do', 'did', 'does', 'i', 'you', 'it', 'that', 'this', 'my', 'me', 'we',
  'with', 'at', 'as', 'still', 'open', 'any', 'some', 'about',
  // NL
  'de', 'het', 'een', 'zijn', 'en', 'of', 'op', 'voor', 'ik', 'jij', 'je', 'dat',
  'dit', 'mijn', 'we', 'nog', 'er', 'om', 'met', 'aan', 'als', 'wat', 'wie',
]);

/** Lowercase → alphanumeric tokens, dropping 1-char tokens + stop-words. */
function tokenize(s) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** The text a candidate item is matched against (tolerant of several shapes). */
function searchableText(it) {
  if (it == null) return '';
  if (typeof it === 'string') return it;
  return it.label ?? it.text ?? it.title ?? it.name ?? it.summary ?? '';
}

/** Project a ranked item → the context-entry shape `interpret.contextLine` reads. */
function toContextEntry(it) {
  if (typeof it === 'string') return { text: it };
  const kind = it.kind ?? it.type ?? null;
  const label = searchableText(it) || (it.id != null ? String(it.id) : '');
  return {
    id: it.id ?? null,
    type: kind,
    // `kind: label` reads well in the prompt ("task: Return the ladder") and
    // contextLine falls through meaning/label → text, so it surfaces this string.
    text: kind ? `${kind}: ${label}` : label,
  };
}

/**
 * Rank `items` by lexical overlap with `query`; return the top `limit` as
 * context entries. Pure + synchronous + side-effect-free (unit-testable).
 * Score = count of DISTINCT query tokens that appear in the item; ties keep the
 * input order (callers pass items recent-first, so recent wins a tie). Items
 * with zero overlap are dropped — better no context than irrelevant context.
 *
 * @param {Array<object|string>} items
 * @param {string} query
 * @param {{limit?:number}} [opts]
 * @returns {Array<{id?:any,type?:any,text:string}>}
 */
export function lexicalRank(items, query, { limit = 5 } = {}) {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0 || !Array.isArray(items)) return [];
  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tokens = tokenize(searchableText(it));
    if (tokens.length === 0) continue;
    let overlap = 0;
    const counted = new Set();
    for (const tok of tokens) {
      if (qTokens.has(tok) && !counted.has(tok)) { overlap += 1; counted.add(tok); }
    }
    if (overlap > 0) scored.push({ it, overlap, i });
  }
  scored.sort((a, b) => (b.overlap - a.overlap) || (a.i - b.i)); // score desc, stable on input order
  return scored.slice(0, Math.max(0, limit)).map(({ it }) => toContextEntry(it));
}

/**
 * Build the gate's `retrieve(text, ctx)` from an injected item loader. The shell
 * supplies `loadItems(ctx)` (its dispatch + current circle) so the ranking logic
 * stays one shared copy; web and mobile differ only in that adapter. Best-effort:
 * a failing/empty load contributes no context (the LLM still runs, ungrounded).
 *
 * @param {{loadItems:(ctx:object)=>Promise<Array>|Array, limit?:number}} a
 * @returns {(text:string, ctx?:object)=>Promise<Array>}
 */
export function makeLexicalRetriever({ loadItems, limit = 5 } = {}) {
  return async (text, ctx = {}) => {
    if (typeof loadItems !== 'function') return [];
    let items = [];
    try { items = (await loadItems(ctx)) || []; } catch { return []; }
    return lexicalRank(items, text, { limit });
  };
}

/** Cosine similarity of two equal-length numeric vectors (0 if degenerate). */
export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * TIER-2 SEMANTIC retriever. Embeds the query + candidate items via the injected
 * `embed(texts)→Promise<vectors>` (one batched call), ranks by cosine, returns
 * the top `limit` as context entries. Degrades GRACEFULLY: no embedder, or an
 * embed error (enclave unreachable), falls back to `lexicalRank` over the same
 * already-loaded items — so semantic is a strict upgrade, never a regression.
 *
 * @param {{embed?:(texts:string[])=>Promise<number[][]>, loadItems:Function, limit?:number, minScore?:number}} a
 * @returns {(text:string, ctx?:object)=>Promise<Array>}
 */
export function makeSemanticRetriever({ embed, loadItems, limit = 5, minScore = 0 } = {}) {
  return async (text, ctx = {}) => {
    if (typeof loadItems !== 'function') return [];
    let items = [];
    try { items = (await loadItems(ctx)) || []; } catch { return []; }
    if (typeof embed !== 'function') return lexicalRank(items, text, { limit });

    const candidates = items.filter((it) => searchableText(it));
    if (candidates.length === 0) return [];

    let vectors;
    try {
      vectors = await embed([String(text ?? ''), ...candidates.map(searchableText)]);
    } catch {
      return lexicalRank(items, text, { limit });   // embedder down → graceful lexical fallback
    }
    const qVec = Array.isArray(vectors) ? vectors[0] : null;
    if (!Array.isArray(qVec)) return lexicalRank(items, text, { limit });

    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const v = vectors[i + 1];
      if (!Array.isArray(v) || v.length !== qVec.length) continue;
      const score = cosineSim(qVec, v);
      if (score > minScore) scored.push({ it: candidates[i], score, i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));   // score desc, recent (input order) tie-break
    return scored.slice(0, Math.max(0, limit)).map(({ it }) => toContextEntry(it));
  };
}

/**
 * The gate-facing retriever factory: auto-tiers — SEMANTIC when an `embed` is
 * configured (resolved from the circle's embed policy via `resolveCircleEmbedder`),
 * else TIER-1 LEXICAL. One call site for the shells; the seam is the same.
 *
 * @param {{embed?:Function, loadItems:Function, limit?:number}} a
 */
export function makeCircleRetriever({ embed, loadItems, limit = 5 } = {}) {
  return typeof embed === 'function'
    ? makeSemanticRetriever({ embed, loadItems, limit })
    : makeLexicalRetriever({ loadItems, limit });
}
