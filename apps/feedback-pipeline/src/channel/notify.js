// Two-way notify (PR-3) — a pseudonymous, store-and-forward OUTBOUND channel so the central
// agent can reach a participant AFTER the conversation (e.g. "your point was released in a
// report", a signal-track follow-up) without ever knowing who they are. Messages are keyed by
// the project pseudonym; when the participant registered an encryption key (roster.encKeyFor,
// bound at the HI handshake) the message is SEALED to them, so the host stores only ciphertext
// — host-blind two-way notify. Operational notices without an enc key are stored as-is.
//
// `InMemoryNotifier` is the testable/dev shape (pull inbox). `createPodNotifier` maps the same
// `notify()` onto the real substrate @canopy/notify-envelope (push delivery to pods, with the
// pending-upload queue for offline participants). Both expose `notify(participant, msg)`, which
// is all the release path depends on.

import { randomUUID } from 'node:crypto';
import { seal, open } from '../pod/project-seal.js';

/** Build the stored body for one notification: sealed to the participant when we hold their
 *  encryption key, else a plain payload. */
function bodyFor(roster, participant, payload) {
  const encKey = roster?.encKeyFor?.(participant);
  return encKey ? { sealed: seal(JSON.stringify(payload ?? {}), [encKey]) } : { payload: payload ?? {} };
}

export class InMemoryNotifier {
  #boxes = new Map();   // participant -> [ { id, type, at, sealed? | payload? } ]
  #roster;

  constructor({ roster } = {}) { this.#roster = roster; }

  /** Leave a notification for a participant. Sealed to them when an enc key is registered. */
  notify(participant, { type, payload, at = new Date().toISOString() } = {}) {
    if (!participant) throw new Error('notify: participant required');
    if (!type) throw new Error('notify: type is required');
    const entry = { id: randomUUID(), type, at, ...bodyFor(this.#roster, participant, payload) };
    if (!this.#boxes.has(participant)) this.#boxes.set(participant, []);
    this.#boxes.get(participant).push(entry);
    return entry.id;
  }

  /** A participant reads their inbox (pseudonymously). Sealed entries stay sealed — only the
   *  participant's enc private key opens them (openNotification). */
  inbox(participant) { return [...(this.#boxes.get(participant) || [])]; }

  /** Mark notifications seen so they aren't re-delivered. */
  ack(participant, ids) {
    const set = new Set(ids);
    this.#boxes.set(participant, (this.#boxes.get(participant) || []).filter((e) => !set.has(e.id)));
  }

  toJSON() { return Object.fromEntries(this.#boxes); }
  static fromJSON(obj, { roster } = {}) {
    const n = new InMemoryNotifier({ roster });
    for (const [p, arr] of Object.entries(obj || {})) n.#boxes.set(p, arr);
    return n;
  }
}

/** Participant side: open a sealed notification with their encryption private key. */
export function openNotification(entry, encPrivateKey) {
  if (entry?.sealed) {
    const { sealed, ...rest } = entry;
    return { ...rest, payload: JSON.parse(open(sealed, encPrivateKey)) };
  }
  return entry;
}

/**
 * Substrate-backed notifier: maps `notify()` onto @canopy/notify-envelope's `publish()` (full
 * payload, store-and-forward to the participant's pod). Inject the object returned by
 * `createNotifyEnvelope(...)` (or a compatible stub). Same sealing as the in-memory notifier.
 * @param {{ notifyEnvelope:{ publish:Function, subscribe?:Function }, roster?:object }} a
 */
export function createPodNotifier({ notifyEnvelope, roster } = {}) {
  if (typeof notifyEnvelope?.publish !== 'function') {
    throw new Error('createPodNotifier: a notifyEnvelope with publish() is required');
  }
  return {
    async notify(participant, { type, payload, ref } = {}) {
      if (!participant) throw new Error('notify: participant required');
      if (!type) throw new Error('notify: type is required');
      return notifyEnvelope.publish({
        type, ref: ref || `fp-notify/${participant}`,
        payload: bodyFor(roster, participant, payload), recipients: [participant],
      });
    },
    subscribe(opts) {
      if (typeof notifyEnvelope.subscribe !== 'function') throw new Error('this notifyEnvelope has no subscribe()');
      return notifyEnvelope.subscribe(opts);
    },
  };
}
