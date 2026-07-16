/**
 * createArchiveWebServer — start an archive `core.Agent` and expose it
 * over A2A on `127.0.0.1` via `mountLocalUi` from `@onderling/agent-ui`.
 *
 * Migrated 2026-05-04 from the legacy `SkillRouter + EventBroadcaster +
 * bespoke Express endpoints (POST /api/skills/:id)` shape (deleted in
 * L1d Phase 3.1) to A2A's standard wire shape:
 *
 *   GET  /.well-known/agent.json
 *   POST /tasks/send                 → run skill, return JSON result
 *   POST /tasks/sendSubscribe        → run skill, return SSE stream
 *   POST /tasks/:id/cancel
 *   GET  /tasks/:id
 *
 * Apps that want event fan-out either register a streaming skill (the
 * `POST /tasks/sendSubscribe` SSE path) or subscribe to substrate
 * emitters directly (e.g. `db` or future indexer events).
 *
 * Usage:
 *
 *   const { agent, url, stop } = await createArchiveWebServer({
 *     db,
 *     port: 8080,
 *   });
 *   // ... when shutting down:
 *   await stop();
 */

import { mountLocalUi } from '@onderling/agent-ui';

import { createArchiveAgent } from './agent.js';
import { PodSearchAdapter }   from '../PodSearchAdapter.js';

const ARCHIVE_SCHEMA = {
  fields: {
    id:           { primary: true },
    sourceName:   { facet: true },
    sourceId:     { facet: true },
    podUri:       { sortable: true },
    relPath:      { fts: true, weight: 1.5 },
    contentType:  { facet: true },
    lastModified: { sortable: true },
  },
};

/**
 * @param {object} args
 * @param {import('../Db.js').Db} args.db
 * @param {number} [args.port=0]                    HTTP port. 0 → OS picks one.
 * @param {string} [args.host='127.0.0.1']          bind interface (localhost-only by default)
 * @param {boolean} [args.usePodSearchAdapter=true] route archive.search via L1i's PodSearch API
 * @returns {Promise<{
 *   agent:    import('@onderling/core').Agent,
 *   url:      string,
 *   port:     number,
 *   schema:   object,
 *   stop:     () => Promise<void>,
 * }>}
 */
export async function createArchiveWebServer({
  db,
  port                = 0,
  host                = '127.0.0.1',
  usePodSearchAdapter = true,
} = {}) {
  if (!db) throw new TypeError('createArchiveWebServer: db required');

  // Build the L1i PodSearch adapter when configured.
  let podSearch = null;
  if (usePodSearchAdapter) {
    const sources = db.listSources();
    const adapter = new PodSearchAdapter({
      db,
      defaultSourceId: sources[0]?.id ?? null,
    });
    // Adapter conforms to PodSearch's public API; downstream consumers
    // can pass either a real `new PodSearch(...)` or this adapter.
    podSearch = adapter;
  }

  const { agent } = await createArchiveAgent({ db, podSearch });
  const ui = await mountLocalUi(agent, { port, host });

  return {
    agent,
    url:    ui.url,
    port:   ui.port,
    schema: ARCHIVE_SCHEMA,
    stop:   async () => {
      await ui.stop();
      await agent.stop();
    },
  };
}
