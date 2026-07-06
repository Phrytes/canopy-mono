/**
 * folioSearch — folio's note corpus wired onto `@canopy/pod-search` (52.25,
 * PLAN-podsearch-v2-embeddings, first-consumer = folio, Q1).
 *
 * Folio's existing search (`searchFiles` in `browser.js`, the HTTP `/files`
 * route) is a name/path SUBSTRING match — it can't find a note by meaning
 * ("car" → a note about "automobile repair"). This module builds a
 * `PodSearch` over folio's notes (title + body as `embed:true` fields) so the
 * chat `/zoek` op can offer a SEMANTIC mode on top of the same corpus, while
 * staying byte-compatible with lexical when no embedder is available.
 *
 * Boundary: pure + node-free + RN-free (it only touches `@canopy/pod-search`
 * and the injected embedder/store), so it rides into the canopy-chat browser
 * bundle alongside the rest of `browser.js`.
 *
 * Degradation (Q3 + the llmTool policy):
 *   - NO `embedder` injected  → PodSearch is lexical-only (`semanticReady`
 *     false); `/zoek semantic` gracefully returns the lexical ranking. This
 *     is the `llmTool:'off'` path (canopy-chat injects no embedder) AND the
 *     no-Ollama path (an absent provider ⇒ no embedder ⇒ lexical).
 *   - embedder present but provider unreachable at query time → PodSearch's
 *     own `#semanticRank` catches the throw and falls back to lexical + audit.
 *
 * Privacy: the optional `vectorStore` is a StorageBackend-shaped store;
 * PodSearch persists vector records under `private/state/search-index/<scope>/`
 * BY CONSTRUCTION (never under `sharing/`). No embed call is made unless an
 * embedder is injected — and canopy-chat only injects one when the circle's
 * `llmTool`/`embedTool` policy permits (same trust boundary as chat LLM).
 */

import { PodSearch, hash as defaultHash } from '@canopy/pod-search';

/**
 * The note-corpus schema. `id` is the primary key (a note's relPath / id);
 * `path`, `name`, `title`, and `body` are lexically searchable; `title` +
 * `body` are ALSO embeddable (the semantic surface); `kind`/`state` are facets.
 */
export const FOLIO_NOTE_SCHEMA = {
  fields: {
    id:    { primary: true },
    path:  { fts: true, weight: 1 },
    name:  { fts: true, weight: 2 },
    title: { fts: true, weight: 2, embed: true },
    body:  { fts: true, weight: 1, embed: true },
    kind:  { facet: true },
    state: { facet: true },
  },
};

/**
 * Project a folio file/note row (from `scanLocal`/`scanPod`/the in-process
 * index) onto a PodSearch note item. Tolerant of the several field names
 * folio sources use (mirrors `folioTree.rowPath`): body comes from any of
 * `body` / `content` / `text` / `markdown` (folio's real note read wires the
 * markdown body in; the in-process index may carry none, in which case the
 * note is name/title-only — still lexically + semantically indexable).
 *
 * @param {object} row
 * @returns {{id:string, path:string, name:string, title:string, body:string, kind?:string, state?:string}}
 */
export function noteItemFromRow(row) {
  const id = String(row?.id ?? row?.relPath ?? row?.path ?? row?.name ?? '');
  const path = String(row?.relPath ?? row?.path ?? row?.id ?? '');
  const name = String(row?.name ?? (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id));
  const title = String(row?.title ?? name);
  const body = String(row?.body ?? row?.content ?? row?.text ?? row?.markdown ?? '');
  const item = { id, path, name, title, body };
  if (row?.kind ?? row?.mime) item.kind = String(row.kind ?? row.mime);
  if (row?.state) item.state = String(row.state);
  return item;
}

/**
 * Build a `PodSearch` over folio's note corpus.
 *
 * @param {object} [args]
 * @param {{id:string, embed:(t:string[])=>Promise<Array>}} [args.embedder]
 *        duck-typed EmbeddingProvider. Absent ⇒ lexical-only (the off / no-Ollama path).
 * @param {(text:string)=>Promise<string>} [args.hash]  content-hash seam (defaults to pod-search's hash adapter)
 * @param {object} [args.vectorStore]  StorageBackend-shaped store ⇒ persistence under private/state/search-index/
 * @param {string} [args.scope='folio-notes']  namespaces the on-store layout
 * @param {(e:object)=>void} [args.audit]  optional audit hook (degradation / invalidation)
 * @returns {PodSearch}
 */
export function buildFolioNoteSearch({ embedder, hash = defaultHash, vectorStore, scope = 'folio-notes', audit } = {}) {
  return new PodSearch({
    schema: FOLIO_NOTE_SCHEMA,
    embedder: normalizeEmbedder(embedder),
    hash,
    vectorStore,
    scope,
    audit,
  });
}

/**
 * Normalise an injected embedder to the shape PodSearch reads
 * (`{ id, dim?, embed }`). The mock provider (`mockEmbeddingsProvider`) already
 * carries `.id`; an `@canopy/llm-client` `EmbeddingClient` exposes `.model` /
 * `.providerId` instead, so canopy-chat can hand its resolved embed client in
 * RAW — no adapter at the call site (keeps the glue thin). Anything without an
 * `embed()` fn ⇒ `undefined` (lexical-only).
 *
 * @param {object} [e]
 * @returns {{id:string, dim?:number, embed:Function}|undefined}
 */
function normalizeEmbedder(e) {
  if (!e || typeof e.embed !== 'function') return undefined;
  if (typeof e.id === 'string') return e;
  const id = e.model ?? e.providerId ?? e.modelId ?? 'embedder';
  return { id, ...(e.dim !== undefined ? { dim: e.dim } : {}), embed: (t, o) => e.embed(t, o) };
}

/**
 * Index a batch of folio note/file rows into `search`. Reuses PodSearch's
 * content-hash cache + backfill seams: an unchanged note is never re-embedded,
 * and (with a `vectorStore`) vectors survive a restart. Rows are projected via
 * `noteItemFromRow`, so any folio source shape works.
 *
 * @param {PodSearch} search
 * @param {object[]} rows
 * @returns {Promise<number>} number of rows indexed
 */
export async function indexFolioNotes(search, rows) {
  const items = (Array.isArray(rows) ? rows : []).map(noteItemFromRow).filter((it) => it.id);
  if (items.length) await search.indexBatch(items);
  return items.length;
}

/**
 * Run a `/zoek` query against the folio note index.
 *
 * `mode:'semantic'|'hybrid'` degrade to lexical when the index has no
 * embedder (PodSearch's built-in Q3-option-a behaviour): a `semantic` query
 * on a lexical-only index returns `code:'E_SEMANTIC_UNAVAILABLE'` with an
 * empty list, so callers that want a graceful answer should prefer `hybrid`
 * (silently equals lexical when semantic is off) or check `search.semanticReady`.
 *
 * @param {PodSearch} search
 * @param {object} [args]
 * @param {string} [args.text]
 * @param {'lexical'|'semantic'|'hybrid'} [args.mode='lexical']
 * @param {number} [args.limit=20]
 * @param {number} [args.minScore]
 * @param {object} [args.filters]
 * @returns {Promise<{items:object[], total:number, facets:object, code?:string}>}
 */
export function searchFolioNotes(search, { text, mode = 'lexical', limit = 20, minScore, filters } = {}) {
  return search.query({ text, mode, limit, minScore, filters });
}
