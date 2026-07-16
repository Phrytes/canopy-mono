// @onderling/confidential-llm — phone-side confidential LLM (Objective F, invariant #7:
// "trust by attestation, not by host").
//
// Sensitive LLM compute must run client-side or in an ATTESTED enclave, never on an
// untrusted host. This package is the CLIENT side of the enclave path: before a phone
// sends a confidential prompt to a remote enclave gateway it VERIFIES the enclave's
// SEV-SNP-style attestation (the enclave proves what code it runs + that the TLS channel
// is bound to that enclave), and REFUSES to send anything if attestation fails. Only once
// attestation passes does it route the LLM call — host-blind — through the attested channel
// via an injected @onderling/llm-client LlmClient.
//
// Three pieces:
//   • verifyAttestation      — measurement + freshness + signature-chain (verifyChain INJECTED)
//   • verifyChannelBinding   — RA-TLS: reportData commits to the TLS pubkey (the peer IS the enclave)
//   • createConfidentialLlm  — attest-first gateway; deny-by-default, NO silent downgrade
//
// The real TEE/CVM enclave image, the real SEV-SNP quote producer, the real AMD cert chain,
// and the live RA-TLS transport handshake are the DEFERRED deploy side (Fb M7/M8). Here the
// signature check (verifyChain), the quote (attestation), and the LLM route (llm) are all
// injected, so the whole verifier + gateway is mock-tested with no hardware.

export { verifyAttestation, verifyChannelBinding } from './attestation.js';
export { createConfidentialLlm } from './confidentialLlm.js';
