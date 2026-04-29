/**
 * archive status
 *
 * Prints the registered sources, per-source counts, last-indexed
 * timestamps, and the on-disk size of the SQLite db.
 */
import { promises as fs } from 'node:fs';
import { Db }             from '../Db.js';
import { requireConfig }  from './_config.js';

export async function statusCmd(_args = []) {
  const cfg = await requireConfig();

  let dbSize = null;
  try {
    const stat = await fs.stat(cfg.dbPath);
    dbSize = stat.size;
  } catch { /* ignore — db may not exist yet */ }

  const db = Db.open(cfg.dbPath);
  try {
    const sources = db.listSources();
    const totalResources = db.countResources();

    console.log(`config:    ${cfg.dbPath}`);
    console.log(`db size:   ${dbSize == null ? '-' : `${dbSize} bytes`}`);
    console.log(`sources:   ${sources.length}`);
    console.log(`resources: ${totalResources}`);
    if (sources.length === 0) {
      console.log('');
      console.log('No sources registered. Run `archive add-source <pod-root>`.');
      return;
    }
    console.log('');
    for (const src of sources) {
      const count = db.countResources(src.id);
      const li    = src.lastIndexed ? new Date(src.lastIndexed).toISOString() : 'never';
      console.log(`  [${src.id}] ${src.name}`);
      console.log(`    pod-root:     ${src.podRoot}`);
      console.log(`    resources:    ${count}`);
      console.log(`    last indexed: ${li}`);
    }
  } finally {
    db.close();
  }
}
