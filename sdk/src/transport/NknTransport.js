import { Transport, PATTERNS } from './Transport.js';

/**
 * NKN transport — browser-first.
 *
 * Expects the `nkn` global (loaded from CDN).
 * In Node.js / tests, pass the library via options: `{ nknLib: require('nkn-sdk') }`.
 *
 * Design notes (from working demo.html implementation):
 * - Use nkn.Client (not MultiClient) for browser compat
 * - Pass { noReply: true } on every send — our protocol uses separate envelopes
 * - RTCDataChannel error → retry once after 2 s (WebRTC async setup race)
 * - 20 s connect timeout → clear seed → retry without seed (self-healing)
 * - Expose .seed so the developer can persist it for a stable address
 */
export class NknTransport extends Transport {
  #client  = null;
  #address = null;
  #seed    = null;
  #lib     = null;
  #opts;

  constructor(options = {}) {
    super();
    this.#opts = {
      connectTimeout: 60_000,
      ...options,
    };
  }

  get address() { return this.#address; }

  /** The NKN seed for this client — persist this to restore a stable address. */
  get seed() { return this.#seed; }

  canDo(pattern) {
    return [
      PATTERNS.ONE_WAY,
      PATTERNS.ACK_SEND,
      PATTERNS.REQUEST_RESPONSE,
      PATTERNS.STREAMING,
      PATTERNS.BULK_TRANSFER,
    ].includes(pattern);
  }

  async connect() {
    this.#lib = this.#opts.nknLib
      ?? (typeof nkn !== 'undefined' ? nkn : null);     // eslint-disable-line no-undef
    if (!this.#lib) {
      throw new Error(
        'NKN library not found. Load nkn-sdk from CDN or pass options.nknLib.'
      );
    }
    const seed = this.#validSeed(this.#opts.seed);
    await this.#tryConnect(seed, false);
  }

  async disconnect() {
    try { this.#client?.close(); } catch (_) {}
    this.#client  = null;
    this.#address = null;
    this.emit('disconnect');
  }

  async _rawSend(to, envelope) {
    if (!this.#client) throw new Error('NknTransport: not connected');
    const payload = JSON.stringify(envelope);
    try {
      await this.#client.send(to, payload, { noReply: true });
    } catch (e) {
      if (String(e?.message).toLowerCase().includes('rtcdatachannel')) {
        // WebRTC data channel not ready yet — retry once after 2 s
        await new Promise(r => setTimeout(r, 2000));
        await this.#client.send(to, payload, { noReply: true });
      } else {
        throw e;
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  async #tryConnect(seed, isRetry) {
    return new Promise((resolve, reject) => {
      this.#client = new this.#lib.Client(seed ? { seed } : {});

      // Self-healing timeout: if no connect event within the window,
      // drop the (possibly stuck) seed and start fresh.
      // On the retry (isRetry=true) we still apply a timeout so the promise
      // never hangs indefinitely.
      const timer = setTimeout(() => {
        if (this.#address) return;   // already connected — timer fired late
        if (isRetry) {
          reject(new Error('NKN connect timed out (seedless retry)'));
          return;
        }
        this.emit('warn', 'NKN connect timed out — retrying without seed');
        try { this.#client.close(); } catch (_) {}
        this.#client = null;
        this.#tryConnect(null, true).then(resolve, reject);
      }, this.#opts.connectTimeout);

      this.#client.on('connect', () => {
        clearTimeout(timer);
        this.#address = this.#client.addr;
        this.#seed    = this.#client.key?.seed ?? null;
        this.emit('connect', { address: this.#address });
        resolve();
      });

      this.#client.on('message', (msg) => {
        let envelope;
        try { envelope = JSON.parse(msg.payload.toString()); } catch { return; }
        this._receive(msg.src, envelope);
      });

      this.#client.on('error', (err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        // Don't reject here — errors after connect are non-fatal
      });
    });
  }

  #validSeed(raw) {
    if (!raw || typeof raw !== 'string') return null;
    return /^[0-9a-f]{64}$/i.test(raw) ? raw : null;
  }
}
