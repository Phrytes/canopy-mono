# llm-proxy — no server-side to deploy (yet)

**Status: there is nothing to containerize here today.** This is the honest
blocker report the deploy task asks for, not a config that won't build.

## What exists in the repo

- **`packages/confidential-llm`** — the **client** side of the confidential-LLM
  path (invariant #7: "trust by attestation, not by host"). Before a phone sends
  a confidential prompt it VERIFIES an enclave's SEV-SNP-style attestation
  (`verifyAttestation`, `verifyChannelBinding`) and routes host-blind through the
  attested channel (`createConfidentialLlm`). Every collaborator — `verifyChain`,
  the quote producer, the LLM transport — is **injected and mock-tested**. There
  is no HTTP server, no `listen()`, no gateway process in this package.
- **`packages/llm-client`** — a provider client (Ollama/embeddings/etc.) used
  **client-side**. Also not a server.

The package's own docstring is explicit: *"The real TEE/CVM enclave image, the
real SEV-SNP quote producer, the real AMD cert chain, and the live RA-TLS
transport handshake are the DEFERRED deploy side (Fb M7/M8)."*

## Why it's not a normal PaaS service

The server this client wants to talk to is an **attested enclave** (SEV-SNP /
TDX confidential VM). That is *deliberately* not a plain container on Railway/Fly:
the whole point of invariant #7 is that the host is untrusted, so the LLM must run
inside a measured TEE that can produce a hardware attestation quote. A stock PaaS
container gives you neither the measurement nor the quote — deploying one would
defeat the attestation guarantee the client enforces.

## Options for Frits (pick when this becomes the focus)

1. **Privatemode / managed confidential inference** — point `createConfidentialLlm`
   at an existing attested endpoint (Privatemode.ai or an equivalent CVM inference
   service). No image for us to build; we supply the `verifyChain` + endpoint
   config. Fastest path to a *real* attested route.
2. **Self-host a confidential VM** — a GCP/Azure SEV-SNP (or AMD SEV/TDX) VM
   running an inference server (e.g. vLLM/Ollama) plus a quote producer + RA-TLS
   terminator. This is a cloud-VM + firmware concern, **not** a 12-factor PaaS
   container, so it lives outside `deploy/` on purpose.
3. **Non-confidential fallback for early testing** — for the automated test
   harness you don't need attestation: the app already routes ordinary LLM calls
   through `@onderling/llm-client` to a normal provider (Ollama locally, or a hosted
   model). Use that for the buurt/task scenarios and defer the enclave to Fb M7/M8.

**Recommendation:** don't block the deploy slice on this. Ship relay + pod +
companion now (below), use option 3 for the automated harness, and revisit the
attested enclave (option 1 or 2) when confidential inference is the active goal.
