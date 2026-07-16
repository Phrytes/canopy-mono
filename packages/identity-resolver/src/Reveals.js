/**
 * Reveals — per-group + per-peer "show real name" state for the
 * Stoop-shape "handle by default, displayName on reveal" pattern.
 *
 * The reveal state is *the viewer's local choice* — i.e. it lives on
 * Anna's device and records "for these peers / these groups, I have
 * agreed to see displayName instead of handle".  In the symmetric
 * pattern (chat-agent reveal handshake), both sides flip their own
 * Reveals records when they agree to reveal; nothing on the network
 * forces it.
 *
 * Two scopes:
 *  - per-group:  show displayName for every member of a given group
 *                that opted in to group-wide reveal.
 *  - per-peer:   show displayName for one specific peer (overrides
 *                per-group default; usually set after a chat-agent
 *                handshake).
 *
 * Resolution precedence (see Resolver.resolve()): peer override wins
 * over group default, group default wins over "show handle".
 *
 * Pure in-memory.  Persisting to the pod is the app's concern (Stoop
 * writes to `/reveals/...` per the design in
 * `Project Files/Stoop/advice-2026-05-05.md` § "Handle / nickname
 * design").
 */

import { Emitter } from '@onderling/core';

export class Reveals extends Emitter {
  /** @type {Map<string, {showDisplayName: boolean}>} */
  #byGroup = new Map();
  /** @type {Map<string, {showDisplayName: boolean}>} */
  #byPeer = new Map();

  /**
   * @param {object} [opts]
   * @param {Array<{groupId: string, showDisplayName: boolean}>} [opts.groupReveals]
   * @param {Array<{peerWebid: string, showDisplayName: boolean}>} [opts.peerReveals]
   */
  constructor({ groupReveals, peerReveals } = {}) {
    super();
    if (Array.isArray(groupReveals)) {
      for (const r of groupReveals) {
        if (r?.groupId) this.#byGroup.set(r.groupId, { showDisplayName: !!r.showDisplayName });
      }
    }
    if (Array.isArray(peerReveals)) {
      for (const r of peerReveals) {
        if (r?.peerWebid) this.#byPeer.set(r.peerWebid, { showDisplayName: !!r.showDisplayName });
      }
    }
  }

  /**
   * Set or clear reveal-for-group.
   *
   * @param {string} groupId
   * @param {boolean} showDisplayName
   */
  setGroupReveal(groupId, showDisplayName) {
    if (typeof groupId !== 'string' || !groupId) {
      throw new TypeError('setGroupReveal: groupId required');
    }
    this.#byGroup.set(groupId, { showDisplayName: !!showDisplayName });
    this.emit('group-reveal-changed', { groupId, showDisplayName: !!showDisplayName });
  }

  /**
   * Set or clear reveal-for-peer.  Overrides per-group when present.
   *
   * @param {string} peerWebid
   * @param {boolean} showDisplayName
   */
  setPeerReveal(peerWebid, showDisplayName) {
    if (typeof peerWebid !== 'string' || !peerWebid) {
      throw new TypeError('setPeerReveal: peerWebid required');
    }
    this.#byPeer.set(peerWebid, { showDisplayName: !!showDisplayName });
    this.emit('peer-reveal-changed', { peerWebid, showDisplayName: !!showDisplayName });
  }

  /**
   * Remove a peer-reveal record (falls back to per-group default).
   *
   * @param {string} peerWebid
   */
  clearPeerReveal(peerWebid) {
    const had = this.#byPeer.delete(peerWebid);
    if (had) this.emit('peer-reveal-cleared', { peerWebid });
  }

  /**
   * Enumerate the current reveal state (UI / "what have I revealed
   * so far?" inventory).  Returns plain POJO snapshots; mutating the
   * returned arrays does not affect the store.
   *
   * @returns {{
   *   groups: Array<{groupId: string, showDisplayName: boolean}>,
   *   peers:  Array<{peerWebid: string, showDisplayName: boolean}>,
   * }}
   */
  list() {
    return {
      groups: [...this.#byGroup].map(([groupId, v]) => ({ groupId, showDisplayName: v.showDisplayName })),
      peers:  [...this.#byPeer].map(([peerWebid, v]) => ({ peerWebid, showDisplayName: v.showDisplayName })),
    };
  }

  /**
   * Read the reveal decision for a specific (peer, group).  Peer
   * override wins; group default fills in; absent = false.
   *
   * @param {object} args
   * @param {string} args.peerWebid
   * @param {string} [args.groupId]
   * @returns {{showDisplayName: boolean, source: 'peer' | 'group' | 'default'}}
   */
  decide({ peerWebid, groupId } = {}) {
    if (peerWebid && this.#byPeer.has(peerWebid)) {
      return { showDisplayName: this.#byPeer.get(peerWebid).showDisplayName, source: 'peer' };
    }
    if (groupId && this.#byGroup.has(groupId)) {
      return { showDisplayName: this.#byGroup.get(groupId).showDisplayName, source: 'group' };
    }
    return { showDisplayName: false, source: 'default' };
  }
}
