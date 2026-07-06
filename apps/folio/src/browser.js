/**
 * folio — browser entry for canopy-chat composition (slice 4 of the
 * canopy-chat integration plan, 2026-05-23).
 *
 * Composes folio's web-only surface into canopy-chat's browser
 * bundle.  Out of scope: the SyncEngine, the chokidar watcher, the
 * desktop tray, the CLI, the HTTP server — those stay app-side and
 * never enter the browser bundle (they all carry node-only deps).
 *
 * In scope (the chat-web subset):
 *   - readNote            — read a file by relPath or filename
 *   - shareFolder         — issue a real PodCapabilityToken via
 *                           autoShare.mintShareToken (the same
 *                           primitive the desktop sync uses)
 *   - listFiles           — return the in-process file index
 *   - searchFiles         — name/path substring search
 *   - getFileSnapshot     — Q29 cardSnapshotSkill (for /embed-file)
 *   - verifyPodState      — pod-side check (browser-doable; the
 *                           manifest declares runtime:'browser')
 *   - deleteFromPod       — pod-side delete (browser-doable)
 *   - downloadFile        — receiver-side action; placeholder reply
 *   - saveToMyPod         — receiver-side cross-pod copy; placeholder
 *   - folio_briefSummary  — Q30 briefSummary
 *   - folioStatus         — record reply: count / synced / shared
 *
 * Mobile-extended (DEFERRED): canopy-chat mobile composes the same
 * browser-shape factory PLUS @canopy/sync-engine-rn for real file-
 * system mirroring; the in-memory file store collapses to a thin
 * proxy over the RN sync engine.  Tracked by #127-#131.
 *
 * Boundary: imports ONLY platform-neutral parts of folio — autoShare
 * (which uses an injected FsAdapter; no `fs` import at module load)
 * and PodCapabilityToken (pure crypto, no node deps).  Verified by
 * the audit in integration-plan-2026-05-23.md §Audit.
 */

import {
  Agent, AgentIdentity, InternalTransport, DataPart,
} from '@canopy/core';

import { mintShareToken } from './autoShare.js';
import { listPodFolio } from './folioPodList.js';
import { buildFolioNoteSearch, indexFolioNotes, searchFolioNotes } from './folioSearch.js';

// N5 — Drive tree (folder navigation + rich rows).  Pure JS, node-free,
// RN-free; safe to pull into the browser bundle (unlike the `.` barrel,
// which drags in scanLocal's `fs`/chokidar).  canopy-chat web/mobile
// import the Drive view from here.
export {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile, FILE_KIND_GLYPH,
} from './folioTree.js';
export { listPodFolio } from './folioPodList.js';

/**
 * Pre-seeded demo files.  Mirrors the slice-1/2b convention — the
 * chat-shell expects /files + /folio-status to show content out of
 * the box; tests + the demo UX rely on these IDs ('/notes/recipes.md'
 * etc).  Opt out with `seedFiles:false`.
 */
const SEED_FILES = [
  {
    id: '/notes/shared/anne.md', name: 'anne.md', type: 'file',
    mime: 'text/markdown', bytes: 1234, state: 'synced',
    // #194 (B9, 2026-05-23) — frontmatter `embeds` per
    // v1-web-functional-design § 4f.  Notes can declare references to
    // tasks / stoop posts / events; the chat-shell renders them as
    // clickable "See also" chips at the head of /readnote replies.
    frontmatter: {
      embeds: [
        { type: 'task',          ref: 't-anne-onboarding', label: 'Anne onboarding' },
        { type: 'calendar-event', ref: 'evt-anne-welcome', label: 'Welcome dinner' },
      ],
    },
  },
  { id: '/notes/recipes.md', name: 'recipes.md', type: 'file', mime: 'text/markdown',   bytes: 5678,   state: 'synced' },
  { id: '/docs/lease.pdf',   name: 'lease.pdf',  type: 'file', mime: 'application/pdf', bytes: 102400, state: 'synced' },
];

/**
 * Sync-envelope shape consumed by the chat-shell renderer (mirrors
 * canopy-chat's `simulateSync` so the chat-shell's _sync UI keeps
 * working without a real pod-write round-trip).
 */
function simulateSync() {
  return {
    plannedPaths: [],
    durationMs:   0,
    bytesPushed:  0,
    bytesPulled:  0,
    conflictCount: 0,
    queueDepth:   0,
  };
}

/**
 * Build a folio web-surface agent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus              shared bus (canopy-chat owns it)
 * @param {object}         args.identityVault    Vault for the folio agent's identity
 *                                               (browser convention: VaultLocalStorage
 *                                               prefixed `cc-folio-id:`)
 * @param {string}         [args.label='FolioAgent']
 * @param {object}         [args.podClient]      reserved for future pod-backed reads
 * @param {string}         [args.podRoot]        reserved; used as the token's `pod` field
 *                                               in shareFolder when set
 * @param {Array}          [args.seedFiles]      override demo seeds; pass [] for clean
 * @param {object}         [args.noteEmbedder]   duck-typed embedder for `/zoek` semantic
 *                                               mode (a mock provider or an
 *                                               `@canopy/llm-client` EmbeddingClient).
 *                                               Absent ⇒ lexical-only (llmTool:'off' /
 *                                               no-Ollama path). Wired by canopy-chat
 *                                               from the circle's embed policy; may also
 *                                               be attached post-boot via `setNoteEmbedder`.
 * @param {object}         [args.noteVectorStore] optional StorageBackend-shaped store ⇒
 *                                               vectors persist under private/state/search-index/
 * @param {(e:object)=>void} [args.noteAudit]    optional pod-search audit hook
 * @returns {Promise<{
 *   agent:    Agent,
 *   identity: AgentIdentity,
 *   address:  string,
 *   files:    Array,            mutable in-process index
 *   close:    () => Promise<void>,
 * }>}
 */
export async function createBrowserFolioAgent({
  bus,
  identityVault,
  label = 'FolioAgent',
  podClient,
  podRoot,
  seedFiles,
  noteEmbedder,
  noteVectorStore,
  noteAudit,
}) {
  if (!bus)           throw new TypeError('createBrowserFolioAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserFolioAgent: identityVault required');

  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  const transport = new InternalTransport(bus, identity.pubKey);
  const agent = new Agent({ identity, transport, label });

  const files = Array.isArray(seedFiles)
    ? seedFiles.map((f) => ({ ...f }))
    : SEED_FILES.map((f) => ({ ...f }));

  // N5 — lazy real-pod source for the Drive browser.  The folio agent
  // boots before the user signs in, so the pod source is attached later
  // (main.js, after OIDC) via the returned `setPodSource`.  When set and
  // a caller asks `listFiles({ source: 'pod' })`, files come from the live
  // pod container (a lightweight `.list` walk — no file reads); otherwise
  // the in-process index is returned as before.
  let podSource = null;   // { podClient, containerUri } | null

  /* ─── readNote — fetch the contents of a known file by path/name ─── */
  agent.register('readNote', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    if (!target) return [DataPart({ ok: false, error: `No file at "${a.path}".` })];
    // Pod-backed read is future work (needs podClient + content-type
    // negotiation); for the browser session today we surface the
    // metadata + a placeholder body so chat-shell tests keep working.
    // #194 (B9, 2026-05-23) — also surface frontmatter.embeds when
    // present so the chat-shell can render "See also" chips per
    // v1-web-functional-design § 4f.
    const reply = {
      message: `[browser] Contents of ${target.name} would be shown here. ${target.bytes} bytes; mime ${target.mime}.`,
    };
    if (target.frontmatter?.embeds) {
      reply.embeds = target.frontmatter.embeds;
    }
    return [DataPart(reply)];
  });

  /* ─── shareFolder — REAL PodCapabilityToken via autoShare ─── */
  agent.register('shareFolder', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const folder = String(a.folder ?? '').trim();
    const subjectWebid = String(a.with ?? '').trim();
    if (!folder)        return [DataPart({ ok: false, error: 'folder required' })];
    if (!subjectWebid)  return [DataPart({ ok: false, error: 'with (webid) required' })];

    // Derive the share-pod URI.  Real flow: <podRoot><folder>/.  When
    // no podRoot is wired (pre-sign-in), use a placeholder so the token
    // is still a valid PodCapabilityToken and the chat-shell can echo
    // the action — the desktop sync re-mints with the real pod URI on
    // first runOnce after sign-in.
    const podRootStr = podRoot || 'https://canopy-chat.invalid/';
    const sharePodUri = `${podRootStr.replace(/\/$/, '')}/${folder.replace(/^\//, '').replace(/\/$/, '')}/`;
    try {
      const record = await mintShareToken(identity, {
        webid:       subjectWebid,
        sharePath:   folder,
        podRoot:     podRootStr,
        sharePodUri,
      });
      return [DataPart({
        ok:        true,
        message:   `✓ Shared "${folder}" with ${subjectWebid}.`,
        share:     {
          webid:     record.webid,
          sharePath: record.sharePath,
          podUri:    record.podUri,
          mode:      record.mode,
          issuer:    record.issuer,
          issuedAt:  record.issuedAt,
          expiresAt: record.expiresAt,
          // Full PodCapabilityToken JSON — receivers verify against
          // their pod's authorization layer.
          token:     record.token,
        },
        _sync:     simulateSync(),
      })];
    } catch (err) {
      return [DataPart({
        ok: false,
        error: `shareFolder failed: ${err.message ?? err}`,
      })];
    }
  });

  /* ─── listFiles — in-process index, or the live pod when asked ─── */
  agent.register('listFiles', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    // N5 — `source:'pod'` reads the user's real pod (when a pod source is
    // attached).  Falls back to the index — with a `needsPod` flag so the
    // UI can prompt sign-in — when no pod is connected yet.
    if (a.source === 'pod') {
      if (!podSource?.podClient) {
        return [DataPart({ items: [], source: 'pod', needsPod: true })];
      }
      try {
        const items = await listPodFolio(podSource.podClient, podSource.containerUri);
        return [DataPart({ items, source: 'pod', _sync: simulateSync() })];
      } catch (err) {
        return [DataPart({ items: [], source: 'pod', error: `pod list failed: ${err?.message ?? err}` })];
      }
    }
    return [DataPart({ items: files, source: 'index', _sync: simulateSync() })];
  });

  /* ─── searchFiles — name/path substring match ─── */
  agent.register('searchFiles', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    if (!q) return [DataPart({ items: [] })];
    const hits = files.filter((f) =>
      f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q),
    );
    return [DataPart({
      items: hits.map((f) => ({ id: f.id, label: f.name, type: 'file' })),
    })];
  });

  /* ─── searchNotes — `/zoek`: pod-search over the note corpus (52.25) ──
   *
   * The SEMANTIC sibling of `searchFiles`. Where `searchFiles` is a
   * name/path substring match, `/zoek` ranks notes by MEANING via
   * `@canopy/pod-search` — so "car" finds a note about "automobile repair".
   *
   * Degrades per Q3 (option a) + the llmTool policy: with no `noteEmbedder`
   * injected (llmTool:'off' / no Ollama) the index is lexical-only, and a
   * `mode:'semantic'` request gracefully returns the LEXICAL ranking (the
   * reply's `degraded:'lexical'` flags it) rather than an empty
   * E_SEMANTIC_UNAVAILABLE. No embed call is ever made without an embedder.
   */
  let noteSearch = null;
  let builtWithEmbedder;             // embedder identity the current index was built with
  async function ensureNoteSearch() {
    if (!noteSearch || builtWithEmbedder !== noteEmbedder) {
      noteSearch = buildFolioNoteSearch({
        embedder: noteEmbedder, vectorStore: noteVectorStore, audit: noteAudit,
      });
      builtWithEmbedder = noteEmbedder;
    }
    // Upsert the current corpus. The content-hash cache makes an unchanged
    // note free (no re-embed); absent an embedder this is a pure lexical index.
    await indexFolioNotes(noteSearch, files);
    return noteSearch;
  }

  agent.register('searchNotes', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const text = String(a.query ?? a.text ?? '').trim();
    const requested = (a.mode === 'semantic' || a.mode === 'hybrid') ? a.mode : 'lexical';
    if (!text) return [DataPart({ items: [], mode: requested, semantic: false })];

    const search = await ensureNoteSearch();
    const ready = search.semanticReady;
    // Asked for semantic/hybrid but the index has no embedder → lexical.
    const mode = (requested !== 'lexical' && !ready) ? 'lexical' : requested;

    const res = await searchFolioNotes(search, {
      text, mode, limit: a.limit ?? 20, minScore: a.minScore, filters: a.filters,
    });
    const reply = {
      items:    res.items.map((n) => ({ id: n.id, label: n.name ?? n.title, type: 'file', path: n.path ?? n.id })),
      total:    res.total,
      mode,
      semantic: ready,
    };
    if (mode !== requested) reply.degraded = 'lexical';   // semantic asked, none available
    if (res.code)           reply.code = res.code;
    return [DataPart(reply)];
  });

  /* ─── getFileSnapshot — Q29 cardSnapshotSkill for /embed-file ─── */
  agent.register('getFileSnapshot', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    if (!target) return [DataPart({ ok: false, error: `No file at "${a.path}".` })];
    return [DataPart({
      id:    target.id,
      type:  'file',
      name:  target.name,
      mime:  target.mime,
      bytes: target.bytes,
      path:  target.id,
      state: target.state ?? 'synced',
    })];
  });

  /* ─── verifyPodState — manifest declares runtime:'browser' ─── */
  agent.register('verifyPodState', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    // Real implementation would HEAD the pod URI + compare sha/size.
    // Browser session sans podClient: surface the in-process state.
    const target = files.find((f) => f.id === a.relPath || f.name === a.relPath);
    if (!target) {
      return [DataPart({
        message: `[browser] ${a.relPath ?? 'file'} not in local index; verification skipped.`,
      })];
    }
    return [DataPart({
      message: `[browser] ${target.name} matches local index (sha + size assumed; pod verify needs sign-in).`,
    })];
  });

  /* ─── deleteFromPod — runtime:'browser' (pod HTTPS DELETE) ─── */
  agent.register('deleteFromPod', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const idx = files.findIndex((f) => f.id === a.relPath || f.name === a.relPath);
    if (idx === -1) return [DataPart({ ok: false, error: `No file at "${a.relPath}".` })];
    const removed = files.splice(idx, 1)[0];
    return [DataPart({
      ok: true, message: `✓ Deleted from pod: ${removed.name}`, _sync: simulateSync(),
    })];
  });

  /* ─── downloadFile — receiver-side; real bytes via Blob in main.js ─── */
  agent.register('downloadFile', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    return [DataPart({
      ok:      true,
      message: target
        ? `↓ Downloading ${target.name} (${target.bytes} bytes, ${target.mime})…`
        : `↓ Downloading ${a.path} from sender's pod…`,
    })];
  });

  /* ─── saveToMyPod — receiver-side cross-pod copy ─── */
  agent.register('saveToMyPod', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    return [DataPart({
      ok:      true,
      message: `📥 Saved "${a.name ?? a.path ?? 'file'}" to your pod's /shared-with-me/ folder.`,
      _sync:   simulateSync(),
    })];
  });

  /* ─── Q30 briefSummary ─── */
  agent.register('folio_briefSummary', async () => {
    if (files.length === 0) return [DataPart({ ok: true })];
    return [DataPart({
      count: files.length,
      label: `file${files.length === 1 ? '' : 's'} in folio`,
    })];
  });

  /* ─── folioStatus — record reply ─── */
  agent.register('folioStatus', async () => {
    const synced     = files.filter((f) => f.state === 'synced').length;
    const conflicted = files.filter((f) => f.state === 'conflict').length;
    return [DataPart({
      title:         'Folio sync status',
      lastSync:      new Date().toISOString(),
      fileCount:     files.length,
      syncedCount:   synced,
      conflictCount: conflicted,
      sharedFolders: 0,
    })];
  });

  await agent.start();

  return {
    agent,
    identity,
    address: identity.pubKey,
    files,
    // N5 — attach / detach the live pod source after sign-in.  Pass
    // `{ podClient, containerUri }` to light up `listFiles({ source:'pod' })`;
    // pass null (or nothing) to fall back to the in-process index.
    setPodSource: (src) => {
      podSource = src?.podClient && src?.containerUri
        ? { podClient: src.podClient, containerUri: src.containerUri }
        : null;
      return podSource;
    },
    getPodSource: () => podSource,
    // 52.25 — attach / swap the `/zoek` semantic embedder after boot. The
    // folio agent is global while the embed policy is per-circle, so
    // canopy-chat resolves the embedder from the active circle's
    // llmTool/embedTool policy and wires it here (null ⇒ back to lexical).
    // A changed embedder identity rebuilds the index on the next `/zoek`.
    setNoteEmbedder: (e) => { noteEmbedder = e ?? undefined; return noteEmbedder ?? null; },
    getNoteSearch:   () => noteSearch,
    close:   () => agent.close?.(),
  };
}
