# Menukaart — the composable options catalog (engineering view)

The feedback app is **one stack, many configurations**. A client picks a configuration per
deployment; the scenarios in the source material are fixed menus over the same knobs.

This document is the **engineering source-of-truth** for that menukaart: every option, its
**status**, the **config field** that selects it, and the **code** that implements it — with the
conclusions of the 2026-06-09 channel/LLM-runtime discussion folded in (§2, §4B, §4D).

It sits between two existing artifacts and should stay consistent with both:

- **Commercial / narrative menukaart** — `Project Files/Aanpak/5.4 proces_en_menukaart.md`
  (Dutch, client-facing; blocks A–K). This doc keeps those block letters so the two line up.
- **The config schema** — `src/config/project-config.js` (`ProjectConfigSchema` + `CONFIG_TIERS`).
  That schema *is* the menukaart in code; this doc explains and extends it.

**Status legend:** ✅ shipped · 🔶 partial / seam only · ⬜ planned · 🅿️ parked (design captured,
out of current scope).

---

## 0. Off the menu — the non-negotiables

These always ship; they are what makes it the product (mirrors 5.4 §1):

- Participant approves before anything is released (co-redaction). ✅
- Nothing below the k-threshold passes. ✅
- Independent curation; no client touches data about itself. ✅ (workflow) / 🔶 (governance)
- No central store of raw, re-identifiable messages (BYO-pod + sealing). ✅
- Heavy signals run a separate track, with explicit consent. ✅
- The participant can always delete their own raw messages. ✅

---

## 2. The two orthogonal axes

**"local vs remote LLM" is two independent axes, not one.** Keeping them apart means you design
*one* integration, not two.

| Axis | Question | Options | Selector | Status |
|---|---|---|---|---|
| **Where the model runs** | who does inference? | `local` · `ovh` · `within-walls` · `privatemode` | `llm.route` | ✅ shipped (`ollama.js`) |
| **Where the bot runs** | who holds the WebID, receives messages, calls the model? | on-device (signed) · host-run (unsigned) | channel adapter | 🔶 TG host-run ✅ / canopy on-device 🔶 |

Once separated, "local LLM like household" and "remote LLM as a contact" collapse into **one
architecture**: a canopy agent whose model backend is a swappable `llm.route`. The model-location
axis is *already solved and route-agnostic*; the new work is all on the bot-location axis (§4B).

**Ownership boundary.** Every LLM role — clean, label, summarize, translate, intent classification,
and aggregation — plus the `llm.route` config belongs to **feedback-pipeline**, never to canopy-chat.
canopy-chat is only the contact/transport shell: it hosts the bot agent (on its `InternalBus`) and
renders the DM; it does not configure or call an LLM. The bot's logic (`CanopyChatBot` + dispatcher +
pipeline) is feedback-pipeline code, merely co-hosted in canopy-chat's process for the local tier
(`[[canopy-chat-unifier-principle]]`).

A third axis — **how the message reaches the model** (loopback / enclave gateway / on-phone
proxy) — is specified in `CONFIDENTIAL-LLM-TRANSPORT.md` and summarised in §4D.

**The constitutive constraint (Klai north-star).** `KLAI-cooperation-models.md` makes one thing
*non-negotiable*, not a menu choice: **local-first is constitutive.** The AI-assisted clean must
happen before any raw data leaves the user's hands *readable*, or consent is broken at step one.
This constrains the model-location axis **for the per-message clean of raw input**: only `local`
(on-device) and `privatemode`-to-an-attested-enclave are valid there; a plain remote route
(`ovh` / `within-walls`) is allowed *only* for already-anonymized, already-consented downstream
work. The confidential transport (§4D / Option B) is precisely what lets a *heavy remote* model
stay within this rule — see §4D for the route-validity table.

---

## 3. The process, and where each choice falls

(Mirrors 5.4 §3; brackets point at the menukaart block.)

1. **Invitation** via an independent route — letter / poster / QR / koepel. *(block A)*
2. **Sign-up** → own pod provisioned, with a bot (Telegram / canopy-derived chat / other) and
   user-controlled AI. *(blocks B, D, verify)*
3. **Contribute** — text or voice, whenever; the bot confirms / sometimes asks. *(block C)*
4. **Clean** — per-message clean version by the LLM. *(block D)*
5. **Approve (co-redaction)** — participant edits / approves / withdraws before aggregation. *(block E)*
6. **Aggregate with threshold** — approved clean input merged; a picture emerges above k. *(block F)*
7. **Tracks & report** — statistical / signal / curation. *(block G)*
8. **Feedback to participant** — optional. *(block H)*

Throughout: the participant can inspect their own space and delete messages. *(portal — block B)*

---

## 4. The menukaart, block by block

Each block lists the options, the **config field**, **status**, and the **code** pointer.

### A. Intake & access *(instroom en toegang)*

| Option | Field | Status | Code / note |
|---|---|---|---|
| Invitation route (letter/poster/QR/koepel) | — (operational) | ✅ | out-of-band by design |
| Verification: open / verified / group-accept | `privacy.verify` + activation | ✅ | `activation/` redemption codes → pseudonyms; `pod/signing.js` roster |
| Run length: continuous / per-topic / long-running | operational | ✅ | per-project |
| Space lifetime: trajectory-only / persistent ("portfolio") | `retention.ownPod` | ✅ | `until-delete` / `project-end` / `days:N` |

Open question (5.4 §6): handing out + verifying access without denting anonymity. ⬜

### B. Channel & interface *(kanaal en interface)*

| Option | Field | Status | Code / note |
|---|---|---|---|
| Telegram (host-run, **unsigned**) | channel adapter | ✅ | `channel/telegram-bot.js` — the lightweight, lower-trust tier |
| canopy-chat derived chat (**on-device, signed**) | channel adapter | 🔶 | `channel/canopy-chat-bot.js` multiplexer exists; NKN peer-transport bridge **not yet wired** |
| WhatsApp / Signal / phone-with-bot | — | ⬜ | bridge interface (`onMessage`/`sendReply`) makes these adapters, not rewrites |
| Form: text / voice / both | — | 🔶 | text ✅; voice ⬜ — STT available via privatemode (`whisper-large-v3` / `voxtral-mini-3b`, `privatemode-models.md`) |
| Own-space view: chat-only / read-only page / editable page | portal | 🔶 | `portal/` exists; participant editable-portal scope TBD |

**Bot-as-contact model (the design that's already canon).** canopy-chat treats agents as *just
another user* — an external WebID over NKN, gated by the circle `agents` policy axis +
`agentsMayContactMe` (`[[feedback-agent-is-just-a-user]]`). So "the feedback bot is a contact you
chat with" is **with the grain**, not a hack. The codebase is ~70% there:

- ✅ have: peer identity + the **secure-agent peer transport** (transport-agnostic — NKN / relay /
  WebRTC / in-process loopback, picked by `transportMode`), DM threads (auto-spawned, keyed by
  WebID), inbound `onPeerMessage` routing, circle membership with `relation:'agent'`, agent
  block/opt-out gates. The bot multiplexer (`channel/canopy-chat-bot.js`) also already exists and
  passes the bridge contract against the in-memory bridge (`scripts/canopy-chat-smoke.js`).
- 🔶 missing (the new ~30%): a real **bridge** behind the existing `{onMessage, sendReply}` contract
  `CanopyChatBot` already consumes — **two thin variants, one contract**:
  **`InternalBusBridge`** for a **local** co-hosted bot (raw never leaves the device — the *signed*
  tier; the `realAgent.js` shared-`InternalBus` topology) and **`PeerBridge`** over `sa.peer` for an
  **external** server bot (the *unsigned* tier). canopy-chat itself is currently **receive-only /
  command-first**; the auto-reply loop is the piece to build. Everything downstream (dispatcher,
  floors, sealing, signing, privatemode) already exists. See `PLAN-canopy-bot-and-confidential-transport.md`.

**A bot contact ≡ a human-device contact — same mechanism (`[[feedback-agent-is-just-a-user]]`).**
There is no special "bot" path: a bot is just an agent that auto-replies via an LLM, presented as a
contact. `CanopyChatBot` + the dispatcher + the participant UX are **identical** across both
bridges; placement only picks *which thin bridge sits under the contract*. The *only* things it
changes are the trust tier (signed vs unsigned, §B above) and where the heavy LLM call routes (§4D)
— **not** the add-a-contact mechanism. (Availability differs — a server bot is always reachable, a
local bot only while the app is open — but that is UX, not architecture.)

**On-device vs host-run is also a privacy-tier choice (not just deployment).** The signing model
only works on-device:

- on-device → participant holds the Ed25519 key → contributions are **signed** → anti-sybil /
  `privacy.verify` works, sealed before leaving the device.
- host-run → no participant key → **unsigned** → a `verify` project gracefully refuses and points
  the participant at the canopy app (this is exactly why TG is the "lower-trust" tier in
  `SECURITY-MODEL.md` §8).

→ **Recommendation:** default to **on-device, presented as a contact surface** (keeps signing +
sealing); offer **host-run "real NKN contact"** only as the unsigned fallback for participants who
cannot run on-device. "Looks like a contact" and "runs on-device" are *not* mutually exclusive.

**Intent classifier, not open-ended tool-calling.** Household interprets free speech as arbitrary
tool calls; the feedback bot does not need that. Its "tools" are a fixed intent set
(message / review / consent / withdraw), already handled by `channel/intent.js`. Simpler and more
auditable; reserve full tool-calling for if the bot ever needs open-ended actions. ✅

**Group-chat bot participation: deferred.** ⬜ Threads are event-filters, not rosters, and
"agent-as-participant" is flagged undesigned (canopy v2 board 4B). The feedback flow is inherently
1:1 (one participant ↔ the bot collecting their contribution privately). **DM-first**; revisit
groups only if a use case demands it.

### C. Bot posture *(houding van de bot)*

| Option | Field | Status | Code / note |
|---|---|---|---|
| Passive / asking / structured | prompt + intent | 🔶 | `prompts.js`, `channel/intent.js`; posture presets ⬜ |
| Tone: neutral log / friendly-with-memory | prompt | 🔶 | per-scenario prompt; memory ⬜ |
| Proactive ("how are you?") vs. waiting | — | ⬜ | scenario B/zorg |

### D. AI help & where it runs *(AI-hulp en waar die draait)*

This block is refined by §2 + `CONFIDENTIAL-LLM-TRANSPORT.md`. Split into the two real questions:

**D1 — where the model runs** (`llm.route`) — and the local-first constraint (§2). Which routes
are valid depends on *what* you are processing: the **per-message clean of raw input** must stay
local-first; **downstream aggregate** work (already consented + anonymized) may use any route.

| Route | Field | Valid for raw-clean? | Trust base | Status |
|---|---|---|---|---|
| Local Ollama (on-device) | `local` | ✅ strict local-first | user's own device only | ✅ default; `OLLAMA_URL` |
| **Privatemode via enclave gateway** | `privatemode` | ✅ — plaintext only inside attested enclaves | + TEE attestation | ✅ route / ⬜ gateway (Option B) |
| Privatemode loopback proxy | `privatemode` | ✅ when proxy = on the phone | + TEE attestation | ✅ `PRIVATEMODE_PROXY_URL` |
| OVH AI endpoints | `ovh` | ❌ raw leaves readable | + the remote host | ✅ (aggregate/anonymized work only); `FP_LLM_BASEURL` |
| Within-walls / OpenAI-compatible | `within-walls` | ❌ raw leaves readable | + the remote host | ✅ (aggregate/anonymized work only) |

**Synthesis:** the confidential transport (Option B) is what reconciles "use a heavy remote model"
with "local-first is constitutive" — a plain remote route breaks the rule for raw input;
privatemode-to-an-enclave does not. So `local` and `privatemode`(enclave) are the two clean-step
routes.

**Model menu** (`privatemode-models.md`): chat — `kimi-k2.6`, `gpt-oss-120b`, `gemma-4-31b`
(minimal profile); local — `qwen2.5:7b`, `mistral:7b` (verbose). Speech-to-text —
`whisper-large-v3`, `voxtral-mini-3b` (enables block-B voice). Embeddings — `qwen3-embedding-4b`
(future dedup). Per-task reasoning on/off via `llm.reasoning` (`parameters.md` §A2).

**D2 — how the message reaches a *remote* model confidentially** (`CONFIDENTIAL-LLM-TRANSPORT.md`):

| Transport | Status | Note |
|---|---|---|
| Loopback proxy (proxy co-located with client) | ✅ | the `localhost:8080` default; safe when client = phone |
| **Enclave gateway (Option B)** | ⬜ **build target** | proxy in its own attested TEE; host stays blind; thin phone client; reuses Phase-2 attestation |
| On-phone proxy (Option A) | 🅿️ | parked for research; maximal-regself tier; ships the proxy to every device |
| Plain proxy on untrusted host | ❌ | **not allowed** — host sees plaintext; add the `ollama.js` guardrail |

**D3 — degree of intervention:** clean-only / also help phrase. 🔶 (`prompts.js`; human stays
final editor — non-negotiable.)

> Note: don't rush to swap `ollama.js` for `@canopy/llm-client`. The app's own route layer
> already does privatemode + rate-limiting + retries; graduating to the shared client is later
> cleanup, not a prerequisite. *(`[[llm-pluggability-deferred]]`)*

### E. Co-redaction & approval *(co-redactie en goedkeuren)*

| Option | Field | Status |
|---|---|---|
| Rhythm: per-message / batches / per-round | review flow | 🔶 (`channel/dispatcher.js` `review()`/`consent()`) |
| Cooling-off period | — | ⬜ |
| What you see: clean / summary / both | — | 🔶 |
| Withdraw: until aggregation / also later, retroactive | consent + release | ✅ until release / ⬜ retroactive |
| On no response: nothing passes (no timed opt-out) | enforced | ✅ |
| Review touchpoint: notification / required-approval | `review.mode` | ✅ |

### F. Aggregation & threshold *(aggregatie en drempel)*

| Option | Field | Status |
|---|---|---|
| Threshold k (typ. 4–7) | `aggregation.k` | ✅ |
| Below-threshold: drop / rephrase / quarantine | `aggregation.belowThreshold` | ✅ |
| **Decrypt placement: host / controller / enclave** | `aggregation.location` | ✅ host+controller (Phase 1) / 🔶 enclave (Phase 2 shaped, not operated) |
| Cuts (buurt/age/dept — only if participant volunteers) | — | ⬜ |
| Frequency: continuous / quarterly / end-of-trajectory | operational | ✅ |

### G. Tracks & output *(sporen en output)*

| Option | Field | Status |
|---|---|---|
| Statistical track | always on | ✅ (`triage.js`, `aggregate.js`) |
| Signal track on/off + destination | `signal.*` | ✅ |
| Escalation categories | `signal.escalationCategories` | ✅ (+ deterministic floors — `CATEGORIES-AND-LAYERS.md`) |
| Layer-1 on-device detection | `signal.layer1OnDevice` | ✅ (provisional, default off) |
| Passive support resources (e.g. 113) | `signal.passiveSupport` | ✅ |
| Curation track (curated quotes) | curator | ✅ (`curator/`) |
| Contact-request track kept separate | floor | ✅ (`detectContactRequest`) |

### H. Feedback to participant *(terugkoppeling)*

| Option | Field | Status |
|---|---|---|
| Nothing / receipt / "what was done" / share picture / recognition question / second round | — | 🔶 receipt ✅; sealed notify ✅ (`channel/notify.js`); fuller loop ⬜ (5.4 §2b — aggregate-only, opt-in, threshold intact) |

### I. Client → participant communication *(communicatie afnemer → deelnemer)*

| Option | Field | Status |
|---|---|---|
| One-way only | default | ✅ |
| Two-way via intermediary (pseudonymous) | sealed notify | 🔶 (`channel/notify.js` is the seam) |
| Breadth: everyone / targeted-by-theme | — | ⬜ (re-identification risk — careful) |

### J. Retention & deletion *(bewaren en verwijderen)*

| Option | Field | Status |
|---|---|---|
| Raw kept in own space as long as wanted | `retention.ownPod` | ✅ |
| Above-threshold gets a fixed form | by design | ✅ (deliberate exception, stated up front) |
| Retention term per scenario (stricter for special data) | `retention.ownPod` (`days:N`) | ✅ |
| Sealing at rest + who mints the key | `privacy.seal`, `privacy.keygen` | ✅ (`pod/project-seal.js`; `client`/`external`/`host`) |
| Escrow / recovery recipient | `privacy.escrow` | ✅ (opt-in) |

### K. Governance & who does the research *(governance)*

| Option | Field | Status |
|---|---|---|
| Curation always independent | governance | 🔶 (workflow ✅, org model ⬜) |
| Research/interpretation: intermediary vs. client | `eval.owner` | ✅ (`us`/`independent`/`raad`) |
| Accountability: transparency report / complaints / external board | `eval.publish` + ops | 🔶 |
| MCP exposure of anonymized output to Klai | MCP server | ✅ (`mcp/server.js`, `README-mcp.md`) |

**Klai as the downstream workspace (`KLAI-cooperation-models.md`, `KLAI-evaluation.md`).** Klai is
an EU-hosted, access-governed *workspace* — never a redactor. **Ordering is the safeguard:
anonymize before anything reaches Klai.** Three cooperation models, ranked by near-term value:
**(2b)** Klai as the GDPR-safe researcher room for our anonymized aggregates *(lead with this; works
with zero LLM integration)* 🔶; **(2a)** EU-Mistral exploration of the aggregates — guard against
*mosaic re-identification* via Klai's access control ⬜; **(1)** Shield as an independent 2nd
redaction net (caveat: no Dutch PII detection — our floors stay the guarantee) ⬜. The moat that
stays ours: user-control-aided-by-AI, local-first, Solid-pod ownership, k-anon + signal governance,
Dutch PII floors. Two upstream OSS borrows flagged: **Lingua** (better lang detection → `lang.js`)
and **LiteLLM** (multi-provider / per-language gateway — an alternative to the `ollama.js` route
layer; defer per `[[llm-pluggability-deferred]]`).

---

## 5. Cross-cutting layers (compose under every block)

The layers the blocks above lean on (crypto rationale in `SECURITY-MODEL.md`; onboarding
checklist in `parameters.md`):

| Layer | Field | Status | Code |
|---|---|---|---|
| At-rest sealing (X25519 sealed-box to project key) | `privacy.seal` + `keygen` | ✅ | `pod/project-seal.js`, `pod/crypto-config.js` |
| Signing / anti-sybil (Ed25519 + roster) | `privacy.verify` | ✅ | `pod/signing.js` |
| Aggregation placement (host/controller/enclave) | `aggregation.location` | ✅ / 🔶 enclave | `aggregation/placement.js`, `tee/aggregate.js` |
| BYO central pod | — | ✅ | `pod/byo-central-pod.js` |
| Deterministic floors (PII, names, categories) | floors | ✅ (core) / ⬜ (some categories) | `redact.js`, `names.js`, `categories.js`, `signals.js` |
| Prompt-quality passes (token shielding · minimal-edit · translate-before-aggregate) | prompt layer | ✅ core / ⬜ multi-round verify | `util.js shield/unshield`, `BEST-PRACTICES.md` |
| **Confidential LLM transport (enclave gateway)** | `llm.route` + new | ⬜ **build target** | `CONFIDENTIAL-LLM-TRANSPORT.md` |
| Deployment / ops (pods host · activation service · multi-cloud restic backup · writer WebIDs) | `deploy/.env` | ✅ | `parameters.md` §C |
| Client-side runtime (key custody + egress firewall) | — | 🅿️ | `AGENT-RUNTIME.md` |

---

## 6. What's shipped vs. to build (the review summary)

**Shipped and composable today (✅):** all four LLM routes incl. privatemode; sealing + keygen;
signing/anti-sybil; k-anonymity with below-threshold policy; host/controller aggregation
placement (Phase 1); Telegram channel (unsigned tier); signal track with deterministic floors;
review modes; retention; BYO-pod; sealed two-way notify; curator workflow; MCP for Klai.

**The build path (⬜, in priority order):**

1. **canopy-chat as a bot contact** — a real bridge behind the `{onMessage, sendReply}` contract
   `CanopyChatBot` already consumes: `InternalBusBridge` for a local co-hosted bot (signed) and
   `PeerBridge` for an external server bot (unsigned). (Block B.) The single biggest unlock — it
   upgrades the privacy tier and is the canonical channel.
2. **Confidential LLM transport — Option B** (enclave gateway) so the on-device bot can use a
   heavy remote model with the host blind. (`CONFIDENTIAL-LLM-TRANSPORT.md`; reuses Phase-2
   attestation.)
3. **`ollama.js` guardrail** — refuse a non-loopback `privatemode` URL without attestation config
   (cheap; encodes the whole transport principle; do first as a footgun-remover).
4. **Phase-2 enclave aggregation** (`aggregation.location: 'enclave'`) — the symmetric endgame;
   shares attestation plumbing with #2.

**Parked (🅿️, research later):** Confidential transport Option A (on-phone proxy); the
client-side agent runtime / runtime-browser (`AGENT-RUNTIME.md`).

**Deferred (⬜, no demand yet):** group-chat bot participation (board 4B undesigned).

→ Next step: turn this §6 into a sequenced implementation plan.

---

## 7. Source docs folded into this catalog

So coverage is auditable — every feedback-pipeline doc reviewed while building this menukaart:

- **Options / config:** `src/config/project-config.js` (the schema + `CONFIG_TIERS`), `parameters.md`
  (onboarding checklist + env), `Project Files/Aanpak/5.4 proces_en_menukaart.md` (commercial menu).
- **Privacy / security:** `SECURITY-MODEL.md`, `CONFIDENTIAL-LLM-TRANSPORT.md` (new), `AGENT-RUNTIME.md`
  (parked client runtime), `CATEGORIES-AND-LAYERS.md` (deterministic floors).
- **LLM / pipeline:** `README.md`, `pipeline-order.md`, `privatemode-models.md` (model menu),
  `BEST-PRACTICES.md` (prompt-quality layer), `PLAN-tomorrow-tg-pod.md` (the substrate-reuse
  template the canopy bridge will follow).
- **Governance / partner:** `KLAI-evaluation.md`, `KLAI-cooperation-models.md`, `README-mcp.md`.
- **Evaluation evidence (not options — test/result dumps):** root `results-*.md`
  (`-clean`, `-fullpipeline`, `-model-comparison`, `-participation`, `-pipeline`, `-scenarios*`,
  `-stress`, `-summarize`, `-triage`), `FINDINGS.md`, `SIMULATIONS.md`, `STRESS-TEST-*.md`,
  `TRACE-*.md`. Reviewed for menu-relevant knobs; they inform model/threshold choices but add no
  new menu items. `results-model-comparison.md` is the evidence behind the D1 model menu.

→ Next step: turn §6 into a sequenced implementation plan.
