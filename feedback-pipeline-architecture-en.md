# Feedback pipeline architecture — components and required mechanisms

*Working document. Describes each architectural component, who operates
it, and which processes/mechanisms still need to be developed.
Implementation status is intentionally omitted — assess against the
repository.*

**Guiding principle throughout: every promise is replaced by a
mechanism.** Consent = a write action, confidentiality = key location,
"we don't look" = "we can't look" (and where the latter is *not* true,
as with Telegram, it is stated honestly).

---

## 1. The VPS (the independent intermediary's machine)

One small EU VPS (Ubuntu 24) carries an entire feedback project;
hundreds of participants per machine. Installed: Docker + Compose. At
host level: a nightly restic backup (encrypted at the source, stored
with a second provider, dead-man switch via a health-check ping) and
unattended security upgrades. Everything else runs as containers behind
Caddy:

| Service | Role |
|---|---|
| Caddy | TLS termination, only public ports; also serves the static activation page and the canopy-chat web bundle |
| Activation service | amnesic onboarding of participants (§1.2) |
| CSS (Community Solid Server, pinned to 7.1.9) | individual pods + the central project pod |
| Channel service: canopy-chat | web and app client; the agent runs on the participant's device |
| Channel service: TG bot multiplexer | optional, per project (§1.3) |
| Aggregation service | scheduled jobs over the central project pod (§1.5) |
| privatemode-proxy | encryption + attestation toward the TEE LLM; image pinned by hash |

Operations: the company manages the machine (updates, monitoring,
backups, recovery procedure — see RUNBOOK, incl. monthly check and
quarterly tested restore). The company **cannot read participants'
private content** (encrypted client-side); it **can** read the central
project pod — by design, since that content has been deliberately
handed over.

### 1.1 Individual pods

**What it is.** One pod per participant on the shared CSS (path-based:
`pods.<domain>/<pseudonym>/`). Open registration is disabled; pods are
created only through activation. Modest quota (feedback is text).
Private resources are encrypted on the participant's device before they
reach the pod: the ACL is the doorman (distribution), the encryption is
the sealed envelope (readability). The pod belongs to the participant:
exportable, claimable, and it can outlive the project if the
participant wishes.

**Browser keys (core v1 design decision).** The activation page is
static and open source. Client-side code (WebCrypto in the browser, or
the SDK vault in the app) generates a high-entropy secret plus a key
pair on the participant's device. The participant stores it
(print/download); only `hash(secret)` and the public key are sent to
the server. Consequence: the intermediary has **never possessed** the
owner keys — there is nothing to seize, leak, or "provably delete".

**To develop:**
- Activation page with client-side key generation, printable/
  downloadable recovery code, and clear "we do not store this" copy
- Per-resource client-side encryption driven by the ACL (public =
  plaintext, private = encrypted); key sharing via CapabilityToken
- Claim flow: present the preimage → hash match → ownership formally
  transferred to the participant (set own password/WebID)
- Quota notification flow via the channel (warn at 80% / 95%, refuse
  writes at 100%; the local-first device cache absorbs the overflow)
- Exit flow with four choices at project end: keep the pod (free or
  for a small fee) / claim and optionally migrate (the pod address
  changes with migration — state this honestly) / download everything
  (zip) / delete everything
- One-click export, always available, free

### 1.2 Amnesic activation service

**What it is.** One small service that sets a participant up and then
remembers nothing about them. Input: activation code (+ bot token if
the TG channel is chosen). Actions: validate the code → seed the pod
(CSS `--seedConfig` mechanism) → create a pseudonymous container plus
write/delete ACL in the central project pod → inject the channel
configuration (runtime config; **one image for everyone**, never an
image per participant — that buys N× build/patch/registry burden, and
secrets baked into image layers are *worse* protected, while gaining
zero confidentiality). It retains only: spent codes, and recovery-code
hashes next to pod references. No names, no e-mail, no identity
register, no credential vault.

**To develop:**
- The service itself (validate, seed, ACL setup, config injection,
  code retirement)
- A cohort CLI for the company: create a project, generate N codes
  with expiry/ceiling, set duration and closing date
- Anti-abuse measures: single-use codes, cohort ceiling, expiry, one
  activation per channel identity

### 1.3 Channel service — canopy-chat (default) and TG bot (optional)

**canopy-chat (default).** The existing canopy-chat client, on web and
app: the agent runs on the participant's device, login via Solid-OIDC
(standard CSS). Redaction proposals and approval are orchestrated
client-side (§2); raw text leaves the device only encrypted toward the
TEE. The curation interface is largely implemented in the repository
already.

**TG bot (optional, enabled per project).** Verified fact: bot
conversations on Telegram are never end-to-end encrypted (bots cannot
operate in secret chats; Telegram holds the keys). Hard to abuse in
practice, but insufficient for whistleblower- or care-grade projects —
so: offer it honestly labelled where it fits, omit it where it does
not. Design: **each participant creates their own bot** (via BotFather,
inside Telegram itself) and supplies the token at activation. This
means: no bot-count limit on our side, the bot is the participant's
property (they can revoke *our* access), and no central identity
register — only per-instance configuration (token ↔ pod). The bot
locks onto the first chat account that presents the activation code
(storing a hash of the chat ID, never the raw number). Instruction-page
advice: choose a neutral bot name (bot usernames are publicly
searchable).

**To develop:**
- Bot multiplexer: one service, N tokens, webhook mode via Caddy
- Bot button menu: my contributions / withdraw / download everything /
  claim my pod / pause me / delete everything — the same flows as
  canopy-chat, different surface (projector principle: build once, two
  adapters)
- BotFather instruction page with screenshots + token validation
  (`getMe`) in the activation flow
- Honest labelling copy ("via Telegram, Telegram can read along") in
  the terms and the activation UI

### 1.4 Central project pod

**What it is.** One pod per project on the same CSS. Each participant
gets a pseudonymous container with **write and delete rights for that
participant only**. Consent is the write action: whatever is in this
pod has, by definition, been handed over. Withdrawing before release =
deleting your own contribution — no counter or helpdesk required. The
aggregation service reads **only** this pod and has no access of any
kind to individual pods.

**To develop:**
- Contribution schema (text format): structure of an approved point
  (id, text, theme tags, time window — no identity)
- Two-layer validation: the agent/bot validates before sending; the
  central side validates defensively (a shape-validator component
  exists for CSS)
- Consent/status log inside the pods (own pod + central container):
  submitted / included in report / withdrawn
- Report manifest: per report, the included contribution IDs, so that
  "withdraw before release" is verifiable

### 1.5 Aggregation service

**What it is.** Scheduled jobs (no daemon holding keys): read the
central pod → de-duplicate, cluster by theme, check anonymity
thresholds → have summary/analysis produced via the LLM route (§2) →
write a draft report to the curator workspace (a container in the
project pod, displayed by the existing curation interface). Human
researchers (curation) release; the commissioning organisation only
ever sees the released report.

**To develop:**
- The jobs themselves (read, de-duplicate, cluster, summarise via §2,
  write the draft)
- Anonymity threshold: include a point only when ≥ k contributors
  raised it, or rephrase until it is not traceable — threshold
  configurable per project (design decision)
- Curator workspace: container + status fields, reusing the curation
  interface

### 1.6 Participant activation flow (end-to-end)

1. The commissioning organisation distributes activation codes broadly
   through an independent route (poster, intranet link) — it never sees
   who activates, at most a counter later.
2. The participant opens the activation page → the device generates
   the secret + keys → recovery code is printed/downloaded.
3. Channel choice: canopy-chat (default) or own TG bot (BotFather
   steps, paste token, `getMe` check, honest label).
4. Activation service: retire the code → seed the pod → container +
   ACL in the central pod → inject configuration. The service forgets
   the rest.
5. First message; the pipeline is live. At project end: the exit flow
   with four choices (§1.1).

---

## 2. The LLM service

**Which one, and why: Privatemode** (Edgeless Systems, Germany). TEE
inference: the model runs inside hardware-encrypted enclaves
(confidential computing), and the local `privatemode-proxy` in our
compose stack encrypts every request and verifies the **attestation**
per request (cryptographic proof of what is running) — the operator
*cannot* look in, and that property is verifiable rather than promised.
Nothing is stored or used for training. OpenAI-compatible endpoint on
localhost. One API key per project/customer gives usage metering for
free. Prompt caching disabled; proxy image pinned by hash.

**Three routes, one configuration block** (everything speaks the OpenAI
protocol; the privacy level is a `{baseURL, model, apiKey}` block per
deployment):

| Route | Trust mechanism | When |
|---|---|---|
| Privatemode (TEE) | hardware + attestation | default for feedback projects |
| OVH AI Endpoints | contract/policy (zero retention, French) | low-sensitivity work |
| Model within our own walls (already experimented with) | physical possession | a box on the customer's premises; or on our VPS if the customer prefers |

Honest framing for "within our own walls" on the VPS: it shifts trust
to *our* administrator (we could technically see the prompts) — only
the v2 confidential VM makes that path operator-blind as well. On a box
at the customer's premises it is the strongest option: data never
leaves the building. Both flavours are the same configuration block.

**Two LLM tasks in the pipeline:**

1. **Redaction proposal on individual messages.** The LLM produces a
   curated/anonymised proposal over a participant's raw messages: a
   list of the points they raised, ready to go to the central pod after
   approval. Orchestration per channel: *canopy-chat* — the client on
   the participant's device (which holds the keys) calls the proxy
   itself; raw text leaves the device only encrypted toward the
   enclave, the intermediary sees nothing. *TG route* — the bot
   orchestrates (it sees the messages anyway; labelled concession).
   The participant ticks per point: forward / edit / drop.
2. **Analyses + summary on the central pod.** The aggregation service
   sends the (already handed-over) contributions through the same route
   for theme clustering and summarisation; the draft goes to the human
   researchers.

**To develop:**
- The `llm-client` substrate: the configuration block + usage metering
  per project
- Proxy integration + attestation check in the compose stack
- Prompts + output format for task 1 (point list with source
  references) and task 2 (clustering/summary)
- The within-our-own-walls variant as the same configuration block
  (building on the existing experiments)

---

## 3. Operations and responsibilities

| Role | Manages | Sees |
|---|---|---|
| **Participant** | own content, per-point approval, withdrawal, claim, export, exit choice | everything of their own |
| **Commissioning organisation** | distribution of codes; receives the report | never who participates (at most a counter); only the released report |
| **My company (intermediary)** | VPS, updates, backups, SLA, activation service, aggregation jobs | the central pod (deliberately handed over) + TG traffic where that channel was chosen; **not** private pod content, **no** owner keys |
| **Researchers/curation (human)** | final review and release of reports | draft reports + central-pod content |

Operational rituals (see RUNBOOK): a short monthly check
(updates/monitoring/disk), a quarterly *tested* restore (log the date),
a dead-man switch on the backup, an abuse/report address, and a
bus-factor envelope held by a trusted person. Paperwork per project: a
one-page participant terms sheet, a data-processing agreement, and the
contract clause that pods belong to participants (the commissioning
organisation cannot demand deletion of someone else's pod).

---

## 4. Consolidated build order

1. `llm-client` configuration block + connect the Privatemode proxy
   (foundation)
2. Activation service + browser-key page + cohort CLI
3. Central-pod schema + ACL setup + two-layer validation
4. Push flow in the agent: redaction proposal (task 1) → approval list
   → write to the central pod; consent/status log
5. Aggregation jobs (task 2) + report manifest + curator coupling
6. Quota, exit, and export flows
7. Optional per project: TG multiplexer + button menu + instruction page
8. Paperwork (terms, DPA, contract clause, labelling copy)

## 5. Deliberately parked (v2)

- **Confidential VM for the entire intermediary column**: EU bare metal
  with AMD SEV-SNP / Intel SGX plus an attestation stack — then the
  *processing itself* (including a within-our-walls LLM) becomes
  invisible to administrator and hoster alike. Significant engineering;
  a strong candidate for public funding (NGI).
- **Peer backup between customer-premises boxes** over the project's
  own agent network.
- Subdomain-per-pod, chunked encryption for video streaming.
