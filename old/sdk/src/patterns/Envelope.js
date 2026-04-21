function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Pattern codes — short identifiers embedded in every envelope _p field.
 *
 *  OW  One-Way send            (no reply expected)
 *  AS  Ack-Send                (peer sends AK on receipt)
 *  AK  Acknowledgement         (reply to AS)
 *  RQ  Request                 (peer sends RS with result)
 *  RS  Response                (reply to RQ)
 *  PB  Pub-Sub publish
 *  ST  Stream chunk
 *  SE  Stream end marker
 *  BT  Bulk Transfer chunk
 *  SS  Session message
 */
export const P = Object.freeze({
  OW: 'OW', AS: 'AS', AK: 'AK',
  RQ: 'RQ', RS: 'RS',
  PB: 'PB',
  ST: 'ST', SE: 'SE',
  BT: 'BT',
  SS: 'SS',
});

/**
 * Create a protocol envelope.
 *
 * @param {string} pattern  — one of P.*
 * @param {*}      payload  — application payload
 * @param {object} extras   — additional envelope fields (e.g. _re, _topic)
 */
export function mkEnvelope(pattern, payload, extras = {}) {
  return { _v: 1, _p: pattern, _id: uid(), payload, ...extras };
}

/** True if the value looks like our protocol envelope. */
export function isEnvelope(v) {
  return v !== null && typeof v === 'object' && v._v === 1 && typeof v._p === 'string';
}
