/**
 * folio rm <path> — tombstone a file so it isn't re-downloaded.
 *
 * Forwards to `SyncEngine.deleteLocal(relPath)`.  The pod resource is
 * untouched; on the next sync, the local file will not be re-downloaded
 * (the pod-client's tombstone store hides it from list() / read() flows).
 *
 * Path argument is treated as POSIX-style relative to localRoot.
 */
import { SyncEngine }      from '../SyncEngine.js';
import { requireConfig }   from './_config.js';
import { buildPodClient }  from './_podFactory.js';

export async function rmCmd(args) {
  const path = args[0];
  if (!path) throw new Error('usage: folio rm <path>');

  const cfg       = await requireConfig();
  const podClient = await buildPodClient(cfg);
  const engine    = new SyncEngine({
    podClient,
    localRoot:      cfg.localRoot,
    podRoot:        cfg.podRoot,
    pollIntervalMs: cfg.intervalMs ?? 60_000,
  });

  // Normalise: leading slashes and OS-specific separators are folded to POSIX.
  const rel = String(path).replace(/^[\/\\]+/, '').replace(/\\/g, '/');
  await engine.deleteLocal(rel);
  console.log(`tombstoned ${rel} — it will not be re-downloaded on the next sync.`);
}
