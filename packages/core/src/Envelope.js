/**
 * Envelope format and factory.
 *
 * Every message across every transport is wrapped in this structure.
 * _sig is null on construction — SecurityLayer fills it before send.
 * SecurityLayer.encrypt() / decryptAndVerify() work on these objects.
 */

// ── Pattern codes ─────────────────────────────────────────────────────────────

export const P = Object.freeze({
  HI: 'HI',   // Hello — signed plaintext (agent card exchange)
  OW: 'OW',   // OneWay — fire and forget
  AS: 'AS',   // AckSend — wants delivery confirmation
  AK: 'AK',   // Acknowledge — delivery confirmed (reply to AS)
  RQ: 'RQ',   // Request — wants a result
  RS: 'RS',   // Response — result reply (reply to RQ)
  PB: 'PB',   // Publish — pub-sub broadcast
  ST: 'ST',   // StreamChunk — one chunk of an open stream
  SE: 'SE',   // StreamEnd — final chunk / stream close
  BT: 'BT',   // BulkChunk — acknowledged bulk-transfer chunk
  IR: 'IR',   // InputRequired — task paused, handler needs more input
  RI: 'RI',   // ReplyInput — caller's reply to an IR
  CX: 'CX',   // Cancel — cancel an in-progress task
});

/** Pattern codes that resolve a pending outbound promise. */
export const REPLY_CODES = new Set([P.AK, P.RS]);

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new envelope.
 *
 * @param {string} p        - Pattern code (use P.*)
 * @param {string} from     - Sender address (pubKey or transport address)
 * @param {string} to       - Recipient address
 * @param {*}      payload  - Arbitrary payload (plain object for HI; encrypted otherwise)
 * @param {object} [opts]
 * @param {string} [opts.re]    - Reply-to envelope _id
 * @param {string} [opts.topic] - PubSub topic (PB only)
 */
export function mkEnvelope(p, from, to, payload, opts = {}) {
  return {
    _v:     1,
    _p:     p,
    _id:    uid(),
    _re:    opts.re    ?? null,
    _from:  from,
    _to:    to,
    _topic: opts.topic ?? null,
    _ts:    Date.now(),
    _sig:   null,         // filled by SecurityLayer before send
    payload,
  };
}

/**
 * Canonical JSON for signing — all fields except _sig, keys sorted.
 * Both sides must compute the same string for signature verification to work.
 */
export function canonicalize(envelope) {
  const { _sig, ...rest } = envelope;   // eslint-disable-line no-unused-vars
  return JSON.stringify(
    Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a < b ? -1 : 1))
  );
}

/** Type guard — minimal check that obj looks like an envelope. */
export function isEnvelope(obj) {
  return (
    typeof obj === 'object' && obj !== null &&
    obj._v === 1 &&
    typeof obj._p    === 'string' &&
    typeof obj._id   === 'string' &&
    typeof obj._from === 'string' &&
    typeof obj._to   === 'string'
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a unique ID.
 * Uses crypto.randomUUID when available (Node.js, HTTPS contexts).
 * Falls back to crypto.getRandomValues (available on HTTP too) formatted as UUID v4.
 * Last resort: Date + Math.random (no crypto at all).
 *
 * Exported so taskExchange and CapabilityToken can share the same fallback.
 */
export function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;  // version 4
    b[8] = (b[8] & 0x3f) | 0x80;  // variant 1
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function uid() { return genId(); }
