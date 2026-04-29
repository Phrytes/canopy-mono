/**
 * folio sync — one-shot push+pull.
 *
 * Reads config, builds a PodClient + SyncEngine, calls runOnce(), prints stats.
 *
 * Flags:
 *   --push    push only
 *   --pull    pull only
 */
import { SyncEngine }      from '../SyncEngine.js';
import { requireConfig }   from './_config.js';
import { buildPodClient }  from './_podFactory.js';

export async function syncCmd(args) {
  const direction = args.includes('--push') ? 'push'
                  : args.includes('--pull') ? 'pull'
                  : 'both';

  const cfg       = await requireConfig();
  const podClient = await buildPodClient(cfg);
  const engine    = new SyncEngine({
    podClient,
    localRoot:      cfg.localRoot,
    podRoot:        cfg.podRoot,
    pollIntervalMs: cfg.intervalMs ?? 60_000,
  });

  engine.on('error', (e) => {
    console.error(`folio sync: ${e.phase}: ${e.relPath ?? ''} ${e.err?.message ?? ''}`);
  });

  const r = await engine.runOnce({ direction });
  console.log(`uploads:   ${r.uploads}`);
  console.log(`downloads: ${r.downloads}`);
  console.log(`deletes:   ${r.deletes}`);
  console.log(`conflicts: ${r.conflicts}`);
}
