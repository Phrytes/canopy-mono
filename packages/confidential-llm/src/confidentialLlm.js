// confidentialLlm.js — the phone-side confidential-LLM gateway client (Objective F).
//
// This is the "Option B" real client-side quote check that @canopy/llm-client's
// routeSafety.js documents as unbuilt: instead of a config FLAG asserting the enclave
// was verified out-of-band, this VERIFIES the enclave attestation on the device before
// any prompt leaves it, then routes the LLM call through the attested channel host-blind.
//
//   createConfidentialLlm({ endpoint, attestation, verifyChain, llm, expectedMeasurement, ... })
//       -> { invoke(req, ctx?) -> Promise<LlmInvocationResult | Refusal>, attest(), reset() }
//
// THE FLOW (attest FIRST, then route):
//   1. On first invoke (or per policy) obtain the enclave's attestation report and
//      verifyAttestation(...) — measurement, freshness, signature chain (verifyChain INJECTED).
//   2. verifyChannelBinding(report, endpoint.tlsPublicKey) — the attested enclave IS the TLS peer.
//   3. ONLY if both pass: route `req` through the injected `llm` (an @canopy/llm-client
//      LlmClient / provider) to the attested endpoint, and return its result.
//
// REFUSE-ON-FAILURE / NO SILENT DOWNGRADE (the headline guarantee):
//   If attestation fails, `invoke` returns a coded Refusal and NEVER calls `llm` — no prompt
//   bytes leave the device, and there is NO fallback to a plain / unattested endpoint. This
//   mirrors the llmTool "no silent cloud fallback" rule and blob-gateway's deny-by-default.
//
// INJECTED contracts (all mock-testable; the real TEE/CVM quote producer + RA-TLS transport
// + AMD cert chain are the deferred Fb M7/M8 deploy side):
//   endpoint    = { baseUrl, model?, tlsPublicKey }  the attested endpoint + its TLS pubkey
//   attestation = AttestationReport | () => AttestationReport|Promise<...>   the enclave's quote
//   verifyChain = (report, roots) => bool             signature-chain check (no real AMD certs in v0)
//   llm         = { invoke(req, ctx?) => Promise<result> }   an @canopy/llm-client LlmClient
//   expectedMeasurement = string                      the enclave image hash we pin

import { verifyAttestation, verifyChannelBinding } from './attestation.js';

/**
 * @typedef {object} Refusal
 * @property {true} refused
 * @property {string} code    stable machine code (e.g. 'attestation-failed', 'channel-unbound').
 * @property {string} reason  the underlying verifier reason (measurement-mismatch / stale / ...).
 * @property {string} [endpoint]
 */

/**
 * @param {object} args
 * @param {{baseUrl?:string, model?:string, name?:string, tlsPublicKey:string|Uint8Array}} args.endpoint
 * @param {import('./attestation.js').AttestationReport | (() => any)} args.attestation
 *   The enclave's attestation report, or a (possibly async) producer of it. A producer lets
 *   the caller fetch a FRESH quote (e.g. bound to a per-session nonce) at attest time.
 * @param {(report:any, roots:*) => boolean|Promise<boolean>} args.verifyChain  INJECTED chain check.
 * @param {{invoke:(req:any, ctx?:any) => Promise<any>}} args.llm  an @canopy/llm-client LlmClient.
 * @param {string} args.expectedMeasurement  pinned enclave image hash.
 * @param {*} [args.roots]                    trusted root(s), passed to verifyChain.
 * @param {number} [args.maxAgeMs]            freshness window.
 * @param {string} [args.expectedNonce]       anti-replay nonce the report must echo.
 * @param {() => number} [args.now]           clock injector (deterministic freshness in tests).
 * @param {'once'|'always'} [args.policy]     re-attest every invoke ('always') or cache the first
 *                                            successful attestation ('once', default).
 * @returns {{ invoke(req:any, ctx?:any): Promise<any>, attest(): Promise<{ok:true}|Refusal>, reset(): void }}
 */
export function createConfidentialLlm({
  endpoint,
  attestation,
  verifyChain,
  llm,
  expectedMeasurement,
  roots,
  maxAgeMs,
  expectedNonce,
  now,
  policy = 'once',
} = {}) {
  if (!endpoint || endpoint.tlsPublicKey == null) {
    throw new TypeError('createConfidentialLlm: endpoint with tlsPublicKey required (RA-TLS binding)');
  }
  if (!llm || typeof llm.invoke !== 'function') {
    throw new TypeError('createConfidentialLlm: llm with invoke() required (an @canopy/llm-client LlmClient)');
  }
  if (typeof verifyChain !== 'function') {
    throw new TypeError('createConfidentialLlm: verifyChain(report, roots) required (injected chain check)');
  }
  if (typeof expectedMeasurement !== 'string' || expectedMeasurement.length === 0) {
    throw new TypeError('createConfidentialLlm: expectedMeasurement (pinned enclave image hash) required');
  }

  const label = endpoint.name ?? endpoint.baseUrl ?? 'confidential-endpoint';
  /** @type {Promise<{ok:true}|Refusal>|null} cached attestation outcome for policy:'once'. */
  let attested = null;

  /** Run the full attestation gate ONCE, returning ok or a coded Refusal. Never throws. */
  async function runAttestation() {
    try {
      const report = typeof attestation === 'function' ? await attestation() : attestation;

      const res = await verifyAttestation(report, {
        expectedMeasurement,
        roots,
        verifyChain,
        maxAgeMs,
        expectedNonce,
        ...(typeof now === 'function' ? { now: now() } : {}),
      });
      if (!res.ok) {
        return refuse('attestation-failed', res.reason, res.message);
      }

      // RA-TLS: the attested enclave must be the actual TLS peer.
      if (!verifyChannelBinding(report, endpoint.tlsPublicKey)) {
        return refuse('channel-unbound', 'channel-binding-mismatch');
      }

      return { ok: true };
    } catch (err) {
      // A producer that throws, or any surprise, is a FAILED attestation — refuse, never route.
      return refuse('attestation-error', 'error', err && err.message);
    }
  }

  /** Force (re)attestation now; caches the result under policy:'once'. */
  async function attest() {
    if (policy === 'always') return runAttestation();
    if (!attested) {
      attested = runAttestation();
      // Don't cache a rejection forever if it was a transient producer error — but DO cache
      // a genuine verification rejection. Simplest safe rule: cache the resolved outcome; the
      // caller can reset() to retry. (A rejection cached = deny-by-default holds; no downgrade.)
    }
    return attested;
  }

  return {
    /**
     * Attest-then-route. Returns the LLM result on success, or a coded Refusal on failed
     * attestation. On refusal, `llm.invoke` is NEVER called — no prompt bytes leave the device.
     */
    async invoke(req, ctx) {
      const gate = await attest();
      if (!gate.ok) {
        // REFUSE. No fallback, no plain endpoint, no bytes to the host. Return the coded
        // refusal (it carries NO prompt content — only the endpoint label + reason code).
        return gate;
      }
      // Attested channel verified → route the confidential call through the injected client.
      return llm.invoke(req, ctx);
    },
    attest,
    /** Drop the cached attestation so the next invoke re-attests (e.g. rotated enclave / new session). */
    reset() { attested = null; },
  };

  function refuse(code, reason, message) {
    const out = { refused: true, code, reason, endpoint: label };
    if (message) out.message = message;
    return out;
  }
}
