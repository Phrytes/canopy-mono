/**
 * ActivityStore — in-memory log of skill invocations this agent handles.
 *
 * Pushed to by the app-registered skills (stream-demo, ask-name, …) so the
 * PeersScreen can show a small "what's happening right now" panel.  Keeps
 * only the last ~10 entries; no persistence.
 *
 * Each entry:
 *   { id, ts, kind, label, caller, detail }
 *     id     — unique string for React keys
 *     ts     — ms
 *     kind   — 'stream-chunk' | 'ir-prompt' | 'ir-reply' | 'skill-call' | 'stream-end'
 *     label  — short tag shown in the UI (e.g. 'stream-demo', 'ask-name')
 *     caller — short pubkey of whoever is calling (or proxying) us
 *     detail — optional one-liner shown inline
 */
import { Emitter } from '@canopy/core';

const MAX_ENTRIES = 10;

export class ActivityStore extends Emitter {
  #entries = [];

  add({ kind, label, caller, detail }) {
    const entry = {
      id:     `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ts:     Date.now(),
      kind,
      label,
      caller: caller ?? null,
      detail: detail ?? null,
    };
    this.#entries.push(entry);
    while (this.#entries.length > MAX_ENTRIES) this.#entries.shift();
    this.emit('change', [...this.#entries]);
    return entry;
  }

  all() { return [...this.#entries]; }

  clear() {
    this.#entries.length = 0;
    this.emit('change', []);
  }
}

export const activityStore = new ActivityStore();
