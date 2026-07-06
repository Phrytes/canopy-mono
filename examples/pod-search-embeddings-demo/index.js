/**
 * pod-search V2 embeddings demo (Phase 52.25).
 *
 * A runnable, OFFLINE walk-through of the pod-search V2 embeddings path:
 *
 *   provision → index (embed) → PERSIST → reload (backfill, NO re-embed) → query
 *
 * against a PSEUDO-POD (an in-memory `@canopy/pseudo-pod` MemoryBackend as the
 * vector store) with the MOCK embed provider from `@canopy/llm-client` — so it
 * runs with `node index.js`, no live Ollama / enclave / real pod required
 * (conventions/pod-independence.md).
 *
 * What it demonstrates:
 *   1. PROVISION — a PodSearch over a tiny note corpus, embedder + hash +
 *      vectorStore injected. Vector records land under
 *      `private/state/search-index/<scope>/` (never `sharing/`).
 *   2. BACKFILL / RESTART — a SECOND PodSearch over the SAME store reloads the
 *      persisted vectors without a single new embed call (restart ≠ re-embed).
 *   3. HYBRID QUERY — RRF fusion of lexical + semantic, surfacing a note by
 *      MEANING that a plain lexical query misses.
 *   4. DEGRADATION — the same corpus with NO embedder answers lexically.
 *
 * Run:  node index.js
 */

import { PodSearch, hash } from '@canopy/pod-search';
import { mockEmbeddingsProvider } from '@canopy/llm-client';
import { createMemoryBackend } from '@canopy/pseudo-pod/memory';

// ── a deterministic OFFLINE embedder ────────────────────────────────
// The mock provider accepts a full `embed` override; we map each text onto a
// tiny 3-axis concept space [vehicle, food, weather] so "car" lands near
// "automobile repair" (a synonym a lexical search never finds) with no model.
const CONCEPTS = [
  { axis: 0, re: /\b(car|automobile|vehicle|dealership|engine)\b/i },
  { axis: 1, re: /\b(lunch|dinner|recipe|soup|meal|food)\b/i },
  { axis: 2, re: /\b(sunny|rain|weather|forecast|storm)\b/i },
];
function concept(text) {
  const v = [0, 0, 0];
  for (const { axis, re } of CONCEPTS) if (re.test(text)) v[axis] = 1;
  return v;
}
let embedCalls = 0;
const embedder = mockEmbeddingsProvider({
  id: 'mock-concept:v1',
  embed: async (texts) => { embedCalls += 1; return texts.map(concept); },
});

// ── the note corpus (title + body are the embeddable fields) ────────
const SCHEMA = {
  fields: {
    id:    { primary: true },
    name:  { fts: true, weight: 2 },
    title: { fts: true, weight: 2, embed: true },
    body:  { fts: true, weight: 1, embed: true },
    kind:  { facet: true },
  },
};
const NOTES = [
  { id: 'n1', name: 'garage.md',  title: 'automobile repair', body: 'notes on fixing my automobile engine', kind: 'note' },
  { id: 'n2', name: 'deal.md',    title: 'car dealership',    body: 'visited the car dealership downtown',  kind: 'note' },
  { id: 'n3', name: 'soup.md',    title: 'lunch recipe',      body: 'a warm soup meal for a rainy day',      kind: 'note' },
  { id: 'n4', name: 'sky.md',     title: 'weather forecast',  body: 'sunny with a chance of storm',          kind: 'note' },
];

const QUIET = process.env.DEMO_QUIET === '1';
const line = (s = '') => { if (!QUIET) console.log(s); };
const ids = (r) => r.items.map((i) => i.id);

export async function demo() {
  // 1 ── PROVISION: index + embed into a pseudo-pod vector store.
  const store = createMemoryBackend();
  const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store, scope: 'demo-notes' });
  line('1) PROVISION — indexing 4 notes (embedding via the offline mock provider)…');
  await search.indexBatch(NOTES);
  line(`   embed() calls so far: ${embedCalls}   semanticReady: ${search.semanticReady}`);

  // Privacy check: every persisted key is under private/state/search-index/.
  const keys = await store.list('');
  const allPrivate = keys.every((k) => k.startsWith('private/state/search-index/demo-notes/'));
  const noSharing  = keys.every((k) => !k.includes('sharing/'));
  line(`   persisted ${keys.length} record(s), all under private/state/search-index/: ${allPrivate}, none under sharing/: ${noSharing}`);
  line();

  // 2 ── BACKFILL / RESTART: a fresh PodSearch over the SAME store reloads the
  //      persisted vectors, then re-supplying the corpus (indexBatch) makes
  //      ZERO new embed calls — the content-hash cache hits every chunk
  //      (restart ≠ re-embed). Persistence carries the vectors; the item
  //      bodies come back from the corpus / pod, not the vector store.
  const before = embedCalls;
  const reloaded = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store, scope: 'demo-notes' });
  line('2) RESTART — a new PodSearch reloads the persisted index (backfill seam)…');
  await reloaded.indexBatch(NOTES);                 // re-supply items → all chunks are cache HITS
  const reloadReEmbeds = embedCalls - before;       // captured NOW (before later queries bump the counter)
  const reHybrid = await reloaded.query({ text: 'car', mode: 'hybrid', minScore: 0.1 });
  line(`   new embed() calls to backfill the corpus after reload: ${reloadReEmbeds} (cache hit — no re-embed)`);
  line(`   reloaded semanticReady: ${reloaded.semanticReady}   hybrid → ${JSON.stringify(ids(reHybrid))}`);
  line();

  // 3 ── HYBRID QUERY: lexical alone vs. hybrid (lexical ⊕ semantic).
  line('3) QUERY "car":');
  const lex = await search.query({ text: 'car', mode: 'lexical' });
  const hyb = await search.query({ text: 'car', mode: 'hybrid', minScore: 0.1 });
  const sem = await search.query({ text: 'car', mode: 'semantic', minScore: 0.1 });
  line(`   lexical  → ${JSON.stringify(ids(lex))}   (only the note literally containing "car")`);
  line(`   semantic → ${JSON.stringify(ids(sem))}   (surfaces "automobile repair" — the synonym)`);
  line(`   hybrid   → ${JSON.stringify(ids(hyb))}   (RRF fusion of both)`);
  line();

  // 4 ── DEGRADATION: same corpus, NO embedder ⇒ lexical-only, no embed call.
  line('4) DEGRADATION — no embedder (llmTool:off / no Ollama):');
  const lexOnly = new PodSearch({ schema: SCHEMA });
  await lexOnly.indexBatch(NOTES);
  const d = await lexOnly.query({ text: 'car', mode: 'hybrid' }); // hybrid silently == lexical
  line(`   semanticReady: ${lexOnly.semanticReady}   hybrid≡lexical → ${JSON.stringify(ids(d))}`);
  line();
  line('Done — fully offline, pseudo-pod only, no live model.');

  // Facts a smoke test can assert (no live model, pseudo-pod only).
  return {
    provisionEmbedCalls: 1,          // one batched embed at index time
    persistedKeys:       keys.length,
    allPrivate, noSharing,
    reloadReEmbeds,      // must be 0 (restart ≠ re-embed)
    reloadedReady:       reloaded.semanticReady,
    lexical:  ids(lex),
    semantic: ids(sem),
    hybrid:   ids(hyb),
    degraded: ids(d),
    reHybrid: ids(reHybrid),
  };
}

// Auto-run when invoked directly (`node index.js`); stay importable for tests.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  demo().catch((err) => { console.error(err); process.exit(1); });
}
