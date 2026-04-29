/**
 * archive search "<query>" [--limit N] [--source <name|id>]
 *
 * Runs an FTS5 MATCH against the indexed content.  Results print one per
 * line, ordered by FTS5 rank:
 *
 *   <rel-path>  [<source-name>]  <last-modified-iso>  <snippet>
 */
import { Db }            from '../Db.js';
import { search }        from '../Search.js';
import { resolveSource } from '../Sources.js';
import { requireConfig } from './_config.js';

export async function searchCmd(args = []) {
  const positional = [];
  let limit = 20;
  let sourceSelector = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (a.startsWith('--limit=')) {
      limit = parseInt(a.slice('--limit='.length), 10);
    } else if (a === '--source') {
      sourceSelector = args[i + 1];
      i++;
    } else if (a.startsWith('--source=')) {
      sourceSelector = a.slice('--source='.length);
    } else if (a.startsWith('-')) {
      const err = new Error(`unknown flag: ${a}`);
      err.code = 'BAD_FLAG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    const err = new Error('usage: archive search "<query>" [--limit N] [--source X]');
    err.code = 'USAGE';
    throw err;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    const err = new Error('--limit must be a positive integer');
    err.code = 'USAGE';
    throw err;
  }
  // Join positionals so callers don't have to quote at every shell level.
  const query = positional.join(' ');

  const cfg = await requireConfig();
  const db  = Db.open(cfg.dbPath);
  try {
    let sourceId = null;
    if (sourceSelector) {
      const src = resolveSource(db, sourceSelector);
      if (!src) {
        const err = new Error(`no source matching '${sourceSelector}'`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      sourceId = src.id;
    }

    const rows = search(db, query, { limit, sourceId });
    if (rows.length === 0) {
      console.log('(no results)');
      return;
    }
    for (const row of rows) {
      const lm = row.lastModified
        ? new Date(row.lastModified).toISOString()
        : '-';
      // One result per line, tab-separated for easy piping.
      const snippet = (row.snippet ?? '').replace(/\s+/g, ' ').trim();
      console.log(`${row.relPath}\t[${row.sourceName}]\t${lm}\t${snippet}`);
    }
  } finally {
    db.close();
  }
}
