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
      warnAfter:      20_000,   // emit 'warn' if still connecting after this
      connectTimeout: 90_000,   // hard limit per attempt (seedless retry gets same)
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

    // The NKN SDK opens an RTCDataChannel lazily on first send to a peer.
    // That channel goes connecting → open asynchronously, and the SDK throws
    // if we send before it's ready. We can't access readyState directly, so
    // we poll: keep attempting until the send succeeds (= channel is open)
    // or we hit the deadline.
    const POLL_MS    = 200;
    const TIMEOUT_MS = 12_000;
    const deadline   = Date.now() + TIMEOUT_MS;

    while (true) {
      try {
        await this.#client.send(to, payload, { noReply: true });
        return;
      } catch (e) {
        const msg = String(e?.message ?? '').toLowerCase();
        const isTransient =
          msg.includes('rtcdatachannel') ||
          msg.includes('readystate')     ||
          msg.includes('no longer, usable') ||   // DOMException InvalidStateError
          (e instanceof DOMException && e.name === 'InvalidStateError');
        if (!isTransient) throw e;
        if (Date.now() >= deadline) throw new Error('NKN send timed out — connection may be reconnecting');
        await new Promise(r => setTimeout(r, POLL_MS));
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  async #tryConnect(seed, isRetry) {
    return new Promise((resolve, reject) => {
      this.#client = new this.#lib.Client(seed ? { seed } : {});

      // Soft warn — let the user know it's taking a while
      const warnTimer = setTimeout(() => {
        if (this.#address) return;
        this.emit('warn', 'NKN still connecting — this can take up to 90 s on some nodes…');
      }, this.#opts.warnAfter);

      // Hard limit — give NKN plenty of time before giving up.
      // On a seeded connect, first try a seedless retry (different node pool);
      // on the seedless retry (or if no seed), just reject so the caller can
      // retry with a fresh client.
      const hardTimer = setTimeout(() => {
        if (this.#address) return;
        clearTimeout(warnTimer);
        if (!isRetry && seed) {
          this.emit('warn', 'NKN timed out with seed — retrying without seed…');
          try { this.#client.close(); } catch (_) {}
          this.#client = null;
          this.#tryConnect(null, true).then(resolve, reject);
        } else {
          try { this.#client.close(); } catch (_) {}
          this.#client = null;
          reject(new Error('NKN connect timed out — will retry'));
        }
      }, this.#opts.connectTimeout);

      this.#client.on('connect', () => {
        clearTimeout(warnTimer);
        clearTimeout(hardTimer);
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
        // Non-fatal — NKN SDK handles reconnection internally
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  #validSeed(raw) {
    if (!raw || typeof raw !== 'string') return null;
    return /^[0-9a-f]{64}$/i.test(raw) ? raw : null;
  }
}
