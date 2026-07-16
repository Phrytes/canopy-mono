// Capability exposure (Objective S, v0) — a THIN projection of a DataConnector's `query` (and,
// optionally, `mutate`) into the `{ op, noun, handler }` shape the capability model consumes
// (the generic-handler / `dispatchCapability` seam in `@onderling/app-manifest` + `@onderling/item-store`,
// where a handler is `(noun, args, ctx) => result`).
//
// This lets an app-function DECLARE a noun backed by an external source and have "query it" become
// a gated `(atom × noun)` capability — WITHOUT this package depending on app-manifest/item-store or
// on basis. It is a projection only: the actual wiring into basis's dispatch is a LATER
// slice (reported as a seam), not done here.
//
// The produced `handler(noun, args, ctx)` reads `{ op, params }` off `args`, calls the connector,
// and returns a plain `{ ok, ... }` envelope (errors mapped to `{ ok:false, code }` — the same
// code-not-string discipline the rest of the substrate uses), so a caller never has to catch.

import { ConnectorError } from './errors.js';

/**
 * @param {import('./types.js').DataConnector} connector
 * @param {object} [opts]
 * @param {string} [opts.op='query']   the capability's op/atom label (e.g. 'query', 'list', 'read')
 * @param {string} [opts.noun]         the noun this capability is bound to (default: connector's describe().name)
 * @param {'query'|'mutate'} [opts.via='query']  which connector method to project
 * @returns {{ op: string, noun: string, handler: (noun: string, args?: object, ctx?: object) => Promise<{ok:boolean, data?:any, meta?:any, code?:string}> }}
 */
export function connectorAsCapability(connector, { op = 'query', noun, via = 'query' } = {}) {
  if (!connector || typeof connector[via] !== 'function') {
    throw new ConnectorError('E_CONNECTOR_BAD_REQUEST', `connectorAsCapability: connector has no \`${via}()\``);
  }
  const boundNoun = noun || connector.describe?.().name || connector.id;

  async function handler(_noun = boundNoun, args = {}, _ctx = {}) {
    // The op the connector runs comes off the args; the capability's own `op` is the atom label.
    const request = { op: args.op || (via === 'query' ? 'select' : undefined), params: args.params || {} };
    try {
      const result = await connector[via](request);
      return { ok: true, data: result.data, meta: result.meta };
    } catch (err) {
      if (err instanceof ConnectorError) return { ok: false, code: err.code };
      throw err; // non-connector (programmer) errors are not swallowed
    }
  }

  return { op, noun: boundNoun, handler };
}
