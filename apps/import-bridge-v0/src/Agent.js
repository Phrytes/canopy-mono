/**
 * ImportAgent — composition of substrates for H6 V0.
 *
 * Migrated 2026-05-04 (Phase 5.1 of substrate refactor): the previous
 * shape composed `@onderling/sync-engine`'s V0 `SyncEngine` +
 * `IngestQueueSource` + `InMemoryBackend`, all of which reinvented
 * `core.DataSource`. Per the L1a audit, V0 sync-engine was deleted and
 * import-bridge now writes directly through the SDK's `DataSource`
 * shape (any `DataSource` subclass — `core.MemorySource` for tests,
 * `pod-client.PodClient`-wrapped adapter in production).
 *
 * Wires:
 *   - `core.OAuthVault` — per-source credentials.
 *   - **`target` adapter** (any `core.DataSource`) — the pod-side write path.
 *   - `@onderling/identity-resolver`'s `PersonGraph` — cross-source identity records.
 *
 * V0 semantics are unchanged: one-shot import. Connectors yield items
 * via async-iterator; the agent writes each item to `target.write(uri, value)`.
 * Sync mode (webhooks + polling) is V1+ and would compose
 * `core.protocol.LiveSyncSkill` directly.
 */

import { Emitter } from '@onderling/core';
import { OAuthVault, VaultMemory } from '@onderling/vault';
import { PersonGraph } from '@onderling/identity-resolver/person-graph';

/**
 * @param {object} args
 * @param {Array<import('./types.js').Connector>} args.connectors
 * @param {{write: (uri: string, value: any) => Promise<void>, read?: (uri: string) => Promise<any>}} args.target
 *   Any `core.DataSource`. Tests use `core.MemorySource`; production
 *   wraps `pod-client.PodClient`. Replaces the V0 `backend` parameter.
 * @param {string} args.podRoot                 pod URL/path; agent writes under here
 * @param {object} [args.oauthVault]            optional pre-built OAuthVault
 * @param {object} [args.personGraph]           optional pre-built PersonGraph
 * @returns {Promise<{
 *   target:      object,
 *   oauthVault:  object,
 *   personGraph: PersonGraph,
 *   connectors:  Array,
 *   events:      Emitter,
 *   runOnce:     (filters?: object) => Promise<{imported: number, errors: object[]}>,
 *   start:       () => Promise<void>,
 *   stop:        () => Promise<void>,
 * }>}
 */
export async function createImportAgent({
  connectors,
  target,
  // Back-compat alias: old callers passed `backend`. Treat as `target` if `target` not given.
  backend,
  podRoot,
  oauthVault,
  personGraph,
}) {
  if (!Array.isArray(connectors) || connectors.length === 0) {
    throw new TypeError('createImportAgent: at least one connector required');
  }
  const writeTarget = target ?? backend;
  if (!writeTarget || typeof writeTarget.write !== 'function') {
    throw new TypeError('createImportAgent: target with write() required');
  }
  if (!podRoot) {
    throw new TypeError('createImportAgent: podRoot required');
  }

  const _vault = oauthVault   ?? new OAuthVault({ vault: new VaultMemory() });
  const _graph = personGraph ?? new PersonGraph();

  // Events emitter — replaces the pre-2026-05-04 `syncEngine.on('synced', ...)` path.
  const events = new Emitter();

  const start = async () => { /* no-op for V0 one-shot */ };
  const stop  = async () => { /* no-op */ };

  const runOnce = async (filters) => {
    let imported = 0;
    const errors = [];

    for (const connector of connectors) {
      try {
        const iter = connector.import({
          oauthVault: _vault,
          personGraph: _graph,
          filters: filters ?? {},
        });
        for await (const item of iter) {
          // Identifier observations → PersonGraph (V0: observe-only;
          // auto-link on identifier collision).
          if (Array.isArray(item.people)) {
            for (const id of item.people) {
              try {
                await _graph.observe({
                  identifier: id,
                  observedIn: { source: connector.id, sourceId: item.relPath },
                });
              } catch (err) {
                errors.push({ connector: connector.id, kind: 'person-graph', error: String(err) });
              }
            }
          }

          // Write the item to the target. Strip the connector-only `people`
          // field; everything else flows through.
          const { people, ...record } = item;
          void people;
          const uri = `${podRoot}/${item.relPath.replace(/^\//, '')}`;
          try {
            await writeTarget.write(uri, record);
            events.emit('synced', { path: uri, item: record });
            imported++;
          } catch (err) {
            errors.push({ connector: connector.id, kind: 'write', uri, error: err?.message ?? String(err) });
          }
        }
      } catch (err) {
        errors.push({ connector: connector.id, kind: 'import', error: err?.message ?? String(err) });
      }
    }

    return { imported, errors };
  };

  return {
    target:      writeTarget,
    oauthVault:  _vault,
    personGraph: _graph,
    connectors,
    events,
    runOnce,
    start,
    stop,
  };
}
