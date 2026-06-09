// Attestation VERIFICATION — the caller-side gate the TEE boundary calls for ("the caller
// verifies that quote BEFORE trusting", tee/aggregate.js). It closes the gap in placement.js,
// where `FP_RUNNER_ROLE=enclave` is SELF-DECLARED: a host could claim 'enclave' and lie. When a
// project requires enclave placement (Phase 2), the runner's enclave claim must be PROVEN by a
// verified attestation quote, optionally pinned to the expected code measurement.
//
// An attestation quote is the `{kind, runner, verified, measurement?}` object an enclave's
// `attest()` produces (see localAttestation in tee/aggregate.js). In dev that's a stub
// (verified only when FP_RUNNER_ROLE=enclave); in PRODUCTION a real AMD SEV-SNP / NVIDIA H100 /
// Edgeless Contrast verifier parses the hardware report into the SAME shape. Swapping that
// verifier is the one hardware-gated change; this gate stays. Shared by M8 (enclave aggregation)
// and M7 (the confidential LLM gateway) — both verify a quote before trusting/sending.

/**
 * Verify an attestation quote: it must be genuinely verified, and — when an expected code
 * measurement is pinned — match it. Pure + synchronous; the (async, network) quote FETCH is the
 * caller's job (and the hardware-gated part for a real enclave).
 *
 * @param {{verified?:boolean, kind?:string, runner?:string, measurement?:string}|null} quote
 * @param {{expectedMeasurement?:string, requireVerified?:boolean}} [policy]
 * @returns {{ok:boolean, reason?:string}}
 */
export function verifyAttestation(quote, { expectedMeasurement, requireVerified = true } = {}) {
  if (!quote || typeof quote !== 'object') return { ok: false, reason: 'no attestation quote' };
  if (requireVerified && quote.verified !== true) {
    return { ok: false, reason: `attestation not verified (kind="${quote.kind}", runner="${quote.runner}")` };
  }
  if (expectedMeasurement != null && quote.measurement !== expectedMeasurement) {
    return { ok: false, reason: `measurement mismatch (expected "${expectedMeasurement}", got "${quote.measurement ?? 'none'}")` };
  }
  return { ok: true };
}

/**
 * M8 gate: when a project requires 'enclave' placement, the aggregation's attestation MUST
 * verify — a real TEE quote, not a self-declared runner role. For 'host'/'controller' there is
 * no enclave to attest, so this is a no-op (returns `{skipped:true}`). Pairs with
 * placement.js#assertAggregationAllowed (which checks the runner role). Throws on a failed gate.
 *
 * @param {object|null} attestation  the quote returned by runSealedAggregation / attest()
 * @param {object} config            ProjectConfig (reads aggregation.location + aggregation.attestation)
 */
export function assertEnclaveAttested(attestation, config) {
  const required = config?.aggregation?.location || 'host';
  if (required !== 'enclave') return { ok: true, skipped: true };
  const expectedMeasurement = config?.aggregation?.attestation?.expectedMeasurement;
  const v = verifyAttestation(attestation, { expectedMeasurement, requireVerified: true });
  if (!v.ok) throw new Error(`enclave aggregation requires a verified attestation: ${v.reason}`);
  return { ok: true };
}

/**
 * M7 gate: verify a confidential LLM gateway's attestation before routing RAW pre-consent text
 * to it. The gateway returns a quote (same shape); the client pins the expected measurement from
 * `llm.attestation`. The quote-fetch handshake (RA-TLS to the gateway enclave) is the
 * hardware-gated part; this is the verification it feeds.
 *
 * @param {object|null} quote
 * @param {{expectedMeasurement?:string}} [attestationConfig]  llm.attestation
 */
export function verifyGatewayAttestation(quote, attestationConfig = {}) {
  return verifyAttestation(quote, { expectedMeasurement: attestationConfig?.expectedMeasurement, requireVerified: true });
}
