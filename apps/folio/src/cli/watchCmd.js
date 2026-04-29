/**
 * folio watch — continuous sync.
 *
 * Foreground loop; SIGINT / SIGTERM stop the engine cleanly.
 *
 *   - chokidar watches the local folder; debounced runOnce on FS events.
 *   - interval timer scans the pod every cfg.intervalMs.
 *
 * Stats print on every 'synced' event.
 */
import { SyncEngine }      from '../SyncEngine.js';
import { requireConfig }   from './_config.js';
import { buildPodClient }  from './_podFactory.js';

export async function watchCmd(_args) {
  const cfg       = await requireConfig();
  const podClient = await buildPodClient(cfg);
  const engine    = new SyncEngine({
    podClient,
    localRoot:      cfg.localRoot,
    podRoot:        cfg.podRoot,
    pollIntervalMs: cfg.intervalMs ?? 60_000,
  });

  engine.on('error', (e) => {
    console.error(`folio watch: ${e.phase}: ${e.relPath ?? ''} ${e.err?.message ?? ''}`);
  });
  engine.on('synced', (s) => {
    if (s.uploads || s.downloads || s.deletes || s.conflicts) {
      const stamp = new Date().toISOString();
      console.log(
        `[${stamp}] sync — uploads: ${s.uploads}, downloads: ${s.downloads}, ` +
        `deletes: ${s.deletes}, conflicts: ${s.conflicts}`,
      );
    }
  });
  engine.on('conflict', (c) => {
    console.log(`conflict in ${c.relPath} — run \`folio conflicts --resolve\` to resolve`);
  });

  console.log(`folio watch — local: ${cfg.localRoot} ↔ pod: ${cfg.podRoot}  (Ctrl-C to stop)`);
  engine.start();

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nfolio watch: ${sig} received, stopping…`);
    try { await engine.stop(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Park the process until a signal arrives.
  await new Promise(() => {});
}
