/**
 * Folio REST contract — Folio.B1.server (track-H §Folio.B1).
 *
 * All endpoints are JSON.  All errors are shaped:
 *   { error: { code: <STRING_CODE>, message: <human-readable> } }
 *
 * The server binds to 127.0.0.1:8888 only.  No auth on the localhost layer:
 * the agent process is the trust boundary, localhost is in the user's trust
 * domain.
 *
 * ┌──────────────────────────┬───────┬────────────────────────────────────────────────┐
 * │ Endpoint                 │ Verb  │ Body / response                                 │
 * ├──────────────────────────┼───────┼────────────────────────────────────────────────┤
 * │ /status                  │ GET   │ → { ts, stats, localRoot, podRoot, webId,      │
 * │                          │       │     watching, lastSyncAt, pending: { uploads,  │
 * │                          │       │     downloads, deletes, conflicts },           │
 * │                          │       │     openConflictFiles }                        │
 * │                          │       │                                                 │
 * │ /conflicts               │ GET   │ → { ts, conflicts: [{ id, relPath, absPath }]} │
 * │                          │       │                                                 │
 * │ /conflicts/:id/resolve   │ POST  │ body: { resolution: 'mine'|'theirs'|<text> }   │
 * │                          │       │ → { ok: true, relPath }                        │
 * │                          │       │ Errors: 404 NOT_FOUND, 400 BAD_RESOLUTION      │
 * │                          │       │                                                 │
 * │ /share                   │ POST  │ body: { webid, scopes:[…], expiresIn?,          │
 * │                          │       │         path? }                                │
 * │                          │       │ → { token: <serialized PodCapabilityToken> }   │
 * │                          │       │ Errors: 400 BAD_REQUEST, 503 NO_IDENTITY       │
 * │                          │       │                                                 │
 * │ /sync/now                │ POST  │ body: { direction?: 'both'|'push'|'pull' }     │
 * │                          │       │ → 202 { ok: true, started: true }              │
 * │                          │       │ Progress streamed over /events WebSocket as     │
 * │                          │       │   sync.progress / sync.done frames.            │
 * │                          │       │                                                 │
 * │ /watch/start             │ POST  │ → { ok: true, watching: true }                 │
 * │ /watch/stop              │ POST  │ → { ok: true, watching: false }                │
 * └──────────────────────────┴───────┴────────────────────────────────────────────────┘
 *
 * WebSocket (/events) frames:
 *   { type: 'status',         ts, stats, watching }
 *   { type: 'sync.progress',  ts, phase: 'start'|'scanning'|'applying', direction }
 *   { type: 'sync.done',      ts, uploads, downloads, deletes, conflicts }
 *   { type: 'conflict.new',   ts, id, relPath, podUri }
 *   { type: 'error',          ts, phase, relPath?, message }
 */

import express from 'express';
import { promises as fs } from 'node:fs';
import { join, dirname, relative } from 'node:path';

import {
  AgentIdentity,
  Bootstrap,
  PodCapabilityToken,
} from '@canopy/core';

import { PathMap }            from '../PathMap.js';
import { scanLocal }          from '../scanLocal.js';
import { scanPod }            from '../scanPod.js';
import { diff }               from '../diff.js';
import { hasConflictMarkers } from '../applyConflict.js';

import { conflictIdFromRelPath, relPathFromConflictId } from './conflictId.js';

const STATE_FILE_RELPATH = '.canopy/notes-sync-state.json';

/**
 * Build the REST router.
 *
 * @param {object} deps
 * @param {object} deps.engine     SyncEngine (or compatible mock)
 * @param {object} [deps.podClient] PodClient instance — if not given, we try
 *                                  `engine._podClient ?? engine.__podClient`
 *                                  (the SyncEngine keeps the real one private).
 * @param {object} deps.vault      Vault* (must support .get(key))
 * @param {object} [deps.identity] AgentIdentity — optional; if absent, /share
 *                                 lazy-derives one from the vault.
 * @param {object} deps.hub        WsHub for broadcasting progress.
 * @returns {express.Router}
 */
export function createRouter({ engine, podClient, vault, identity, hub }) {
  if (!engine) throw new Error('createRouter: engine is required');
  if (!hub)    throw new Error('createRouter: hub is required');
  const resolvedPodClient = podClient ?? engine._podClient ?? engine.__podClient ?? null;

  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  // ── /status ────────────────────────────────────────────────────────────────
  router.get('/status', async (_req, res) => {
    try {
      const localRoot = engine.localRoot;
      const podRoot   = engine.podRoot;
      const stats     = engine.stats ?? {};

      const pathMap = new PathMap({ localRoot, podRoot });

      // Best-effort knownState load (mirrors statusCmd).
      let lastSyncAt = stats.lastSyncAt ?? null;
      let knownState = {};
      try {
        const text = await fs.readFile(join(localRoot, STATE_FILE_RELPATH), 'utf8');
        const parsed = JSON.parse(text);
        knownState = parsed.files ?? {};
        lastSyncAt = lastSyncAt ?? parsed.writtenAt ?? null;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      let pending = { uploads: 0, downloads: 0, deletes: 0, conflicts: 0 };
      let openConflictFiles = 0;
      let scanError = null;
      try {
        if (!resolvedPodClient) {
          throw new Error('no podClient available for status scan');
        }
        const localScan = await scanLocal(localRoot, { pathMap });
        const podScan   = await scanPod(resolvedPodClient, podRoot, { pathMap });
        const d         = diff(localScan, podScan, knownState);
        pending = {
          uploads:   d.toUpload.length,
          downloads: d.toDownload.length,
          deletes:   d.toDelete.length,
          conflicts: d.conflicts.length,
        };
        for (const f of localScan) {
          try {
            const text = await fs.readFile(f.absPath, 'utf8');
            if (hasConflictMarkers(text)) openConflictFiles++;
          } catch { /* ignore */ }
        }
      } catch (err) {
        // Pod might be unreachable; surface but don't fail the whole status.
        scanError = err?.message ?? String(err);
      }

      res.json({
        ts:        Date.now(),
        stats,
        localRoot,
        podRoot,
        watching:  !!engine.__watching,
        lastSyncAt,
        pending,
        openConflictFiles,
        ...(scanError ? { scanError } : {}),
      });
    } catch (err) {
      sendError(res, 500, 'STATUS_FAILED', err?.message ?? String(err));
    }
  });

  // ── /conflicts ────────────────────────────────────────────────────────────
  router.get('/conflicts', async (_req, res) => {
    try {
      const localRoot = engine.localRoot;
      const conflicted = [];
      await walkConflicts(localRoot, localRoot, conflicted);

      res.json({
        ts: Date.now(),
        conflicts: conflicted.map((absPath) => {
          const relPath = relative(localRoot, absPath).split(/[\\/]/).join('/');
          return {
            id:      conflictIdFromRelPath(relPath),
            relPath,
            absPath,
          };
        }),
      });
    } catch (err) {
      sendError(res, 500, 'CONFLICTS_FAILED', err?.message ?? String(err));
    }
  });

  // ── /conflicts/:id/resolve ────────────────────────────────────────────────
  router.post('/conflicts/:id/resolve', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath) {
      return sendError(res, 400, 'BAD_CONFLICT_ID', 'conflict id is malformed');
    }
    const body = req.body ?? {};
    const resolution = body.resolution;
    if (typeof resolution !== 'string' || resolution.length === 0) {
      return sendError(res, 400, 'BAD_RESOLUTION',
        'body.resolution must be "mine" | "theirs" | <text> (a non-empty string)');
    }

    const localRoot = engine.localRoot;
    const absPath   = join(localRoot, ...relPath.split('/'));

    let original;
    try {
      original = await fs.readFile(absPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, 'NOT_FOUND', `no file at ${relPath}`);
      }
      return sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }

    if (!hasConflictMarkers(original)) {
      return sendError(res, 400, 'NO_CONFLICT_MARKERS',
        `file ${relPath} contains no conflict markers; nothing to resolve`);
    }

    let resolvedText;
    if (resolution === 'mine') {
      const ext = extractSide(original, 'mine');
      if (ext == null) {
        return sendError(res, 400, 'CANNOT_PARSE_CONFLICT',
          `could not parse conflict markers in ${relPath}`);
      }
      resolvedText = ext;
    } else if (resolution === 'theirs') {
      const ext = extractSide(original, 'theirs');
      if (ext == null) {
        return sendError(res, 400, 'CANNOT_PARSE_CONFLICT',
          `could not parse conflict markers in ${relPath}`);
      }
      resolvedText = ext;
    } else {
      // Custom text: write verbatim.
      resolvedText = resolution;
    }

    try {
      await fs.mkdir(dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, resolvedText, 'utf8');
    } catch (err) {
      return sendError(res, 500, 'WRITE_FAILED', err?.message ?? String(err));
    }

    res.json({ ok: true, relPath });
  });

  // ── /share ────────────────────────────────────────────────────────────────
  router.post('/share', async (req, res) => {
    const body = req.body ?? {};
    const webid    = body.webid;
    const scopes   = body.scopes;
    const expiresIn = body.expiresIn;
    const path     = body.path;

    if (typeof webid !== 'string' || webid.length === 0) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.webid is required');
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.scopes must be a non-empty array');
    }
    if (expiresIn !== undefined && (typeof expiresIn !== 'number' || expiresIn <= 0)) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.expiresIn must be a positive number of milliseconds');
    }

    let id = identity;
    if (!id) {
      try {
        id = await deriveIdentity(vault);
      } catch (err) {
        return sendError(res, 503, 'NO_IDENTITY', err?.message ?? 'no identity material in vault');
      }
    }

    // Translate scope strings.  Accept either fully-qualified scope strings
    // ("pod.read:/some/path") or short forms ("read", "write", "delete", "*").
    const podRoot = engine.podRoot;
    let scopeStrings;
    try {
      scopeStrings = scopes.map((s) => normalizeScope(s, path));
    } catch (err) {
      return sendError(res, 400, 'BAD_REQUEST', err.message);
    }

    try {
      const token = await PodCapabilityToken.issue(id, {
        subject:   webid,
        pod:       podRoot,
        scopes:    scopeStrings,
        expiresIn: expiresIn ?? 3_600_000,
      });
      res.json({ token: token.toJSON() });
    } catch (err) {
      sendError(res, 500, 'ISSUE_FAILED', err?.message ?? String(err));
    }
  });

  // ── /sync/now ─────────────────────────────────────────────────────────────
  router.post('/sync/now', async (req, res) => {
    const body = req.body ?? {};
    const direction = body.direction ?? 'both';
    if (!['both', 'push', 'pull'].includes(direction)) {
      return sendError(res, 400, 'BAD_DIRECTION',
        'direction must be "both" | "push" | "pull"');
    }

    // Fire-and-forget; progress + done go over WS.  202 = accepted-not-yet-done.
    res.status(202).json({ ok: true, started: true });

    hub.broadcast({ type: 'sync.progress', phase: 'start', direction });
    Promise.resolve()
      .then(() => engine.runOnce({ direction }))
      .then(() => {
        // sync.done is broadcast by wsHub via the engine's 'synced' event; no-op here.
      })
      .catch((err) => {
        hub.broadcast({
          type:    'error',
          phase:   'sync.now',
          message: err?.message ?? String(err),
        });
      });
  });

  // ── /watch/start ──────────────────────────────────────────────────────────
  router.post('/watch/start', (_req, res) => {
    try {
      if (!engine.__watching) {
        engine.start();
        engine.__watching = true;
      }
      hub.broadcast({ type: 'status', stats: engine.stats ?? {}, watching: true });
      res.json({ ok: true, watching: true });
    } catch (err) {
      sendError(res, 500, 'WATCH_START_FAILED', err?.message ?? String(err));
    }
  });

  // ── /watch/stop ───────────────────────────────────────────────────────────
  router.post('/watch/stop', async (_req, res) => {
    try {
      if (engine.__watching) {
        await engine.stop();
        engine.__watching = false;
      }
      hub.broadcast({ type: 'status', stats: engine.stats ?? {}, watching: false });
      res.json({ ok: true, watching: false });
    } catch (err) {
      sendError(res, 500, 'WATCH_STOP_FAILED', err?.message ?? String(err));
    }
  });

  // 404 for anything else under this router (lets index.js mount it cleanly).
  router.use((_req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'no such endpoint');
  });

  return router;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/**
 * Walk a tree, collecting absolute paths of files containing conflict markers.
 * Skips dotfiles (which also skips the .canopy/ metadata dir).
 */
async function walkConflicts(root, dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walkConflicts(root, full, out);
    } else if (e.isFile()) {
      if (!/\.(md|markdown|txt|json|html?|css)$/i.test(e.name)) continue;
      try {
        const text = await fs.readFile(full, 'utf8');
        if (hasConflictMarkers(text)) out.push(full);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Extract one side of a git-style conflict block.
 *   <<<<<<< YOURS …\n MINE \n=======\n THEIRS \n>>>>>>> THEIRS …\n
 *
 * Multiple conflict regions are all reduced to the chosen side.
 *
 * @param {string} text
 * @param {'mine'|'theirs'} side
 * @returns {string|null}
 */
function extractSide(text, side) {
  // Use a loose regex that tolerates any header text after the marker.
  const re = /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*\n?/gm;
  let lastIndex = 0;
  let result = '';
  let matched = false;
  let match;
  while ((match = re.exec(text)) !== null) {
    matched = true;
    result += text.slice(lastIndex, match.index);
    result += side === 'mine' ? match[1] : match[2];
    lastIndex = re.lastIndex;
  }
  if (!matched) return null;
  result += text.slice(lastIndex);
  return result;
}

/**
 * Build an AgentIdentity from the vault.
 * Mirrors the logic in shareCmd.js.
 */
async function deriveIdentity(vault) {
  if (!vault) throw new Error('no vault provided to /share');
  const seedB64  = await vault.get('bootstrap-seed-b64');
  const mnemonic = await vault.get('bootstrap-mnemonic');
  if (!seedB64 && !mnemonic) {
    throw new Error('no identity material in vault — run `folio init`');
  }
  const bootstrap = seedB64
    ? Bootstrap.fromSeed(new Uint8Array(Buffer.from(seedB64, 'base64')))
    : Bootstrap.fromMnemonic(mnemonic);
  return new AgentIdentity({ seed: bootstrap.secret, vault: null });
}

/**
 * Normalize a scope spec to a `pod.<verb>:/<path>` string.
 * Accepts:
 *   - "pod.read:/foo"        — used as-is.
 *   - "read" / "write" / "delete" / "*"  — combined with `path` (default '/').
 */
function normalizeScope(scope, path) {
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new Error('each scope must be a non-empty string');
  }
  if (scope.startsWith('pod.')) return scope;
  const verb = scope;
  if (!['read', 'write', 'delete', '*'].includes(verb)) {
    throw new Error(`invalid scope verb "${verb}"; expected read|write|delete|* or a fully-qualified pod.<verb>:<path>`);
  }
  const p = typeof path === 'string' && path.length > 0 ? path : '/';
  const normalized = p.startsWith('/') ? p : `/${p}`;
  return `pod.${verb}:${normalized}`;
}
