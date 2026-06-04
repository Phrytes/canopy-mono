// The Channel Adapter interface — "build once, two adapters" (architecture §1.3).
// canopy-chat and the TG bot are two SURFACES over the same channel-agnostic flow
// (src/channel/dispatcher.js). An adapter abstracts the only two things that differ:
//
//   1. WHERE the floor runs (the trust difference). `floor()` runs floorMessage where
//      this channel processes a message: on the participant's DEVICE for canopy-chat
//      (pre-send — nothing raw leaves) or in the BOT SERVICE for TG (post-receipt —
//      Telegram + our bot have already seen the raw text). `floorsTrust` is the honest
//      label for that.
//   2. HOW to talk to the participant — `send()`.
//
// Everything else — the Task-1 flow, the menu actions, the central-pod write — is
// identical across channels and lives in the dispatcher.

import { floorMessage } from '../floors/index.js';

/** @typedef {'my-contributions'|'withdraw'|'download'|'claim'|'pause'|'delete'} MenuAction */
export const MENU_ACTIONS = ['my-contributions', 'withdraw', 'download', 'claim', 'pause', 'delete'];

/**
 * @typedef {object} ChannelAdapter
 * @property {'pre-send'|'post-receipt'} floorsTrust       honesty label: canopy-chat | tg
 * @property {(raw:string, opts?:object) => object|Promise<object>} floor   run the floor pass where this channel runs it
 * @property {(msg:object) => Promise<void>} send          deliver a message to the participant
 */

/** Assert an object satisfies the adapter contract — fail fast at wiring time. */
export function assertAdapter(a) {
  for (const k of ['floorsTrust', 'floor', 'send']) {
    if (a == null || a[k] === undefined) throw new Error(`channel adapter missing "${k}"`);
  }
  if (!['pre-send', 'post-receipt'].includes(a.floorsTrust)) throw new Error(`bad floorsTrust: ${a.floorsTrust}`);
  return a;
}

/** A reference in-memory adapter: floor runs server-side (post-receipt, like TG) and
 *  outbound messages are recorded for inspection. A canopy-chat adapter would supply a
 *  device-side `floor()` (pre-send) instead — the contract is identical. */
export class MemoryChannelAdapter {
  floorsTrust = 'post-receipt';
  sent = [];
  floor(raw, opts = {}) { return floorMessage(raw, opts); }
  async send(msg) { this.sent.push(msg); }
}
