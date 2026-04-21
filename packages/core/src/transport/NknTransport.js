/**
 * NknTransport — NKN network transport.
 *
 * Wraps `nkn-sdk` (nkn.Client). The NKN address is derived from the agent's
 * Ed25519 seed, giving a deterministic address from the identity keypair.
 *
 * Browser: load nkn-sdk from CDN and pass it as `nknLib`.
 * Node.js: npm install nkn-sdk; it will be auto-imported if not passed.
 *
 * Robustness (carried over from working demo.html implementation):
 *   - RTCDataChannel transient send errors → poll-retry up to 12 s
 *   - Soft warn at 20 s if still connecting
 *   - Hard timeout at 90 s → seedless retry (different node pool)
 */
import { Transport } from './Transport.js';
import { encode as b64encode } from '../crypto/b64.js';

export class NknTransport extends Transport {
  #client    = null;
  #nknLib    = null;
  #opts;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {string}  [opts.identifier]   — NKN address identifier prefix
   * @param {object}  [opts.nknLib]       — inject nkn-sdk (auto-loaded if omitted)
   * @param {number}  [opts.warnAfter=20000]
   * @param {number}  [opts.connectTimeout=90000]
   */
  constructor(opts = {}) {
    if (!opts?.identity) throw new Error('NknTransport requires identity');
    super({ identity: opts.identity });
    this.#opts = {
      warnAfter:      20_000,
      connectTimeout: 90_000,
      ...opts,
    };
  }

  async connect() {
    // Lazy-load nkn-sdk if not injected (Node.js path).
    this.#nknLib = this.#opts.nknLib
      ?? (typeof nkn !== 'undefined' ? nkn : null);   // browser global  // eslint-disable-line no-undef

    if (!this.#nknLib) {
      try {
        // Dynamic import for Node.js environments.
        const mod     = await import('nkn-sdk');
        this.#nknLib  = mod.default ?? mod;
      } catch {
        throw new Error(
          'nkn-sdk not found. Run: npm install nkn-sdk   or pass opts.nknLib.',
        );
      }
    }

    const seed = this._deriveSeed();
    await this.#tryConnect(seed, false);
  }

  async disconnect() {
    try { this.#client?.close(); } catch { /**/ }
    this.#client = null;
    this._setAddress(null);
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    if (!this.#client) throw new Error('NknTransport: not connected');
    const payload = JSON.stringify(envelope);

    // NKN SDK opens an RTCDataChannel lazily — poll until it accepts the send.
    const POLL_MS    = 200;
    const TIMEOUT_MS = 12_000;
    const deadline   = Date.now() + TIMEOUT_MS;

    while (true) {
      try {
        await this.#client.send(to, payload, { noReply: true });
        return;
      } catch (err) {
        const msg        = String(err?.message ?? '').toLowerCase();
        const isTransient =
          msg.includes('rtcdatachannel')  ||
          msg.includes('readystate')      ||
          msg.includes('no longer')       ||
          (typeof DOMException !== 'undefined' &&
           err instanceof DOMException && err.name === 'InvalidStateError');
        if (!isTransient) throw err;
        if (Date.now() >= deadline) {
          throw new Error('NKN send timed out — channel may be reconnecting');
        }
        await new Promise(r => setTimeout(r, POLL_MS));
      }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Derive a 64-hex-char NKN seed from the agent's Ed25519 pubKey bytes.
   * Using the pubKey (not the private key) as the NKN seed is intentional —
   * the NKN seed is only for address derivation, not for the agent's identity.
   */
  _deriveSeed() {
    if (!this.identity) return null;
    const bytes = this.identity.pubKeyBytes;
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async #tryConnect(seed, isRetry) {
    return new Promise((resolve, reject) => {
      const clientOpts = seed ? { seed } : {};
      if (this.#opts.identifier) {
        clientOpts.identifier = this.#opts.identifier;
      }
      this.#client = new this.#nknLib.Client(clientOpts);

      const warnTimer = setTimeout(() => {
        if (this.address) return;
        this.emit('warn', 'NKN still connecting — this can take up to 90 s on some nodes…');
      }, this.#opts.warnAfter);

      const hardTimer = setTimeout(() => {
        if (this.address) return;
        clearTimeout(warnTimer);
        if (!isRetry && seed) {
          this.emit('warn', 'NKN timed out with seed — retrying without seed…');
          try { this.#client?.close(); } catch { /**/ }
          this.#client = null;
          this.#tryConnect(null, true).then(resolve, reject);
        } else {
          try { this.#client?.close(); } catch { /**/ }
          this.#client = null;
          reject(new Error('NKN connect timed out'));
        }
      }, this.#opts.connectTimeout);

      this.#client.on('connect', () => {
        clearTimeout(warnTimer);
        clearTimeout(hardTimer);
        this._setAddress(this.#client.addr);
        this.emit('connect', { address: this.address });
        resolve();
      });

      this.#client.on('message', (msg) => {
        let envelope;
        try { envelope = JSON.parse(msg.payload.toString()); } catch { return; }
        this._receive(envelope);
      });

      this.#client.on('error', (err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
