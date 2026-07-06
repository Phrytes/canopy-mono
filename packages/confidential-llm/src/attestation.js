// attestation.js — the client-side enclave attestation verifier (invariant #7:
// "trust by attestation, not by host"). Before a phone sends a confidential prompt
// to a remote enclave gateway it must prove, from a signed report, that:
//   (a) the enclave runs THE CODE WE EXPECT     — measurement === expectedMeasurement
//   (b) the report is FRESH (not a replay)       — nonce / timestamp anti-replay
//   (c) the report is SIGNED BY A TRUSTED ROOT   — signature chains to an AMD root
//   (d) the TLS peer IS that enclave             — reportData commits to the TLS pubkey
//                                                  (RA-TLS binding, see verifyChannelBinding)
//
// We model the SEV-SNP-style report STRUCTURALLY (no real hardware here — that is the
// deferred Fb M7/M8 deploy side). The signature-chain check is INJECTED (`verifyChain`)
// so the whole verifier is testable without real AMD certificates and carries no heavy
// native crypto into the browser bundle (web-first v0).
//
//   AttestationReport = {
//     measurement: string,   // hash of the enclave image ("what code it runs")
//     reportData:  string,   // commits to the TLS channel pubkey (RA-TLS binding)
//     signature:   string,   // signs the report body; chains to an AMD root
//     chain:       any,      // cert chain to a trusted root (opaque to us; verifyChain reads it)
//     nonce?:      string,   // client-supplied anti-replay challenge, echoed back
//     timestamp?:  number,   // ms epoch the quote was produced (freshness)
//   }
//
// DENY-BY-DEFAULT is the whole point. Anything missing / mismatched / stale / unsigned
// → `{ rejected: true, reason }`. No exception leaks out (a thrown verifyChain, a
// malformed report — all become a rejection, never a crash the caller could ignore).
//
//   verifyAttestation(report, { expectedMeasurement, roots, verifyChain, now?, maxAgeMs?, expectedNonce? })
//       -> { ok: true, measurement } | { rejected: true, reason, message? }
//
//   verifyChannelBinding(report, tlsPublicKey) -> boolean

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 min — a quote older than this is stale.

/**
 * @typedef {object} AttestationReport
 * @property {string} measurement
 * @property {string} reportData
 * @property {string} signature
 * @property {*} [chain]
 * @property {string} [nonce]
 * @property {number} [timestamp]
 */

/**
 * @typedef {object} VerifyOptions
 * @property {string} expectedMeasurement   the enclave image hash we require (pinned).
 * @property {*} [roots]                     trusted root(s) — passed straight to verifyChain.
 * @property {(report: AttestationReport, roots: *) => boolean|Promise<boolean>} [verifyChain]
 *   INJECTED signature-chain check. Returns true iff `signature` chains to `roots`.
 *   Omitted ⇒ deny (we never assume an unchecked signature is good).
 * @property {number} [now]                  ms epoch, injectable for deterministic freshness tests.
 * @property {number} [maxAgeMs]             freshness window (default 5 min).
 * @property {string} [expectedNonce]        if set, report.nonce must match it exactly (anti-replay).
 */

/**
 * Verify an enclave attestation report. Deny-by-default: only a report that passes
 * EVERY check returns `{ ok: true }`; every other path returns `{ rejected: true, reason }`.
 *
 * @param {AttestationReport} report
 * @param {VerifyOptions} opts
 * @returns {Promise<{ok:true, measurement:string} | {rejected:true, reason:string, message?:string}>}
 */
export async function verifyAttestation(report, opts = {}) {
  const {
    expectedMeasurement,
    roots,
    verifyChain,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    expectedNonce,
  } = opts;

  try {
    // 0. structural sanity — a report we can't read is not a report we trust.
    if (!report || typeof report !== 'object') return reject('malformed-report');
    if (typeof report.measurement !== 'string' || report.measurement.length === 0) {
      return reject('malformed-report');
    }
    if (typeof report.signature !== 'string' || report.signature.length === 0) {
      return reject('malformed-report');
    }

    // 1. measurement — the enclave must run EXACTLY the code we pinned.
    if (typeof expectedMeasurement !== 'string' || expectedMeasurement.length === 0) {
      return reject('no-expected-measurement');
    }
    if (!constantTimeEqual(report.measurement, expectedMeasurement)) {
      return reject('measurement-mismatch');
    }

    // 2. freshness / anti-replay — a stale or replayed quote proves nothing about NOW.
    if (expectedNonce != null) {
      if (typeof report.nonce !== 'string' || !constantTimeEqual(report.nonce, expectedNonce)) {
        return reject('nonce-mismatch');
      }
    }
    if (typeof report.timestamp === 'number') {
      const age = now - report.timestamp;
      if (age > maxAgeMs) return reject('stale');
      // A quote timestamped in the future (beyond a small skew) is not trustworthy either.
      if (age < -maxAgeMs) return reject('stale');
    } else if (expectedNonce == null) {
      // No nonce AND no timestamp ⇒ nothing binds this quote to NOW ⇒ replayable ⇒ deny.
      return reject('no-freshness');
    }

    // 3. signature chain — must chain to a trusted root. INJECTED so tests need no AMD certs.
    if (typeof verifyChain !== 'function') return reject('no-verify-chain');
    let chained;
    try {
      chained = await verifyChain(report, roots);
    } catch (err) {
      // A verifier that throws is a FAILED verification, never an open gate.
      return reject('bad-signature', err);
    }
    if (chained !== true) return reject('bad-signature');

    return { ok: true, measurement: report.measurement };
  } catch (err) {
    // Any unforeseen failure denies. We never leak an exception past the gate.
    return reject('error', err);
  }
}

/**
 * RA-TLS channel binding: the report's `reportData` commits to the TLS channel's
 * public key, so the enclave we just attested IS the peer we're talking TLS to
 * (defeats MITM / relay — an attacker can't front a real enclave's quote over
 * their own TLS connection). We model the commitment as equality between
 * `reportData` and the (normalised) TLS pubkey; in real SEV-SNP `reportData` is
 * the 64-byte user-data field carrying a hash of the pubkey (the RA-TLS handshake
 * that produces it is the deferred transport). Deny on any mismatch / missing input.
 *
 * @param {AttestationReport} report
 * @param {string|Uint8Array} tlsPublicKey  the pubkey the TLS channel actually presented.
 * @returns {boolean}
 */
export function verifyChannelBinding(report, tlsPublicKey) {
  try {
    if (!report || typeof report !== 'object') return false;
    const committed = report.reportData;
    if (committed == null || tlsPublicKey == null) return false;
    return constantTimeEqual(normalizeKey(committed), normalizeKey(tlsPublicKey));
  } catch {
    return false; // deny-by-default: any surprise → not bound.
  }
}

function reject(reason, err) {
  const out = { rejected: true, reason };
  if (err && err.message) out.message = err.message;
  return out;
}

/** Normalise a key/commitment (string or bytes) to a canonical string for comparison. */
function normalizeKey(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return Array.from(v).join(',');
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

/**
 * Length-independent, content-constant-time-ish string equality — avoids leaking
 * how many leading characters matched via early return. Not a hardware-grade
 * primitive, but keeps the model honest (no timing side-channel in the compare).
 */
function constantTimeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  let diff = sa.length ^ sb.length;
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}
