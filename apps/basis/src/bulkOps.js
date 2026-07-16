/**
 * basis — bulk-op fan-out.
 *
 * `/done all` (and analogues) needs to fire ONE op against MANY items.
 * The bulk runner does this sequentially per-item and collects results.
 * Per OQ-4 user resolution (2026-05-21): bulk ops should affect every
 * thread that surfaces affected items — that happens automatically via
 * the EventRouter (mutation skills emit item-changed events; the router
 * matches them against each thread's filter).
 *
 * v0.2.2 ships the pure-logic helper.  Parser/router integration ("all"
 * keyword detection → fan-out) lands in v0.3 alongside the form-confirm
 * UX so the user can review N items before dispatch.
 *
 * Phase v0.2 sub-slice 2.7 per `/Project Files/basis/coding-plan.md`.
 */

/**
 * Bulk fan-out keywords.  When a slash body is one of these (and the op
 * targets an item id), the router returns a `bulk` dispatch instead of
 * binding the word as a literal id.  English-first, with the common
 * Dutch forms so `/done alle` works too.
 */
export const BULK_KEYWORDS = new Set([
  'all', 'everything',          // en
  'alle', 'allemaal', 'alles',  // nl
]);

/**
 * @param {*} s  a candidate slash-body string (the parser's `_match`)
 * @returns {boolean} true when `s` is a bulk-fan-out keyword
 */
export function isBulkKeyword(s) {
  return typeof s === 'string' && BULK_KEYWORDS.has(s.trim().toLowerCase());
}

/**
 * @typedef {object} BulkOpRequest
 * @property {string}                                  opId
 * @property {string}                                  appOrigin
 * @property {Array<{id: string}>}                     items
 * @property {string}                                  argName
 *   The op param to bind each item id to (e.g. `'choreId'` for
 *   household.markComplete).  The router's _match-binding does this
 *   automatically for single dispatches; bulk callers state it
 *   explicitly.
 * @property {object}                                  [baseArgs]
 *   Extra args merged into each per-item call (e.g. a `reason`
 *   shared across all items).
 * @property {import('./dispatch.js').CallSkill}       callSkill
 * @property {(event: object) => void}                 [emitEvent]
 *   Optional EventRouter.deliver function — receives an item-changed
 *   event for each successful operation so the fan-out reaches other
 *   threads per OQ-4.
 */

/**
 * @typedef {object} BulkOpResult
 * @property {Array<{itemId: string, payload: *}>}     successes
 * @property {Array<{itemId: string, error: {code: string, message: string}}>} failures
 * @property {{total: number, ok: number, failed: number}} stats
 */

/**
 * Run a bulk op against a list of items.  Sequential — preserves
 * order; failures don't halt the whole run.
 *
 * @param {BulkOpRequest} req
 * @returns {Promise<BulkOpResult>}
 */
export async function runBulkOp(req) {
  if (!req || typeof req !== 'object') {
    throw new TypeError('runBulkOp: request required');
  }
  const { opId, appOrigin, items, argName, baseArgs, callSkill, emitEvent } = req;
  if (typeof opId      !== 'string' || opId      === '') throw new TypeError('runBulkOp: opId required');
  if (typeof appOrigin !== 'string' || appOrigin === '') throw new TypeError('runBulkOp: appOrigin required');
  if (typeof argName   !== 'string' || argName   === '') throw new TypeError('runBulkOp: argName required');
  if (typeof callSkill !== 'function')                   throw new TypeError('runBulkOp: callSkill required');
  if (!Array.isArray(items))                             throw new TypeError('runBulkOp: items must be an array');

  const successes = [];
  const failures  = [];

  for (const item of items) {
    const itemId = item?.id ?? String(item);
    const args = { ...(baseArgs ?? {}), [argName]: itemId };
    try {
      const payload = await callSkill(appOrigin, opId, args);
      // Honour app convention: payload.ok === false → failure.
      if (payload && typeof payload === 'object' && payload.ok === false) {
        failures.push({
          itemId,
          error: {
            code:    'skill-returned-not-ok',
            message: typeof payload.error === 'string'
                       ? payload.error
                       : (payload.error?.message ?? 'Failed'),
          },
        });
        continue;
      }
      successes.push({ itemId, payload });
      // Fan-out via EventRouter (per OQ-4).  Optional — caller may
      // omit emitEvent if they don't want cross-thread propagation.
      if (typeof emitEvent === 'function') {
        try {
          emitEvent({
            app:   appOrigin,
            type:  'item-changed',
            itemRef: { app: appOrigin, type: 'item', id: itemId },
            payload: {
              message: `${appOrigin}.${opId}(${itemId}) completed`,
              op:      opId,
              item:    itemId,
              result:  payload,
            },
          });
        } catch { /* swallow emit errors — they shouldn't fail the bulk */ }
      }
    } catch (err) {
      failures.push({
        itemId,
        error: {
          code:    err?.code ?? 'dispatch-error',
          message: err?.message ?? String(err),
        },
      });
    }
  }

  return {
    successes,
    failures,
    stats: {
      total:  items.length,
      ok:     successes.length,
      failed: failures.length,
    },
  };
}

/**
 * E2 — resolve bulk candidate ids from a flat message array (the mobile
 * threadState shape, where there is no `_listings` cache).  Scans newest
 * → oldest for a list-shaped reply with items, preferring one from a
 * given app (matched on `message.sourceDispatch.appOrigin`); falls back
 * to the freshest list of any app.  Mirrors web's `Thread.lastListing`.
 *
 * @param {Array<{rendered?: object, sourceDispatch?: object}>} messages
 * @param {{ appOrigin?: string }} [opts]
 * @returns {string[]}
 */
export function lastListingItems(messages, opts = {}) {
  if (!Array.isArray(messages)) return [];
  const { appOrigin } = opts;
  let fallback = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const r = messages[i]?.rendered;
    if (r?.kind !== 'list' || !Array.isArray(r.items)) continue;
    const ids = r.items.map((it) => it?.id).filter(Boolean);
    if (ids.length === 0) continue;
    const app = messages[i]?.sourceDispatch?.appOrigin;
    if (appOrigin && app && app !== appOrigin) {
      if (!fallback) fallback = ids;   // freshest other-app list, as fallback
      continue;
    }
    return ids;                        // same-app (or unfiltered) → freshest wins
  }
  return fallback ?? [];
}

/**
 * E2 — run a `bulk` dispatch (from the router) over a resolved set of
 * item ids and produce a summarised text reply.  Shared by the web and
 * mobile hosts so the fan-out behaves identically on both.
 *
 * @param {object}   args
 * @param {{opId: string, appOrigin: string, argName: string, baseArgs?: object}} args.bulk
 * @param {string[]} args.itemIds            candidate ids (from the listing)
 * @param {import('./dispatch.js').CallSkill} args.callSkill
 * @param {(event: object) => void} [args.emitEvent]  EventRouter.deliver
 * @param {string}   [args.opLabel]          human label for the summary
 * @returns {Promise<{ message: string, ok: boolean, result: BulkOpResult }>}
 */
export async function executeBulkDispatch({ bulk, itemIds, callSkill, emitEvent, opLabel }) {
  const result = await runBulkOp({
    opId:      bulk.opId,
    appOrigin: bulk.appOrigin,
    items:     (itemIds ?? []).map((id) => ({ id })),
    argName:   bulk.argName,
    baseArgs:  bulk.baseArgs,
    callSkill,
    emitEvent,
  });
  const summary = summariseBulkOp(result, { opLabel: opLabel ?? bulk.opId });
  return { ...summary, result };
}

/**
 * Format a BulkOpResult as a single human-readable message body
 * suitable for the renderer's text shape.  Used by the chat shell
 * after a /done-all-style dispatch.
 *
 * @param {BulkOpResult} result
 * @param {object} [opts]
 * @param {string} [opts.opLabel]   e.g. 'Marked complete' / 'Archived'
 * @returns {{ message: string, ok: boolean }}
 */
export function summariseBulkOp(result, opts = {}) {
  const opLabel = opts.opLabel ?? 'Bulk op';
  const { ok, failed, total } = result.stats;
  if (failed === 0) {
    return {
      message: `✓ ${opLabel}: ${ok}/${total} items.`,
      ok:      true,
    };
  }
  if (ok === 0) {
    return {
      message: `✗ ${opLabel}: all ${failed} items failed.\n` +
               result.failures.map((f) => `  • ${f.itemId}: ${f.error.message}`).join('\n'),
      ok: false,
    };
  }
  return {
    message: `⚠ ${opLabel}: ${ok}/${total} succeeded, ${failed} failed.\n` +
             result.failures.map((f) => `  • ${f.itemId}: ${f.error.message}`).join('\n'),
    ok: false,
  };
}
