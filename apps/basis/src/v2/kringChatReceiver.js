/**
 * basis v2 — kring chat-message receiver substrate (SP-13.2.1).
 *
 * Builds a `(fromPeerAddr, payload) => void` handler that matches the
 * shape registered on the existing peer-router.  Since ε.1 the actual
 * normalization (envelope validation, msgId dedup, durable mirror via
 * `ingest`, eventLog append) lives in `chatMessageInbox` — a SINGLE
 * gate every kring-chat insert path (receiver / rehydrator / future
 * catch-up / pod range-query) routes through.  This file is now a
 * thin source-tagging wrapper that:
 *
 *   • forwards the NKN envelope to `inbox.ingestChatMessage` with
 *     `source: 'receiver'` + the `fromPeerAddr`
 *   • keeps the legacy `{ eventLog, ingest, dedup, resolveActor, ... }`
 *     call shape working via a back-compat shim so existing tests
 *     and call sites that haven't migrated still build a usable
 *     handler without code-changing them in lockstep.
 *
 * Hosts (web + mobile) construct ONE inbox per agent at boot and
 * pass it to this factory.  Each surface keeps the inbox as a
 * sibling of the eventLog so all paths share its dedup state.
 */

import { createChatMessageInbox, isValidChatEnvelope } from './chatMessageInbox.js';

/**
 * Build the kring-chat-message peer handler.
 *
 * Two call shapes are supported:
 *
 *   1. ε.1+    — `{ inbox, resolveActor?, logger? }`
 *   2. legacy  — `{ eventLog, ingest?, dedup?, resolveActor?, logger?, dedupCap? }`
 *                In legacy mode the shim builds a private inbox around
 *                the provided eventLog/ingest so the handler still works.
 *                The `dedup` arg is honoured only when the inbox is built
 *                here (so existing tests that share a `Set` across two
 *                handlers keep passing).
 *
 * @returns {(fromPeerAddr: string, payload: object) => Promise<void>}
 */
export function makeKringChatPeerHandler(args = {}) {
  const {
    inbox: providedInbox = null,
    eventLog             = null,
    ingest               = null,
    dedup                = null,
    resolveActor         = null,
    logger               = console,
    dedupCap,
  } = args;

  let inbox = providedInbox;
  if (!inbox) {
    if (!eventLog || typeof eventLog.append !== 'function') {
      throw new Error('makeKringChatPeerHandler: inbox or eventLog.append required');
    }
    inbox = makeLegacyInbox({ eventLog, ingest, dedup, logger, dedupCap });
  }

  return async function onKringChatMessage(fromPeerAddr, payload) {
    await inbox.ingestChatMessage(payload, {
      source: 'receiver',
      fromPeerAddr,
      resolveActor,
    });
  };
}

/**
 * Back-compat shim: wraps `createChatMessageInbox` so a caller-supplied
 * `dedup` Set is honoured for the lifetime of this handler.  Lets the
 * existing "two handlers share a dedup Set" tests keep their semantics
 * without rewriting every call site at once.
 *
 * Once all call sites construct the inbox up-front this can be removed.
 */
function makeLegacyInbox({ eventLog, ingest, dedup, logger, dedupCap }) {
  const real = createChatMessageInbox({
    eventLog, ingest, logger,
    dedupCap: dedupCap ?? undefined,
  });
  if (!dedup) return real;
  // The shared-Set legacy path: we intercept ingestChatMessage so
  // dedup-state lives in the caller's Set, not the inbox's LRU.
  return {
    async ingestChatMessage(envelope, opts) {
      // Only consult/populate the shared Set on valid envelopes so we
      // don't poison it with empty-string msgIds or wrong-subtype
      // payloads from malformed-envelope tests.
      if (isValidChatEnvelope(envelope)) {
        if (dedup.has(envelope.msgId)) {
          logger.debug?.('[kring-chat] duplicate msgId (shared dedup), skipping', envelope.msgId);
          return { result: 'deduped' };
        }
        dedup.add(envelope.msgId);
      }
      return real.ingestChatMessage(envelope, opts);
    },
    _seen: real._seen,
  };
}

// Re-export so callers that haven't migrated to chatMessageInbox.js
// still find the validator next to the receiver factory.
export { isValidChatEnvelope } from './chatMessageInbox.js';
