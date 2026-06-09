# Confidential LLM transport — phone bot, enclave proxy

How a feedback bot that runs **on the participant's own device** can reach a **heavy remote
model** through Privatemode **without any host OS ever holding the plaintext** of a message.

This is the transport-layer companion to `SECURITY-MODEL.md`. That document answers *"on whose
machine does aggregation decrypt?"* (placement: host / controller / enclave). This one answers
the symmetric question for the **per-participant LLM leg**: *"on whose machine does the
participant's message get encrypted before it reaches the model?"*

Status: **design — Option B chosen as the build target; Option A parked for later research.**
The runtime knob it touches today is `llm.route: 'privatemode'` + `PRIVATEMODE_PROXY_URL` in
`src/ollama.js`.

---

## 1. The core principle

Plaintext may only ever live in two kinds of place:

1. **the participant's own device** (their data, their machine), and
2. **an attested enclave** (a TEE whose memory the host cannot read).

Everything else — including any "proxy on a server" — must only ever touch **ciphertext**.

The trap: the **Privatemode proxy is, by definition, the point where plaintext gets encrypted
to the model enclave.** It (1) remote-attests the inference enclave, (2) opens an end-to-end
channel whose decryption terminates *inside* that enclave, and (3) exposes a plain
OpenAI-compatible endpoint locally. A component that can do step 2 holds the session key — so it
*can* read the plaintext. It cannot be both "the encryptor" and "blind to the data."

That is why `ollama.js` defaults `PRIVATEMODE_PROXY_URL` to `http://localhost:8080/v1`: the
default **assumes the proxy is co-located with the client**. Pointing that variable at an
ordinary remote host silently moves the plaintext boundary onto that host — TLS does not help,
because the host terminates TLS and sees cleartext.

So "proxy on a server, host stays blind" has exactly **two** valid shapes, below. A plain
(non-enclave) proxy process on an untrusted host is **not** one of them.

---

## 2. Option B — proxy inside its own attested enclave *(the build target)*

Put the proxy in **its own TEE**. Now "host memory" ≠ "proxy memory": the confidential-computing
hardware encrypts the proxy VM's RAM against the host on the same machine, so the host cannot
read it even though the proxy is server-side.

```
 participant phone                server (untrusted host)
 ┌─────────────────────┐          ┌──────────────────────────────────────────┐
 │ dispatcher + floors │  E2E     │  [ proxy enclave ]        [ model enclave ]│
 │ sign + seal         │ ───────► │  attests model    E2E     Privatemode      │
 │ attest proxy enclave│  cipher  │  forwards ───────────────► inference        │
 │ encrypt to proxy    │          │  ▲ plaintext (attested,   ▲ plaintext       │
 └─────────────────────┘          │    host-blind)              (attested,      │
   ▲ plaintext                    │                              host-blind)    │
   (participant's own)            └──────────────────────────────────────────┘
```

Flow:

1. The phone **attests the proxy enclave once** (verifies it is a genuine TEE running the
   expected proxy image), then opens an E2E channel whose decryption terminates *inside* that
   enclave.
2. The proxy enclave attests the **inference enclave** and forwards enclave-to-enclave.
3. Plaintext now lives in: the phone + the proxy enclave + the inference enclave — all trusted
   or attested. **Never host memory.**

Why this is the right target for this app:

- **Safe** — the host running the proxy cannot read it; trust reduces to "the hardware TEE +
  correct attestation," the same root of trust as the Phase-2 aggregation enclave
  (`SECURITY-MODEL.md` §6). No new trust *kind* is introduced.
- **Versatile / cheap per client** — one shared confidential gateway serves a fleet of **thin**
  mobile clients. The phone only does an attestation handshake + symmetric encryption; it does
  **not** ship the full Go proxy. Centralised rate-limiting, key-management, and model routing
  live in the enclave, not on every device.
- **Reusable** — this is the same enclave + attestation plumbing the project already needs for
  Phase-2 aggregation. Building it for the LLM leg amortises directly onto the aggregation
  endgame; the two share Contrast-style attested-key-release and quote-verification code.

What it requires (the new work):

- A **confidential gateway image** (the Privatemode proxy, or an equivalent, packaged to run
  inside a CVM — AMD SEV-SNP / NVIDIA H100 CC).
- **Client-side attestation verification + key pinning** on the phone (the phone must check the
  gateway's quote itself — if the server told the phone "trust this key," the server could MITM).
- An **E2E session** phone → gateway-enclave (a TLS-in-TEE / RA-TLS handshake).

---

## 3. Option A — keep the encryption endpoint on the phone *(parked — research later)*

The canonical Privatemode shape, minimised: run only the **plaintext-touching part** (attest the
inference enclave + encrypt the request) on the phone, and let the server be a **dumb ciphertext
relay** that never holds a key.

```
 phone (dispatcher + floors + sign + seal + ENCRYPT) ──cipher──► relay ──cipher──► model enclave
   ▲ plaintext (participant's own)                       ▲ ciphertext only        ▲ plaintext (attested)
```

Trade-off vs. B: the trust base is even smaller (no gateway enclave at all — plaintext lives only
on the phone and in the model enclave), **but** it ships the attestation + encryption shim to
*every* device. On React Native that means bundling `edgelesssys/privatemode-public` via gomobile
or reimplementing the handshake natively — heavier per-client, and a packaging unknown.

**Decision (2026-06-09): park Option A as a research item.** Revisit it as the "maximal regself"
tier once Option B is running and we know the real cost of the on-device proxy on phones. Until
then it is **not** on the build path. (Tracked under menukaart block D — see `MENUKAART.md`.)

---

## 4. What you cannot do

Run the Privatemode proxy as a normal (non-enclave) process on an untrusted host and expect
privacy. There is no third placement: the plaintext-touching crypto must live on the phone or in
an enclave the phone has attested. Anything else puts the message in that host's RAM.

**Config guardrail (to implement):** in `src/ollama.js`, when `llm.route === 'privatemode'`,
refuse a **non-loopback** `PRIVATEMODE_PROXY_URL` unless an attestation-verification config is
present (Option B). This makes the safe path the default and turns the silent footgun — pointing
the proxy at a plain remote host — into a startup error. One check encodes the whole of §1.

---

## 5. How it composes with the rest of the stack

These are **independent axes** (see `MENUKAART.md` §2). Pick one from each:

| Axis | Options | Where it lives |
|---|---|---|
| **Where the model runs** | `local` · `ovh` · `within-walls` · `privatemode` | `llm.route` (`ollama.js`) — shipped |
| **Where the bot/dispatcher runs** | on-device (signed) · host-run (unsigned) | channel adapter (`channel/`) |
| **How the message reaches the model** | loopback · **enclave gateway (B)** · on-phone proxy (A) | this doc |
| **Where aggregation decrypts** | host · controller · enclave | `aggregation.location` (`placement.js`) |

The privacy-maximal feedback configuration is: **on-device dispatcher** (keeps signing + sealing
on the participant's machine) + **`route: 'privatemode'` via an enclave gateway (B)** (model
provider and gateway host both blind) + **`aggregation.location: 'enclave'`** (Phase 2). At that
setting, *no untrusted party ever sees an individual plaintext message* — not the LLM provider,
not the gateway host, not the platform, not the controller's IT.

Important scope note: Privatemode buys trust against the **LLM provider/gateway host** only.
Trust against the **bot host** is the *separate* axis above — handled by running the dispatcher
**on-device** so the message is signed and sealed before it leaves. The two together are what
close the loop. See also the parked client-side `AGENT-RUNTIME.md` (key custody + egress
firewall), which is the on-device complement that stops a malicious *app* from exfiltrating the
plaintext the dispatcher is holding.

**This is also what reconciles a *remote* model with "local-first is constitutive."** The Klai
north-star (`KLAI-cooperation-models.md`) requires the AI-assisted clean to happen before any raw
data leaves the user's hands *readable*, or consent breaks at step one. A plain remote route
(`ovh` / `within-walls`) puts raw input on an uncontrolled host pre-consent and violates that. An
**enclave gateway never makes the plaintext readable to any party the user doesn't control**, so
the clean step stays effectively local *even on a heavy remote model*. That is why, for the
per-message clean of raw input, only `local` and `privatemode`-to-an-enclave are valid routes;
`ovh` / `within-walls` are for already-anonymized downstream work only (see `MENUKAART.md` §4D).

---

## 6. Open questions for when we build B

- CVM base + attestation stack: Edgeless **Contrast** (Kubernetes-native, matches the Phase-2
  aggregation choice) vs. a bare SEV-SNP VM.
- Client-side quote verification on React Native — library vs. a thin native module; how the
  phone pins the expected gateway measurement and rotates it on gateway upgrades.
- Whether the gateway enclave also terminates the **aggregation** path (one enclave, two jobs) or
  stays LLM-only.
- Rate-limit / multi-tenant isolation inside the gateway (one enclave serving many projects).
