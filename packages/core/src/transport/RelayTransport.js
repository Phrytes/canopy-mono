/**
 * RelayTransport — WebSocket relay server transport.
 *
 * The relay server is a simple message broker: agents register by address,
 * and the relay forwards envelopes to the correct connected client.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>' }
 *   Relay  → Client: { type: 'registered' }
 *   Client → Relay: { type: 'send', to: '<address>', envelope: { ... } }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Relay  → Client: { type: 'error', message: '<reason>' }
 *
 * Reconnect: automatically reconnects with exponential backoff on close/error.
 * Uses `ws` in Node.js; falls back to globalThis.WebSocket in browsers.
 */
import { Transport } from './Transport.js';

const MAX_BACKOFF_MS = 30_000;

export class RelayTransport extends Transport {
  #ws        = null;
  #relayUrl;
  #backoffMs = 1_000;
  #stopped   = false;
  #connectPromise = Promise.resolve();  // starts resolved; reset on close
  #connectResolve = null;               // resolve fn for the current connect promise
  #knownPeers = new Set();              // addresses already emitted as peer-discovered

  /**
   * @param {object} opts
   * @param {string}  opts.relayUrl  — ws:// or wss:// relay URL
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor(opts) {
    if (!opts?.relayUrl)  throw new Error('RelayTransport requires relayUrl');
    if (!opts?.identity)  throw new Error('RelayTransport requires identity');
    super({ address: opts.identity.pubKey, identity: opts.identity });
    this.#relayUrl = opts.relayUrl;
  }

  /** True when the WebSocket is open and registered with the relay. */
  get connected() { return this.#ws?.readyState === 1; }

  async connect() {
    this.#stopped = false;
    this.#resetConnectPromise();
    // Connect in the background — do NOT await. agent.start() must not block
    // on relay because #openSocket() only resolves when the server sends
    // 'registered', which never happens when the relay is unreachable.
    // _put() already awaits #connectPromise internally, so sends queue safely.
    this.#openSocket().catch(() => {});
  }

  async disconnect() {
    this.#stopped = true;
    this.#knownPeers.clear();
    this.#ws?.close();
    this.#ws = null;
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    // Wait until registered, but fail fast if the relay is unreachable.
    await Promise.race([
      this.#connectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Relay: not connected')), 5_000)
      ),
    ]);
    this.#ws.send(JSON.stringify({ type: 'send', to, envelope }));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Emit peer-discovered once per address (skip self and duplicates). */
  #discoverPeer(addr) {
    if (!addr || addr === this.address) return;
    if (this.#knownPeers.has(addr)) return;
    this.#knownPeers.add(addr);
    this.emit('peer-discovered', addr);
  }

  /**
   * Drop this peer from our dedup cache and ask the relay for a fresh peer
   * list.  If the peer is still registered, they'll be re-emitted as
   * peer-discovered and the app can hello them again.
   */
  forgetPeer(address) {
    this.#knownPeers.delete(address);
    if (this.#ws?.readyState === 1) {
      try { this.#ws.send(JSON.stringify({ type: 'peer-list' })); } catch {}
    }
  }

  /** Reset #connectPromise to a pending promise immediately (before the reconnect timer). */
  #resetConnectPromise() {
    this.#connectPromise = new Promise(resolve => { this.#connectResolve = resolve; });
  }

  async #openSocket() {
    let WS;
    if (typeof WebSocket !== 'undefined') {
      WS = WebSocket;
    } else {
      try {
        const mod = await import('ws');
        WS = mod.default ?? mod;
      } catch {
        throw new Error('ws package not found. Run: npm install ws');
      }
    }

    // If there's no pending connect promise, create one now.
    if (!this.#connectResolve) this.#resetConnectPromise();

    const ws = new WS(this.#relayUrl);
    this.#ws = ws;

    ws.onopen = () => {
      this.#backoffMs = 1_000;
      ws.send(JSON.stringify({ type: 'register', address: this.address }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'registered') {
        this.emit('connect', { address: this.address });
        const res = this.#connectResolve;
        this.#connectResolve = null;
        res?.();
        return;
      }
      // peer-joined: individual join event (forward-compat, not sent by current relay)
      if (msg.type === 'peer-joined' && msg.address) {
        this.#discoverPeer(msg.address);
        return;
      }
      // peer-list: full broadcast sent by relay on every connect/disconnect
      if (msg.type === 'peer-list' && Array.isArray(msg.peers)) {
        for (const addr of msg.peers) this.#discoverPeer(addr);
        return;
      }
      if (msg.type === 'message' && msg.envelope) {
        this._receive(msg.envelope);
        return;
      }
      if (msg.type === 'error') {
        this.emit('error', new Error(`Relay: ${msg.message}`));
      }
    };

    ws.onerror = (err) => {
      const e = err?.error ?? err;
      this.emit('error', e instanceof Error ? e : new Error('WebSocket error'));
    };

    ws.onclose = () => {
      if (this.#stopped) return;
      // Immediately reset the connect promise so any concurrent _put calls will
      // wait for the new connection rather than using the stale resolved promise.
      this.#resetConnectPromise();
      this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
      setTimeout(() => {
        if (!this.#stopped) this.#openSocket().catch(() => {});
      }, this.#backoffMs);
    };

    return this.#connectPromise;
  }
}
