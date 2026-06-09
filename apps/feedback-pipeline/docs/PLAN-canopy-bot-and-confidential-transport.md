# Implementation plan — canopy bot contact + confidential LLM transport

Turns `MENUKAART.md` §6 into a sequenced build. Scope: make the feedback bot a **contact** in
canopy (the signed, on-device channel), and let it use a **heavy remote model with no host seeing
plaintext** (confidential transport, Option B). Grounded in interfaces verified against the code
2026-06-09; see "Ground truth" below.

**Principle carried throughout (`[[feedback-agent-is-just-a-user]]`):** a bot contact and a
human-device contact are the **same mechanism** — an agent you message and receive from, presented
to the user as a contact. The bot side just auto-replies via the dispatcher. `CanopyChatBot`
consumes one `{onMessage, sendReply}` **contract**, so the placement decision is just *which thin
bridge sits under it* — the user-facing "I chat with a contact" is identical either way:

- **Local (signed tier) → `InternalBusBridge`.** The bot is a co-hosted agent on the participant's
  shared `InternalBus` (the topology canopy-chat already runs for its app agents). Raw **never
  leaves the device**, works offline, instant.
- **External (unsigned tier) → `PeerBridge`.** A standalone agent reached over the secure-agent peer
  transport (NKN / relay / WebRTC — `sa.peer`'s concern, not ours).

**Ownership boundary.** Every LLM role (clean, label, summarize, translate, intent, aggregation) and
the `llm.route` config live in **feedback-pipeline**. canopy-chat is only the contact/transport
shell — it hosts the bot agent on its `InternalBus` and renders the DM; it never configures or calls
an LLM. So the bot configures its own route from the project config at startup; the existing
canopy-chat-side injection (`feedbackSurface.js` → `setLlmRoute`) moves out (`[[canopy-chat-unifier-principle]]`).

---

## Ground truth (verified interfaces — the plan leans on these)

- **Bridge contract** (what `CanopyChatBot` consumes): `{ onMessage(handler), sendReply({chatId,
  text, buttons}), start(), stop() }`. The handler receives `{bridgeId, chatId, messageId, text,
  isAddressed, sender:{bridgeUid, displayName}}`. Satisfied today by `@canopy/chat-agent`'s
  `InMemoryBridge` and `TelegramBridge` (`packages/chat-agent/src/bridges/`).
- **The bot multiplexer already exists**: `src/channel/canopy-chat-bot.js` — `new CanopyChatBot({
  bridge, pod, config, participantFor, identityFor })`. `identityFor(chatId)` returns the
  participant's own signing keypair ⇒ contributions are **signed**. Proven against `InMemoryBridge`
  in `scripts/canopy-chat-smoke.js`. **The only missing piece is a real bridge (in-process for local, peer for external).**
- **InternalBus / co-hosted agents** (`apps/canopy-chat/src/core/agent/realAgent.js:74,107`): canopy-chat
  already boots in-process Agents on a shared `InternalBus` (host + chat), reached by in-process
  `invoke` with **no network**. A local bot is "one more co-hosted agent" on that bus — the basis for
  `InternalBusBridge`. The network `transportMode` ('nkn' | 'relay' | 'both') is a *separate* layer,
  only for remote peers — the basis for `PeerBridge`.
- **secure-agent peer API** (`packages/secure-agent/src/createSecureAgent.js`): `sa.peer.sendTo(addr,
  payload) → Promise`, and inbound via `onPeerMessage({from, payload, ts})` (set through factory
  opts, `connect({onPeerMessage})`, or `setPeerMessageHandler`). Transport chosen by `transportMode`.
- **Dispatcher** (`src/channel/dispatcher.js`): `handleMessage(raw)` (floor → route → receipt),
  `review()` (Task-1 dedup → point list), `consent(ids)` (signs + writes to the central pod;
  refuses gracefully if `privacy.verify` and no identity), `command(action,arg)`. Reached from text
  via `channel/actions.js` + `channel/intent.js`.
- **LLM route** (`src/ollama.js`): `applyLlmRoute(config.llm)` (Node) / `setLlmRoute(route)`
  (browser, used by `apps/canopy-chat/src/feedback/feedbackSurface.js`). `privatemode` →
  `PRIVATEMODE_PROXY_URL` default `http://localhost:8080/v1`. **Guardrail target = `applyLlmRoute`,
  lines ~35–42.**

---

## Two LLM call sites, different valid routes

The pipeline calls the LLM at two points, and they have different trust requirements — Phase 0
enforces the split.

- **Per-participant clean** (Task 1: `dispatcher.review()` → `runTask1()` → `chat()`) runs **on the
  participant's device**, on **raw, pre-consent** input. Only `local` or `privatemode`-to-an-enclave
  is valid here (`MENUKAART.md` §4D).
- **Aggregation** (Task 2, controller/enclave) runs on **already-sealed** data where the controller
  legitimately decrypts; a controller-co-located privatemode proxy is fine here (`ollama.js:27–30`).
  That route must **not** be applied to the clean call site.

Today the web surface sets its clean route from `VITE_FEEDBACK_LLM_BASEURL` (`feedbackSurface.js` →
`setLlmRoute`; `web/main.js:2091`). If that base is an ordinary remote host, the per-participant raw
clean is sent to a host that sees plaintext — the gap the confidential transport closes. Phase 0
constrains it; Phase 2 fixes it properly.

---

## Phase 0 — guardrails + the two-call-site split *(cheap; do first)*

No new surface; it makes the safe path the default and prevents a silent plaintext leak.

1. **`applyLlmRoute` guardrail** (`src/ollama.js`): when `llm.route === 'privatemode'`, **refuse a
   non-loopback `PRIVATEMODE_PROXY_URL`** unless an attestation-verification config is present
   (the Option-B gateway, Phase 2). Loopback (`127.0.0.1` / `localhost`) stays allowed (client-side
   proxy). Turns the footgun into a startup error.
2. **Move route config into the bot + constrain the clean call site**: the feedback-pipeline bot
   resolves its own route from the project config at startup (not canopy-chat). Validate the
   **per-participant clean** route is `local` or an attested `privatemode` — never a plain remote
   base (a plain remote base is for the aggregation/eval path only). Retire the canopy-chat-side
   `setLlmRoute` injection (`feedbackSurface.js` / `VITE_FEEDBACK_LLM_BASEURL`) so the check lives in
   one place.
3. **Docs note in `ollama.js`**: annotate the two call sites so the existing "proxy on the
   controller's box" comment is scoped to aggregation.

**Verify:** vitest — `applyLlmRoute` throws on `{route:'privatemode', baseURL:'https://remote/…'}`
without attestation, passes on loopback; the clean-path resolver rejects a plain remote base.

## Phase 1 — canopy-chat as a bot contact *(the channel; biggest unlock)*

Two thin bridges, **both** satisfying the `{onMessage, sendReply}` contract `CanopyChatBot` already
consumes — so `CanopyChatBot`, the dispatcher, and the participant UX are identical across them.

1a. **`src/channel/internal-bus-bridge.js` — `InternalBusBridge` (local, signed; the default).** The
   bot is a co-hosted agent on the participant's shared `InternalBus` (the `realAgent.js` topology).
   `onMessage(h)` ← inbound `invoke`s on the bot agent; `sendReply({chatId, text, buttons})` → reply
   on the bus to `chatId` (the participant agent's in-process address). **Raw never leaves the
   device.** No `transportMode`, no network.
1b. **`src/channel/peer-bridge.js` — `PeerBridge` (external, unsigned).** Over `sa.peer`:
   - `onMessage(h)` → register `onPeerMessage(({from, payload}) => h({chatId: from, messageId:
     payload.id ?? stamp, text: payload.body, isAddressed: true, sender:{bridgeUid: from,
     displayName: payload.senderDisplay}}))`.
   - `sendReply({chatId, text, buttons})` → `sa.peer.sendTo(chatId, {body: text, buttons})`.
   - `start()/stop()` → connect/disconnect (or no-op when the host owns the agent lifecycle).
   - Transport (relay / NKN / …) is chosen by `sa` (`transportMode`), not by the bridge.
2. **Bot entry point** `scripts/canopy-bot.js` — the canopy analog of `apps/household/scripts/
   tg-freetext.js`. Two run modes from one file, differing only in the bridge + identity:
   - **local** — co-host the bot agent on the participant's `InternalBus`, `InternalBusBridge`,
     `identityFor` = the participant's vault key ⇒ **signed**.
   - **external** — a standalone secure-agent for the bot's WebID, `PeerBridge`, `identityFor`
     omitted ⇒ **unsigned**, server-run.
   Either way: `new CanopyChatBot({ bridge, pod, config, identityFor })` and `start()`.
3. **Participant-side add-a-contact** (`apps/canopy-chat/src/feedback/`): surface the bot's WebID
   from the project invite/QR and open a DM via the existing `/dm`/DM-thread machinery. Bot replies
   render as ordinary inbound DMs — minimal new code (the receive path already exists).
4. **canopy-chat wiring** (`feedbackSurface.js`): provide the `InternalBus`, the vault signing
   identity, and (external) the peer transport to the bot — but **not** the LLM route, which the bot
   owns (see Phase 0.2).

**Verify:** vitest, **both bridges**, each driving the same journey as `canopy-chat-smoke.js`
(message → "klaar" → "verstuur alles") through `CanopyChatBot`:
- `InternalBusBridge` over a real shared `InternalBus` (two co-hosted agents) — assert the
  contribution is **signed** (`identityFor` set) and the bot↔participant traffic never touches a
  network transport.
- `PeerBridge` over a `FakePeerTransport` (records `sendTo`, injects inbound) — assert **unsigned**
  and gracefully refused under `privacy.verify` when `identityFor` is omitted.
Then a user-run web smoke: add the bot, send a message, see the receipt + review + consent
round-trip. *(Web first, then mobile — `[[feedback-web-first-then-mobile]]`.)*

## Phase 2 — confidential transport, Option B *(enclave gateway)*

Lets the on-device bot use a heavy remote model with the host blind. Spec in
`CONFIDENTIAL-LLM-TRANSPORT.md`.

1. **Gateway enclave image** — the Privatemode proxy (or equivalent) packaged to run inside a CVM
   (AMD SEV-SNP / NVIDIA H100 CC).
2. **Client-side attestation + key pinning** — the phone/app verifies the gateway's quote itself and
   pins the expected measurement (no trusting the server to vouch for itself).
3. **Route it** — point the clean-step `privatemode` route at the attested gateway; lift the
   Phase-0 loopback-only constraint *for that attested URL* (the guardrail now passes because
   attestation config is present).

**Verify:** attestation handshake unit test (good quote passes, tampered quote fails); end-to-end
clean through the gateway with the host process unable to read request bodies. **Reuses the Phase-3
attestation plumbing** — sequence 2 and 3 to share it.

## Phase 3 — Phase-2 enclave aggregation *(symmetric endgame)*

`aggregation.location: 'enclave'` — the project key lives only inside an attested CVM; the host
feeds ciphertext, the enclave opens + aggregates + calls Privatemode enclave-to-enclave and emits
only the aggregate + a quote. Code is already shaped: `tee/aggregate.js#runSealedAggregation`
(`SECURITY-MODEL.md` §6). Change = key custody + where the function runs, not the flow.

**Verify:** the existing `phase1-smoke` analog with a real attested release; quote verified before
the aggregate is trusted.

---

## Deferred / parked

- **Group-chat bot participation** ⬜ — threads are event-filters, not rosters; "agent-as-participant"
  is undesigned (canopy v2 board 4B). Feedback is 1:1 → DM-first; revisit on demand.
- **Confidential transport Option A** (on-phone proxy) 🅿️ — research after B is running.
- **Graduating `ollama.js` → `@canopy/llm-client`** 🅿️ — the route layer already does privatemode +
  throttle + retries; later cleanup (`[[llm-pluggability-deferred]]`).

## Suggested sequencing

Phase 0 (a day; unblocks safety) → Phase 1 (the channel; ship web, then mobile) → Phases 2 + 3
together (shared attestation). Each phase is independently shippable and testable.
