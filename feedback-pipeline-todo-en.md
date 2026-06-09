# Feedback pipeline — TODO / what's left to test the whole thing

*Status + roadmap. Companion to the architecture / build-proposal / user-stories /
ethics docs. Updated 2026-06-07.*

## Done 2026-06-07 — privacy & security layers (PR-1 → PR-4 + Phase 1)

Test suite **137 → 216**, nothing skipped; the pre-existing `pseudo-pod-integration` test
fixed by wiring the pnpm workspace (`@canopy/*` resolves). New runnable demos (no external
deps): `npm run secure-smoke`, `byo-tee-smoke`, `phase1-smoke`. Full design write-up in
`apps/feedback-pipeline/docs/SECURITY-MODEL.md`.

- **PR-1 — at-rest sealing** (`pod/project-seal.js`): hybrid sealed-box (AES-256-GCM +
  ephemeral X25519 → HKDF) to the project public key. Host-blind writer (public key only);
  only a private-key holder opens. Wired into `CssCentralPod`/`InMemoryCentralPod` via
  `crypto-config.js`.
- **PR-2 — portal + GUI** (`portal/`, `scripts/portal.js`): the menukaart project store +
  cohort codes + invite links; `npm run portal`.
- **PR-3 — authenticity + handshake + notify + signing**: Ed25519 contributions
  (`pod/signing.js`, wire-compatible with `@canopy/core` `AgentIdentity` — proven by test);
  the **HI handshake** folds a signed identity registration into activation (one code → one
  verified identity, anti-sybil); per-project `IdentityRoster`; **two-way notify**
  (`channel/notify.js`) sealed to the participant; **dispatcher signs** on consent
  (canopy-chat on-device) with a graceful `verification-required` / rollback for the TG
  delegate.
- **PR-4 — pluggable backends + TEE boundary**: the `CentralPod` contract
  (`pod/central-pod-interface.js`); **`ByoCentralPod`** (bring-your-own-pod aggregation,
  verifies across sources); the **TEE aggregation boundary** (`tee/aggregate.js`) — open +
  verify + aggregate inside one function, only the aggregate + attestation leaves.
- **Phase 1 — aggregation placement** (`aggregation/placement.js`): the team's ENFORCED
  trust choice `aggregation.location` = `host` / `controller` / `enclave`; a process declares
  its role via `FP_RUNNER_ROLE` and cannot build an opener it isn't entitled to. Controller-
  side entry `runProjectAggregation` + the Privatemode route bridge (`applyLlmRoute`).
  Phase 2 (decryption inside an attested TEE) is documented as the next step.

## Done & proven (individually)

- **Pipeline brain** — floors (`floorMessage`), Task 1 (`runTask1`, dispatcher), Task 2
  (`aggregate` + k-anon + signal routing + below-threshold), config-driven (`run.js`),
  the `ProjectConfig` "form". Unit + integration tests (mock LLM). (216 tests total now — see "Done 2026-06-07".)
- **LLM route** — OpenAI-compatible config block (local Ollama default; any
  `{baseURL, apiKey}`). Proven against Ollama + a mock server.
- **Central pod** — same interface on three backings: in-memory, real `@canopy/pseudo-pod`,
  and a **live Community Solid Server** (`CssCentralPod`, real DPoP auth).
- **ACP** — per-participant container with **consent-as-write enforced** on live CSS
  (participant write/delete, owner+aggregation read, aggregation read-only, others 403).
- **Activation** — cohort-code lifecycle (single-use, expiry, ceiling, amnesic) + the
  cohort CLI + activation orchestration (`activate.js`, injected provisionPod).
- **Channel** — the `ChannelAdapter` interface + channel-agnostic dispatcher.

## Tier 1 — glue I can build & test in-repo now (no new externals)  ← DONE 2026-06-04

- [x] **`provisionPod`** — `src/activation/provision-css-pod.js`: the activation service
      creates the participant's ACP-locked container in the project pod (via
      `provisionParticipantContainer`) and returns the podRef. Plugs into `activate.js`'s
      injected seam (takes the owner's authed fetch; no auth dependency).
- [x] **End-to-end backbone smoke** — `scripts/e2e-smoke.js` (`npm run e2e-smoke`):
      `cohort → activate (provision ACP container) → dispatcher (floor→clean→points→
      consent) → write to the ACP container with the participant's OWN fetch → aggregation
      reads the central pod (owner fetch) → Task 2 (k-anon themes)`, against the **live CSS**
      + the **mock LLM**. Proven green: 2 participants onboarded, each consent-wrote to their
      own container, **bob→alice's container = 403**, aggregation surfaced "waiting times"
      at k=2. Gated (skips without CSS / `@inrupt/solid-client-authn-core`).
      `CssCentralPod` was refactored to per-participant sub-containers + recursive listing
      so the layout matches the ACP model (each participant owns `central/<them>/`).

## Tier 2 — real surfaces (bigger builds; need substrate/external)

- [x] **Real channel adapter (Telegram)** — `src/channel/telegram-adapter.js`
      (`TelegramChannelAdapter`, `floorsTrust: 'post-receipt'`, pure `renderMessage`) +
      `src/channel/telegram-bot.js` (`TelegramFeedbackBot` multiplexer: one dispatcher per
      chat, routes free text + button callbacks). Decoupled from the substrate via a minimal
      `onMessage`/`sendReply` bridge interface, so the app stays dependency-free. Unit-tested
      against a fake bridge + mock LLM (`test/telegram-channel.test.js`, 5 tests: render
      shapes, post-receipt floor, full round trip message→review→consent→pod→withdraw,
      crisis escalation offer, two-chat isolation). Live smoke `scripts/tg-bot-smoke.js`
      (`npm run tg-bot-smoke`) drives the **real** `@canopy/chat-agent` `TelegramBridge`
      (gated on `FP_TG_BOT_TOKEN`; substrate import + telegraf confirmed to load).
      Dispatcher hardened to `await` async pod ops (correct against `CssCentralPod`).
      All participant-facing prose lives in a single string table per language
      (`src/strings/{index,nl,en}.js`) — the derived-app i18n convention; the channel layer
      calls keys, hardcodes nothing. Locale follows `config.language.preferred`; proven by a
      locale-switch test (nl/en) + an English-project bot test.
- [x] **canopy-chat adapter (pre-send, natural language)** — `src/channel/canopy-chat-adapter.js`
      (`CanopyChatChannelAdapter`, `floorsTrust: 'pre-send'`, floor runs on-device) +
      `src/channel/canopy-chat-bot.js` (`CanopyChatBot` multiplexer) +
      `src/channel/intent.js` (NL intent classifier: deterministic anchored fast-path +
      the app's own LLM route for the ambiguous rest, default = feedback message). Free text
      drives the SAME dispatcher journey as Telegram; button callbacks still work too.
      Shared with Telegram via `src/channel/actions.js` (parseControl + runAction) and
      `src/channel/render.js` (one renderer, both surfaces). Unit-tested
      (`test/canopy-chat.test.js`, 5 tests) + live smoke `scripts/canopy-chat-smoke.js`
      (`npm run canopy-chat-smoke`) proven against the **real** `@canopy/chat-agent`
      `InMemoryBridge`: free-text feedback → "klaar" (review) → "verstuur alles" (consent)
      → 2 contributions in the pod, the intent routing going through the LLM path.
- [x] **canopy-chat app HOSTS the bot** — integrated into `apps/canopy-chat`. canopy-chat's
      free-text path was a dead end ("didn't understand"); now a thread enters feedback mode
      via `/feedback`, and free text is routed to the bot. Pieces:
      `apps/canopy-chat/src/feedback/feedbackSurface.js` (DOM-free surface that hosts the
      `CanopyChatBot`; host injects an `emit` render sink; LLM route injected via `llmRoute`
      since the browser has no env) + thin glue in `web/main.js` (`/feedback` + `/feedback-stop`
      commands, and one line in the `unknown` branch to route free text to the bot before the
      fallback). Made `src/ollama.js` browser-safe + injectable (`setLlmRoute`, env guarded).
      PROVEN: vitest `apps/canopy-chat/test/feedback/feedbackSurface.test.js` (3 tests:
      gated-until-/feedback, full journey message→klaar→verstuur alles→pod, thread isolation)
      AND a full `vite build` succeeds — the browser-safe bot chain (zod/eld/floors/dispatcher)
      bundles with no Node-only leaks. canopy-chat's 2153-test suite still green.
      Follow-ups (noted, not blocking): render the bot's review buttons as click-to-inject
      chips (today canopy-chat uses the natural-language path); wire a real participant pod
      (CssCentralPod + browser DPoP) in place of the in-memory default; surface `/feedback`
      in the command menu/manifest.
- [x] **Curator workspace + transparency counters** — `src/curator/workspace.js`
      (`createCuratorWorkspace({aggregate, pod, reportId})`: review draft → include/drop
      themes, release/hold quarantined items → `release({now})`), `src/curator/transparency.js`
      (counters accounting for ALL input: participants, contributions, themes found/included/
      dropped-by-curator/below-threshold, quarantined, signals, rejected), `src/curator/render.js`
      (localised report). Release is the MECHANISM behind two guarantees: it marks the included
      contributions in the pod (`markIncluded` → withdrawal blocked) and records them in a
      verifiable `manifest` (`withdrawalViolations` stays empty — a contribution withdrawn
      before release can never appear). Threaded contribution `id` through `forAggregation`
      (all 3 pods) + `aggregate` so themes carry `contributionIds`. Curator strings added to
      the `src/strings` table (nl/en). Tests `test/curator.test.js` (5: default-include +
      counters, release→mark+manifest, drop-theme, withdraw-before-release verifiable,
      localised render) + demo `scripts/curator-smoke.js` (`npm run curator-smoke`, self-
      contained). 154 tests pass.
      Follow-up (not blocking): a curator UI surface (host this in an app like the channel
      bots) + wiring `release` to publish/persist the report artifact + route the signals.

## Tier 3 — deployment / ops

- [x] **3a — Activation service** — `src/activation/server.js` (`handleActivate` pure handler
      + `createActivationServer` over `node:http`; `POST /activate {projectId, code,
      recoveryHash, webId}` → ACP-locked container + podRef; outcome mapping 200/400/409/502,
      provision-failure leaves the code unspent/retryable) + runnable
      `scripts/activation-service.js` (file-backed registry + the real `provisionCssPod` with
      the owner's DPoP fetch; gated on CSS/auth/env). Tests `test/activation-server.test.js`
      (5). The provisionCssPod+ACP layer it wraps is already proven live (Tier-1 e2e).
- [x] **3b — Compose stack (infra-as-code)** — `deploy/docker-compose.yml` (css + privatemode-
      proxy + activation + caddy), `deploy/Dockerfile.activation`, `deploy/Caddyfile`,
      `deploy/.env.example`, and `feedback-pipeline-runbook-en.md` (operator sequence).
      `docker compose config` **validates**. (Not a live cloud deploy — no VPS in sandbox.)
- [x] **3c — Real participant-pod wiring (code)** — `src/pod/css-auth.js`
      (`clientCredentialsFetch` server-side DPoP fetch + `makeCssCentralPod` from a browser
      fetch OR credentials) + ACP **writers** role (`containerAcp`/`provisionCssPod` —
      the TG bot service writes on a participant's behalf, post-receipt; canopy-chat
      participants write themselves with browser keys). The surfaces already accept `pod`;
      `scripts/tg-bot-smoke.js` now auto-builds a `CssCentralPod` when pod creds are present;
      activation-service refactored onto the shared helper + `FP_WRITER_WEBIDS`. Tests
      `test/css-wiring.test.js` (3: ACP writers Turtle, makeCssCentralPod writes the
      per-participant container via an injected fetch, TG bot drives a real CssCentralPod
      offline end-to-end). The live path is the Tier-1 e2e/ACP smokes.
      canopy-chat browser-auth wiring is **done**: `apps/canopy-chat/src/feedback/feedbackPod.js`
      (`activateParticipant` → the activation service, `buildFeedbackPod` → a flat
      `CssCentralPod` over the browser session's authenticated fetch, `getOrCreateRecoveryHash`)
      + `main.js` `/feedback <code>` activates with the logged-in pod session (`podAuth`) and
      binds the surface to the real pod (falls back to in-memory when no code/URL). Needed a
      `flat` mode on `CssCentralPod` (participant writes their OWN container directly) +
      `makeCssCentralPod({flat})`. Tests `apps/canopy-chat/test/feedback/feedbackPod.test.js`
      (3) + the surface's pod made lazy/async; full `vite build` bundles it (the Node auth lib
      stays opaque to the browser bundler). Remaining (polish): set `FEEDBACK_ACTIVATION_URL`
      to the deployed service.
- [x] **3d — Privatemode + backups (code)** — Privatemode is config-complete (compose proxy +
      the OpenAI config block); added `scripts/llm-health.js` (`npm run llm-health`) to verify
      the route on bring-up. **Backups: multi-target restic, verified.** `deploy/backup.sh`
      (init → backup → prune → **check**; subcommands `check`/`snapshots`/`restore`; iterates
      every `backup-targets/*.env`, so 2+ providers = redundancy) + `deploy/run-scheduled.sh`
      + a `backup` **compose sidecar** + `backup-targets/{primary,secondary}.env.example`
      (S3 + B2) with a `.gitignore` for real creds. Exercised end-to-end against two local
      restic repos: backup + prune + check (no errors) + **restore from both** targets, data
      identical. Runbook §8 + go-live §8 updated.
      Remaining (polish): an Edgeless account/key, pin the proxy + restic images by `@sha256`,
      set `FP_LLM_BASEURL`/`FP_LLM_APIKEY`, and fill in the real restic target creds.

## Open questions (decide before the relevant launch)

- [ ] **Crisis response protocol — what to DO when a crisis is detected.** Detection is being
      built now (crisis = deterministic lexicon AND LLM agree; high precision). The *response*
      is undesigned: who is notified, on what consent, with what message, how fast, by whom,
      and the duty-to-act vs consent/anonymity tension. Until decided, a detected crisis is
      flagged for human review + the passive 113 resource is shown; no automated outreach.
      See `feedback-pipeline-ethics-deferred-en.md` §1.

## To revisit — docs written 2026-06-07 (security evening)

- [ ] **Re-read `apps/feedback-pipeline/docs/SECURITY-MODEL.md`** — the trust model: the two
      keys (participant identity vs project key), the plaintext-in-RAM map, the enforced
      aggregation **placement** choice (`host` / `controller` / `enclave`), **Phase 1**
      (controller-side decryption + Privatemode — shipped) and **why Phase 2** (the TEE
      endgame) is needed. Sanity-check it against the implemented code before any launch.
- [ ] **Re-read `apps/feedback-pipeline/docs/AGENT-RUNTIME.md`** — the PARKED "runtime browser"
      idea (key-custody wallet + egress firewall + embedded renderer; Tauri desktop, Expo
      mobile). Decide if/when it becomes its own project; see its §7 open decisions.

_(2026-06-09: starting the canopy-bot build plan — `apps/feedback-pipeline/docs/CODING-PLAN-canopy-bot.md`; M0 done, M1 next.)_

## Checkpoints owed (can't be verified headlessly) — canopy-bot build

- [ ] **M6 — Detox / manual device run of the mobile feedback bot.** The mount logic is
      headless-tested (`feedbackMount.test.js`) and `ChatScreen.js` is wired, but the RN screen
      behaviour needs a device/simulator: type `/feedback`, confirm the free-text round-trip
      renders the bot's replies, `/feedback-stop` exits, and (follow-on) the agent contact row.
      Set `EXPO_PUBLIC_FEEDBACK_LLM_BASEURL` to a reachable route first.
- [ ] **M7/M8 — TEE hardware bring-up.** The attestation-VERIFICATION seam is built + tested
      (`src/tee/attestation.js`: `verifyAttestation` / `assertEnclaveAttested` /
      `verifyGatewayAttestation`); what remains needs confidential-computing hardware: a real CVM
      (AMD SEV-SNP / NVIDIA H100), the SEV-SNP/Contrast quote producer + key-release, and (M7) the
      gateway enclave image + the client RA-TLS quote-fetch handshake. Swap `localAttestation()` +
      the quote fetch for the real ones; the gates stay. See `docs/CONFIDENTIAL-LLM-TRANSPORT.md`.
