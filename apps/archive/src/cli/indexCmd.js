/**
 * archive index [--source <name|id>] [--force]
 *
 * Walks each registered source's pod root via PodClient.list, downloads
 * resources, and updates the local index.  Skips resources whose sha256
 * is unchanged unless --force is given.
 */
import { Db }            from '../Db.js';
import { indexSource }   from '../Indexer.js';
import { resolveSource } from '../Sources.js';
import { requireConfig } from './_config.js';
import { buildPodClient } from './_podFactory.js';

export async function indexCmd(args = []) {
  const force = args.includes('--force') || args.includes('-f');
  let sourceSelector = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--source') {
      sourceSelector = args[i + 1];
      i++;
    } else if (a.startsWith('--source=')) {
      sourceSelector = a.slice('--source='.length);
    }
  }

  const cfg = await requireConfig();
  const db  = Db.open(cfg.dbPath);
  try {
    const sources = sourceSelector
      ? [resolveSource(db, sourceSelector)].filter(Boolean)
      : db.listSources();

    if (sources.length === 0) {
      if (sourceSelector) {
        const err = new Error(`no source found matching '${sourceSelector}'`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      console.log('archive index: no sources registered. Run `archive add-source <pod-root>` first.');
      return;
    }

    let totals = {
      sources: 0, scanned: 0, inserted: 0, updated: 0,
      unchanged: 0, errors: 0, ftsIndexed: 0, ftsSkippedBinary: 0, ftsTruncated: 0,
    };
    for (const source of sources) {
      const podClient = await buildPodClient(source);
      const stats = await indexSource({ db, source, podClient, force });
      totals.sources++;
      for (const k of Object.keys(stats)) totals[k] = (totals[k] ?? 0) + stats[k];
      console.log(`source ${source.name} (${source.podRoot}):`);
      console.log(`  scanned:    ${stats.scanned}`);
      console.log(`  inserted:   ${stats.inserted}`);
      console.log(`  updated:    ${stats.updated}`);
      console.log(`  unchanged:  ${stats.unchanged}`);
      console.log(`  fts indexed:${stats.ftsIndexed}`);
      console.log(`  fts binary: ${stats.ftsSkippedBinary}`);
      if (stats.ftsTruncated > 0) console.log(`  fts truncated: ${stats.ftsTruncated}`);
      if (stats.errors > 0)       console.log(`  errors:     ${stats.errors}`);
    }
    if (sources.length > 1) {
      console.log('');
      console.log(`total across ${totals.sources} source(s):`);
      console.log(`  scanned:   ${totals.scanned}`);
      console.log(`  inserted:  ${totals.inserted}`);
      console.log(`  updated:   ${totals.updated}`);
      console.log(`  unchanged: ${totals.unchanged}`);
    }
  } finally {
    db.close();
  }
}
