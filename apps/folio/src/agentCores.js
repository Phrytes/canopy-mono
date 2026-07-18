/**
 * folio — pure agent cores (PLAN-folio-as-file-agent.md).
 *
 * Extracted from the hand-rolled `agent.register(...)` handlers in
 * `browser.js` so folio's pod-file ops become MANIFEST-DERIVED wireSkill
 * capabilities (the `apps/agents/src/cores.js` shape).
 *
 * Uniform-route shape (decision #5): each core is a pure
 * `(store, args, ctx) → result`.  `store` is the injected folio backend
 * the browser handlers close over today — the file index + share/pod/
 * search collaborators — threaded as one object so the cores stay pure
 * and testable:
 *
 *   store = {
 *     files,                        // the mutable in-process file index
 *     identity,                     // AgentIdentity (shareFolder signer)
 *     podRoot,                      // token's `pod` field (may be absent)
 *     mintShareToken,               // autoShare.mintShareToken
 *     simulateSync,                 // sync-envelope stub the chat-shell reads
 *     listPodFolio,                 // live-pod list walk
 *     getPodSource,   () => src|null   // N5 lazy pod source (mutable via closure)
 *     ensureNoteSearch,  () => search  // /zoek stateful index (mutable embedder)
 *     searchFolioNotes,             // pod-search ranker
 *   }
 *
 * Each core RETURNS THE EXACT PLAIN-OBJECT PAYLOAD the old handler wrapped
 * in `DataPart(...)` — `Parts.wrap()` re-wraps a plain object as
 * `[DataPart(obj)]`, so the wire reply the chat-shell renders is preserved
 * BYTE-FOR-BYTE (the handlers returned `[DataPart(x)]`; the cores return
 * `x`; `Parts.wrap(x) === [DataPart(x)]`).
 *
 * `args` arrive pre-decoded by `wireSkill` per each op's manifest `params`
 * (so `readNote` gets `{path}`, `shareFolder` gets `{folder, with}`, …).
 * Non-declared args (`listFiles.source`, `searchNotes.limit/minScore/
 * filters`) still flow through `decodeArgs`' merged-DataPart object and are
 * read here exactly as before.
 *
 * Import-free (like `apps/agents/src/cores.js`) — every collaborator is
 * threaded via `store`, so this module drags no node/browser deps.
 */

/* ── readNote — fetch a known file's contents by path/name ── */
export function readNote(store, args = {}) {
  const target = store.files.find((f) => f.id === args.path || f.name === args.path);
  if (!target) return { ok: false, error: `No file at "${args.path}".` };
  const reply = {
    message: `[browser] Contents of ${target.name} would be shown here. ${target.bytes} bytes; mime ${target.mime}.`,
  };
  if (target.frontmatter?.embeds) reply.embeds = target.frontmatter.embeds;
  return reply;
}

/* ── shareFolder — REAL PodCapabilityToken via autoShare ── */
export async function shareFolder(store, args = {}) {
  const folder       = String(args.folder ?? '').trim();
  const subjectWebid = String(args.with ?? '').trim();
  if (!folder)       return { ok: false, error: 'folder required' };
  if (!subjectWebid) return { ok: false, error: 'with (webid) required' };

  const podRootStr  = store.podRoot || 'https://basis.invalid/';
  const sharePodUri = `${podRootStr.replace(/\/$/, '')}/${folder.replace(/^\//, '').replace(/\/$/, '')}/`;
  try {
    const record = await store.mintShareToken(store.identity, {
      webid:     subjectWebid,
      sharePath: folder,
      podRoot:   podRootStr,
      sharePodUri,
    });
    return {
      ok:      true,
      message: `✓ Shared "${folder}" with ${subjectWebid}.`,
      share: {
        webid:     record.webid,
        sharePath: record.sharePath,
        podUri:    record.podUri,
        mode:      record.mode,
        issuer:    record.issuer,
        issuedAt:  record.issuedAt,
        expiresAt: record.expiresAt,
        token:     record.token,
      },
      _sync: store.simulateSync(),
    };
  } catch (err) {
    return { ok: false, error: `shareFolder failed: ${err.message ?? err}` };
  }
}

/* ── listFiles — in-process index, or the live pod when asked ── */
export async function listFiles(store, args = {}) {
  // N5 — `source:'pod'` reads the user's real pod (when a pod source is
  // attached).  Falls back to the index (with a `needsPod` flag) otherwise.
  if (args.source === 'pod') {
    const podSource = store.getPodSource();
    if (!podSource?.podClient) {
      return { items: [], source: 'pod', needsPod: true };
    }
    try {
      const items = await store.listPodFolio(podSource.podClient, podSource.containerUri);
      return { items, source: 'pod', _sync: store.simulateSync() };
    } catch (err) {
      return { items: [], source: 'pod', error: `pod list failed: ${err?.message ?? err}` };
    }
  }
  return { items: store.files, source: 'index', _sync: store.simulateSync() };
}

/* ── searchNotes — `/zoek`: pod-search over the note corpus (52.25) ── */
export async function searchNotes(store, args = {}) {
  // Manifest param is `query`; the legacy `text` alias is still honoured.
  const text      = String(args.query ?? args.text ?? '').trim();
  const requested = (args.mode === 'semantic' || args.mode === 'hybrid') ? args.mode : 'lexical';
  if (!text) return { items: [], mode: requested, semantic: false };

  const search = await store.ensureNoteSearch();
  const ready  = search.semanticReady;
  // Asked for semantic/hybrid but the index has no embedder → lexical.
  const mode = (requested !== 'lexical' && !ready) ? 'lexical' : requested;

  const res = await store.searchFolioNotes(search, {
    text, mode, limit: args.limit ?? 20, minScore: args.minScore, filters: args.filters,
  });
  const reply = {
    items:    res.items.map((n) => ({ id: n.id, label: n.name ?? n.title, type: 'file', path: n.path ?? n.id })),
    total:    res.total,
    mode,
    semantic: ready,
  };
  if (mode !== requested) reply.degraded = 'lexical';   // semantic asked, none available
  if (res.code)           reply.code = res.code;
  return reply;
}

/* ── getFileSnapshot — cardSnapshotSkill for /embed-file ── */
export function getFileSnapshot(store, args = {}) {
  const target = store.files.find((f) => f.id === args.path || f.name === args.path);
  if (!target) return { ok: false, error: `No file at "${args.path}".` };
  return {
    id:    target.id,
    type:  'file',
    name:  target.name,
    mime:  target.mime,
    bytes: target.bytes,
    path:  target.id,
    state: target.state ?? 'synced',
  };
}

/* ── verifyPodState — manifest declares runtime:'browser' ── */
export function verifyPodState(store, args = {}) {
  const target = store.files.find((f) => f.id === args.relPath || f.name === args.relPath);
  if (!target) {
    return { message: `[browser] ${args.relPath ?? 'file'} not in local index; verification skipped.` };
  }
  return { message: `[browser] ${target.name} matches local index (sha + size assumed; pod verify needs sign-in).` };
}

/* ── deleteFromPod — runtime:'browser' (pod HTTPS DELETE) ── */
export function deleteFromPod(store, args = {}) {
  const idx = store.files.findIndex((f) => f.id === args.relPath || f.name === args.relPath);
  if (idx === -1) return { ok: false, error: `No file at "${args.relPath}".` };
  const removed = store.files.splice(idx, 1)[0];
  return { ok: true, message: `✓ Deleted from pod: ${removed.name}`, _sync: store.simulateSync() };
}

/* ── downloadFile — receiver-side; real bytes via Blob in main.js ── */
export function downloadFile(store, args = {}) {
  const target = store.files.find((f) => f.id === args.path || f.name === args.path);
  return {
    ok:      true,
    message: target
      ? `↓ Downloading ${target.name} (${target.bytes} bytes, ${target.mime})…`
      : `↓ Downloading ${args.path} from sender's pod…`,
  };
}

/* ── saveToMyPod — receiver-side cross-pod copy ── */
export function saveToMyPod(store, args = {}) {
  return {
    ok:      true,
    message: `📥 Saved "${args.name ?? args.path ?? 'file'}" to your pod's /shared-with-me/ folder.`,
    _sync:   store.simulateSync(),
  };
}

/* ── folioStatus — record reply ── */
export function folioStatus(store /*, args, ctx */) {
  const synced     = store.files.filter((f) => f.state === 'synced').length;
  const conflicted = store.files.filter((f) => f.state === 'conflict').length;
  return {
    title:         'Folio sync status',
    lastSync:      new Date().toISOString(),
    fileCount:     store.files.length,
    syncedCount:   synced,
    conflictCount: conflicted,
    sharedFolders: 0,
  };
}

/**
 * The manifest-derived core map — EXACTLY the folioManifest ops tagged
 * `runtime:'browser'` (the relocatable pod-file set).  `buildFolioSkills`
 * wireSkill-wraps each, and the fitness test asserts route parity against
 * the manifest (a browser op with no core here, or a core with no op,
 * fails CI — the anti-drift guarantee).
 */
export const FOLIO_CORES = Object.freeze({
  readNote,
  shareFolder,
  listFiles,
  searchNotes,
  getFileSnapshot,
  verifyPodState,
  deleteFromPod,
  downloadFile,
  saveToMyPod,
  folioStatus,
});

/* ── Ops WITHOUT a manifest operation (registered directly, not via
 *    wireSkill, so they stay OUT of the manifest route-parity set) ── */

/**
 * searchFiles — name/path substring match.  No manifest op today (the
 * SEMANTIC sibling `searchNotes`/`/zoek` is the declared one); kept as a
 * direct registration.  Reads `{query}` from the decoded first DataPart.
 */
export function searchFiles(store, args = {}) {
  const q = String(args.query ?? '').toLowerCase();
  if (!q) return { items: [] };
  const hits = store.files.filter((f) =>
    f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q),
  );
  return { items: hits.map((f) => ({ id: f.id, label: f.name, type: 'file' })) };
}

/**
 * folio_briefSummary — briefSummary. No manifest op (basis's
 * generic `/brief` maps to this named skill); kept as a direct registration.
 */
export function folioBriefSummary(store /*, args, ctx */) {
  if (store.files.length === 0) return { ok: true };
  return {
    count: store.files.length,
    label: `file${store.files.length === 1 ? '' : 's'} in folio`,
  };
}
