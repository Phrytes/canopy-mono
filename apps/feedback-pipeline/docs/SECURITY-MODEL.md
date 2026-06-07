# Security & trust model

How the feedback pipeline keeps participants' input confidential, who can read what,
and the deliberate two-phase path from "the platform can't read you" (Phase 1, shipped)
to "no one but the math can read you" (Phase 2, the TEE).

This document explains the *why*. The *how* lives in:
`pod/project-seal.js`, `pod/signing.js`, `pod/crypto-config.js`, `aggregation/placement.js`,
`tee/aggregate.js`, and the runnable demos `npm run secure-smoke` / `byo-tee-smoke` / `phase1-smoke`.

---

## 1. The parties

| Party | Role | Should it see individual plaintext? |
|---|---|---|
| **Participant** | writes feedback from their phone / web (canopy-chat) or Telegram | yes — it's their own data, on their own device |
| **Platform / pod host** | stores the central pod (could be you, a managed CSS, iGrant) | **no** — storage only |
| **Project team (data controller)** | the municipality/org running a project; holds the project private key | the **aggregate**; individual plaintext only where unavoidable (Phase 1) |
| **Privatemode (Edgeless)** | confidential LLM inference for the heavy model | no (runs in a TEE; attested) |

The GDPR framing: the **platform is a processor** that handles only ciphertext; the
**project team is the controller**. The crypto enforces that split rather than promising it.

---

## 2. The two keys (the crux)

There are **two unrelated keypairs**. Confusing them is the usual source of "wait, who can
decrypt?" questions.

- **Participant identity key** (`signing.js`) — Ed25519 (signing) + X25519 (notify). Lives on
  the participant's device, **never shared**. Used to *sign* contributions and *receive* sealed
  notifications.
- **Project keypair** (`project-seal.js`) — X25519. The **public** key is published in the
  project config; the **private** key is held by the project team. Anyone can *seal to* the
  public key; only the private-key holder can *open*.

**Sealing is asymmetric.** The participant locks each contribution into a box that only the
*project's* private key opens (a hybrid sealed-box: random AES-256-GCM content key, wrapped to
the recipient via ephemeral X25519 → HKDF). The writer needs **only public keys** — so the
always-on writer, and the platform storage, never hold a secret that can read anything.

> The participant does **not** "share their key" for the server to decrypt. The server opens
> with the *project's* private key — a different key, held by the controller, never by the participant.

### Two seals, two purposes
- **Your personal pod** (raw + cleaned): protected by *your* access, for *you*.
- **The central contribution**: the cleaned point **re-sealed to the project public key**, so
  the *project* (not you) can open it at aggregation. The re-seal happens **on your device** —
  your key never leaves; the project public key is public.

---

## 3. Where plaintext exists (the honest map)

Sealing protects data **at rest** and **from every party except the intended reader**. It does
*not* make data computable while encrypted — so the one place plaintext must be assembled is
**aggregation** (finding shared themes across many people needs them decrypted together).

| Moment | Plaintext in RAM? | On whose machine |
|---|---|---|
| Participant composes (canopy-chat, `floorsTrust: 'pre-send'`) | yes | the participant's own device ✅ |
| Telegram intake (`floorsTrust: 'post-receipt'`) | yes | Telegram + the bot service ⚠️ (TG is the lightweight, less-private option) |
| Central pod at rest | **no — ciphertext only** | platform / pod host ✅ |
| **Aggregation (Task 2)** | **yes, transiently** | **the runner chosen by `aggregation.location`** ← the decision this doc is about |
| LLM calls | yes, for the text sent | local (on-device/Ollama) or Privatemode (TEE) — never a cloud host if you route to Privatemode |
| Curator review | yes (by design, for quarantined below-k items) | the controller (a human reviewing) |

Everything reduces to one question: **on whose machine does the aggregation decrypt?**

---

## 4. Aggregation placement — the team's enforced choice

`aggregation.location` (in the project config) is a **deliberate, enforced** trust choice. A
process declares its role via `FP_RUNNER_ROLE`; building an opener (the only way to decrypt,
in `crypto-config.js`) is **refused** unless the runner is at least as private as the project
requires (`aggregation/placement.js`). It is a mechanism, not a promise.

| `aggregation.location` | Who may decrypt | Plaintext (transiently) visible to | Confidential host needed? |
|---|---|---|---|
| `host` *(default)* | the shared platform host | the platform operator | no |
| **`controller`** *(Phase 1)* | **only the project team's own servers** | **only the data controller** | **no** |
| `enclave` *(Phase 2)* | only an attested TEE | **no one** (only the aggregate leaves) | yes |

Because the writer holds no private key, *raising* the bar costs the participant nothing —
upload is identical. Only *who is allowed to open* changes.

---

## 5. Phase 1 (shipped) — "the platform can't read you"

**The project team runs decryption + aggregation on their OWN infrastructure** (`location:
'controller'`), and routes the heavy model to the **Privatemode** proxy.

```
pod (ciphertext) ── platform serves sealed blobs ──►  [ CONTROLLER's own server ]
   platform only ever holds ciphertext                  open() with the project key
                                                         plaintext ONLY here, transiently
                                                         Privatemode proxy ─► PM enclave (LLM)
                                                         aggregate ◄────────────────────────
                                                         only the aggregate persists
```

What this achieves:
- **The platform / pod host never sees plaintext** — it stored and served only ciphertext.
- **Privatemode's host and Edgeless never see plaintext** — the proxy encrypts to the attested
  worker; the model leg is confidential. ([privatemode.ai/security-and-encryption](https://www.privatemode.ai/security-and-encryption))
- **Plaintext appears only on the controller's own box**, transiently in RAM, then gone — the
  stored copy stays sealed. That's the data reaching its lawful controller, not a leak to a third party.

**Threat covered:** participants are protected from the platform/storage operator and from the
LLM provider — with **no confidential hardware**. The right promise for most civic cases, where
the municipality *is* the legitimate recipient of the aggregated feedback.

**Hygiene that shrinks the Phase-1 window** (the controller's box is a normal host): keep raw on
participant pods (BYO); send only cleaned/deduped points; stream, don't persist, plaintext; never
log it; hold the project private key in an OS keystore/HSM; run aggregation on an ephemeral runner.

### Operating Phase 1
- Project config: `aggregation.location: 'controller'`, `privacy.seal: true`, `llm.route: 'privatemode'`.
- Platform host: runs the pod (serves ciphertext). It has **no** project private key; if it
  tried to aggregate it would be refused.
- Controller box: `FP_RUNNER_ROLE=controller`, holds the project private key, runs the Privatemode
  proxy locally, runs `runProjectAggregation()`.
- Demo: `npm run phase1-smoke` (host refused; controller succeeds).

---

## 6. Why we still need Phase 2 — "no one but the math can read you"

Phase 1 leaves **one** party who can technically see individual contributions during the run:
**the controller's own host** (a root admin there, or a breach of that box, is exposed). For the
strongest promise — *"not even the project team's IT can read your individual message; they only
ever get k-anonymized aggregates"* — that last window must close. Only a **Trusted Execution
Environment** does this.

Phase 2 makes the **enclave the keyholder** (`location: 'enclave'`):
- The project **private key lives only inside an attested enclave** (generated in-enclave, or
  released to it by an attestation-gated secret service — e.g. Edgeless **Contrast**).
- Confidential-computing hardware (AMD SEV-SNP, NVIDIA H100 CC) **encrypts the VM's RAM against
  the host on the same machine** — so "the proxy is on the same server" is no longer a leak: the
  host cannot read the enclave's memory.
- The host fetches **ciphertext** from the pod and feeds it in; the enclave opens it, aggregates,
  calls Privatemode **enclave-to-enclave**, and emits **only the aggregate + an attestation quote**
  the caller verifies before trusting the result.

Plaintext then lives only in two attested enclaves (your aggregation VM, Privatemode's worker) —
**never on any host OS, including yours.** The key, the plaintext, and the LLM I/O never escape.

**Why not just Phase 2 now?** It needs confidential hardware/hosting we don't yet operate, plus
attestation + key-release plumbing. Phase 1 delivers the large, real win (platform + LLM provider
blind) today with ordinary servers; Phase 2 is a **keyholder change, not a redesign** — the
participant upload flow, the seal, and `runSealedAggregation()` are unchanged. Only where the key
lives and where the function runs change.

### The code is already shaped for it
`tee/aggregate.js#runSealedAggregation` is the boundary: it opens + verifies + aggregates inside
one function and returns only the aggregate + `attestation`. Today the key is a parameter and
`localAttestation()` honestly reports `runner: 'host' | 'controller'` with `verified: false`. The
Phase-2 change: run that function inside the CVM, obtain the key via attested release instead of a
parameter, and have `attest()` return a real quote with `verified: true`.

---

## 7. What you trust, per phase

| | Phase 1 (`controller`) | Phase 2 (`enclave`) |
|---|---|---|
| Platform / pod host | only not to corrupt ciphertext | only not to corrupt ciphertext |
| Project team's host | **trusted with transient plaintext** | **not trusted** (can't read) |
| LLM provider | Privatemode (attested) or local | Privatemode (attested), enclave-to-enclave |
| Hardware root of trust | none required | CPU/GPU TEE + attestation |
| Residual | controller-side breach during a run | side channels; correct attestation/key-release config |

Both are **cryptographic + (Phase 2) attested**, not policy-based — a far smaller, more
verifiable trust base than the "trust the managed operator" model of a typical data-wallet SaaS.

---

## 8. Other guarantees (orthogonal to placement)

- **Authenticity / anti-sybil** (`privacy.verify`): every contribution is signed by a verified
  member (one redeemed activation code → one identity, bound at the HI handshake). Aggregation
  drops anything unsigned/forged/sybil. The host-run Telegram delegate can't sign → a verify
  project refuses it gracefully and points the participant to the canopy app.
- **Consent = the write** (ACP): only the participant may write their container; withdraw works
  until release; release marks included contributions and publishes transparency counters.
- **Bring-your-own-pod** (`pod/byo-central-pod.js`): contributions can live on each participant's
  own pod; the central side reads, opens, and verifies across sources without ever holding a copy.
- **Two-way notify** (`channel/notify.js`): the controller can reach a participant pseudonymously
  (e.g. "your point was released"), **sealed to the participant's key** so the host stores only ciphertext.
