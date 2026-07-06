// Test doubles for the injected contracts — a mock enclave that mints attestation reports,
// stub verifyChain implementations (good / bad / throwing), and a spy LLM client so we can
// assert the refuse-on-failure property: on failed attestation the llm is NEVER called.
//
// No real TEE, no real AMD certs, no RA-TLS handshake — those are the deferred deploy side.

export const GOOD_MEASUREMENT = 'sha384:enclave-image-v1-abcdef';
export const WRONG_MEASUREMENT = 'sha384:some-other-image-999999';
export const TLS_PUBKEY = 'tls-pubkey:MFkwEwYHKoZIzj0CAQ';
export const OTHER_PUBKEY = 'tls-pubkey:ATTACKER-MFkwEwYHKoZ';
export const ROOTS = ['amd-root-ca'];

/**
 * Mint a well-formed attestation report. Override any field to model an attack /
 * degenerate case (wrong measurement, stale timestamp, unbound reportData, ...).
 */
export function makeReport(overrides = {}) {
  return {
    measurement: GOOD_MEASUREMENT,
    reportData:  TLS_PUBKEY,        // binds to the TLS channel pubkey (RA-TLS)
    signature:   'sig:valid-abc',
    chain:       ['amd-ask', 'amd-vcek'],
    nonce:       undefined,
    timestamp:   Date.now(),
    ...overrides,
  };
}

/** verifyChain that accepts any report whose signature chains to `ROOTS` (our happy path). */
export function chainOk(report, roots) {
  return Array.isArray(roots) && roots.includes('amd-root-ca')
    && typeof report.signature === 'string' && report.signature.startsWith('sig:valid');
}

/** verifyChain that rejects — models a signature that does NOT chain to a trusted root. */
export function chainBad() {
  return false;
}

/** verifyChain that throws — models a broken/hostile verifier. Must still deny, never open. */
export function chainThrows() {
  throw new Error('chain verifier exploded');
}

/**
 * A spy LLM client (@canopy/llm-client LlmClient duck type) that records every invoke.
 * `calls` MUST stay empty on any refused attestation — that is the headline assertion.
 */
export function makeSpyLlm(result = { replyText: 'ok', toolCall: null, raw: {} }) {
  const calls = [];
  return {
    calls,
    async invoke(req, ctx) {
      calls.push({ req, ctx });
      return result;
    },
  };
}
