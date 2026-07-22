/**
 * groupKeyEvent — the RECEIVE-side handler for an inbound `group-key-event` peer message (the no-pod group-key
 * rotation carrier). It is the counterpart to `@onderling/kring-host` `keyEventLogSink`, which FANS a versioned
 * key-event to a circle's remaining members on establish/grant/rotation. Here a member RECORDS an event it
 * receives into its local per-circle key-event log (`keyEventStore`), so a later content read folds it into the
 * key chain and opens exactly the versions the member is entitled to — with NO pod.
 *
 * A removed member is never a recipient of the rotation fan, so it never receives (and never records) the new
 * version's key-event → its folded chain lacks that version → it cannot open post-removal content (backward
 * secrecy, entirely from what it received). An offline member catches the held key-event up on reconnect (it is
 * a durable held peer message, re-delivered like any other) and records it then.
 *
 * Deps are injected (`recordKeyEvent` = the store's `record`, `logger`), so this is pure + unit-testable and the
 * web shell (circleApp.js) and the node harness wire the SAME handler into the SAME `makePeerRouter` dispatch by
 * subtype — no per-shell stand-in (CLAUDE.md invariants #1/#2). Recording is ALL a receiver does; folding
 * happens on read.
 */
import { KEY_EVENT_KIND } from '@onderling/pod-client';

/**
 * @param {object} deps
 * @param {(groupId: (string|null), event: object) => boolean} deps.recordKeyEvent  record into the local
 *   per-circle key-event log (de-duped by version). Typically a `createKeyEventStore().record`.
 * @param {{info?: Function, warn?: Function, error?: Function}} [deps.logger]
 * @returns {(fromAddr: string, payload: {groupId?: string, event: object}) => {ok: boolean, groupId?: (string|null), version?: number, reason?: string}}
 */
export function makeHandleGroupKeyEvent({ recordKeyEvent, logger = console } = {}) {
  if (typeof recordKeyEvent !== 'function') {
    throw new Error('makeHandleGroupKeyEvent: a recordKeyEvent(groupId, event) function is required');
  }
  return function handleGroupKeyEvent(fromAddr, payload) {
    const event = payload?.event;
    const groupId = payload?.groupId ?? event?.groupId ?? null;
    if (!event || event.kind !== KEY_EVENT_KIND || typeof event.sealed !== 'string' || !Number.isInteger(event.version)) {
      logger.warn?.('[peer] group-key-event missing or malformed', payload);
      return { ok: false, reason: 'invalid-event' };
    }
    try {
      const recorded = recordKeyEvent(groupId, event);
      logger.info?.(`[peer] group-key-event recorded: ${groupId ?? '(no group)'} v${event.version}`);
      return { ok: true, groupId, version: event.version, recorded: recorded !== false };
    } catch (err) {
      logger.error?.('[peer] handleGroupKeyEvent failed', err);
      return { ok: false, reason: err?.message ?? String(err) };
    }
  };
}
