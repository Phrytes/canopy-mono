# Plan for tomorrow — Telegram bot → pod (raw + cleaned), reusing household code

**Goal.** Put the 3-step pipeline (`src/pipeline.js`) behind a Telegram bot.
Each inbound message is stored in a Solid pod **twice** — the raw original and
the cleaned/anonymized version — by **reusing** existing canopy-mono substrates,
not forking them. This is **step 2 ("Inname van ruwe berichten") + step 3
("Lokale filtering")** of the feedback pipeline in
[`commerciele_verkenning.md`](../../../Project%20Files/Aanpak/commerciele_verkenning.md).

**Privacy invariant (from the design):** the raw message is visible *only to the
user*; the cleaned version is what's *prepared for* later aggregation. Nothing
aggregates without the user's explicit review (step 4, "co-redactie") — out of
scope tomorrow but the storage layout must not preclude it.

---

## Reuse map (verified against the repo)

### 1. Telegram ingestion — `@canopy/chat-agent`
```js
import { TelegramBridge } from '@canopy/chat-agent/bridges/telegram';

const bridge = new TelegramBridge({ botToken: process.env.FP_TG_BOT_TOKEN, mode: 'long-polling' });
bridge.onMessage(async (msg) => {            // msg: { chatId, messageId, text, sender, ... }
  await handleInbound(msg);                  // our pipeline + pod writes
  return { replies: [{ text: '✓ opgeslagen en gefilterd.' }] };
});
await bridge.start();
```
- Token from **env**, never pod-backed (household convention).
- Reference scripts to copy from: `apps/household/scripts/tg-smoke.js`,
  `tg-pod-smoke.js`, `tg-freetext.js`.
- Addressed-only filter (DMs / `@bot` / reply-to-bot) is built into the bridge.

### 2. Pod storage (raw + cleaned) — `@canopy/pod-client`
```js
import { PodClient } from '@canopy/pod-client';
const pod = new PodClient({ podRoot, auth });

const ts = stampFromMessage(msg);            // pass time in; avoid Date.now() in pure code
await pod.write(`/messages/raw/${ts}.json`,     { text: msg.text, sender, ts }, { contentType: 'application/json' });
await pod.write(`/messages/cleaned/${ts}.json`, { text: cleaned, hits, model, ts }, { contentType: 'application/json' });
await pod.write(`/messages/meta/${ts}.json`,    { sender, lang, promptVersion }, { contentType: 'application/json' });
const { entries } = await pod.list('/messages/cleaned/');
const { content } = await pod.read(entries[0].uri, { decode: 'json' });
```
- **Dev/test:** use the `FsMockPod` pattern from
  `apps/household/scripts/tg-pod-smoke.js` (same `read/write/list/delete/append`
  API, JSON-file backed) — no real Solid pod needed to demo end-to-end.
- URI convention mirrors `apps/household/src/pods/HouseholdPod.js`
  (`<pod>/<area>/<ts>.json`). Keep `raw/`, `cleaned/`, `meta/` as separate
  containers so a future ACL can expose `cleaned/` to aggregation while `raw/`
  stays user-only.

### 3. The pipeline — already built here
```js
import { cleanMessage } from '../src/pipeline.js';
const { raw, redacted, hits, cleaned } = await cleanMessage('qwen2.5:7b-instruct', msg.text);
```
Tomorrow's only LLM change: optionally swap `src/ollama.js` for
`@canopy/llm-client` (`LlmClient.invoke({ system, messages })` — no `tools` →
`result.replyText`) so the app shares the substrate's audit hook + provider
gating. Keep the local client as the zero-dependency fallback.

### 4. Identity / pod provisioning — `apps/household/src/identity/`
- `BotIdentity` (wraps `@canopy/core` `AgentIdentity`; vault-namespaced keypair).
- `mintAdminCap()` / `PodCapabilityToken` for the bot→user pod capability.
- **Start in-memory/mock**; a real Solid pod + OIDC/capability auth is V2
  (household README flags production pod writes as future). Don't block tomorrow
  on real-pod auth.

### 5. Config / settings
- `FP_TG_BOT_TOKEN` (device-local secret, env only).
- `OLLAMA_URL` / model env vars (already used by `src/ollama.js`).
- Pod root + persist path: copy household's `HOUSEHOLD_POD_PERSIST` /
  `*_POD_ROOT` env pattern.

---

## Build order (tomorrow)

1. `src/bot.js` — wire `TelegramBridge.onMessage` → `cleanMessage()` → two pod
   writes (raw + cleaned) → reply with a short confirmation (+ the cleaned text
   so the user sees what was filtered).
2. `src/store.js` — thin wrapper over `PodClient` (or `FsMockPod` in dev) with
   `saveRaw / saveCleaned / saveMeta / listCleaned`. ULID or timestamp keys.
3. `scripts/tg-pod-smoke.js` — copy household's, point it at our store + pipeline;
   demo: send a message, assert raw+cleaned land in the (mock) pod.
4. A couple of `node --test` cases for `store.js` against `FsMockPod`.
5. README "Bring it up" + a `/raw`-style command to let the user delete a raw
   message via chat (regie blijft bij de gebruiker).

## Deliberately deferred (later, not tomorrow)

- **Step 4 — co-redactie/review:** cooling-off + "this is what we'll summarize,
  edit anything?" before aggregation. The user is *eindredacteur*.
- **Step 5 — cross-user aggregation:** combine cleaned inputs from many users
  into a separate **aggregation pod**, summarize (`summarize()` already exists),
  then clean again — gated by a **k-anonymity threshold** (N≈4–7): a theme/quote
  surfaces only once ≥N distinct users contributed; below threshold the data is
  dropped, never seen. This is the core "drempel ingebouwd" guarantee and needs
  its own design doc.
- Real Solid pod auth (OIDC / capability) replacing the mock.

## Verification (tomorrow)

- `node --test` green (regex + store).
- `node scripts/tg-pod-smoke.js` end-to-end on a mock pod: message in →
  `raw/<ts>.json` + `cleaned/<ts>.json` written, cleaned text echoed back.
- Live: a real bot token, one DM, confirm both records + the reply.
