/**
 * MessageStore — in-memory message log per peer.
 *
 * Simple EventEmitter store; no persistence (messages are ephemeral per session).
 * Screens subscribe via store.on('message', handler) and unsubscribe on unmount.
 */
import { Emitter } from '@canopy/core';

export class MessageStore extends Emitter {
  #log = new Map(); // peerPubKey → Message[]

  /**
   * @param {string} peerPubKey
   * @param {{ direction: 'in'|'out', text: string, hops?: number, via?: string|null }} msg
   */
  add(peerPubKey, msg) {
    const entry = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ts:        Date.now(),
      direction: msg.direction,
      text:      msg.text,
      hops:      msg.hops ?? 0,
      via:       msg.via  ?? null,
      status:    msg.status ?? 'ok',
    };
    const list = this.#log.get(peerPubKey) ?? [];
    list.push(entry);
    this.#log.set(peerPubKey, list);
    this.emit('message', { peerPubKey, message: entry });
    return entry;
  }

  /** @returns {Message[]} */
  get(peerPubKey) {
    return this.#log.get(peerPubKey) ?? [];
  }

  clear(peerPubKey) {
    this.#log.delete(peerPubKey);
    this.emit('cleared', { peerPubKey });
  }
}

export const messageStore = new MessageStore();
