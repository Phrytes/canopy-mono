# Manual test — household bot on phone + laptop

How to drive the **household** circle bot on a laptop (web) and a phone (mobile) with a
live LLM. Household only here; the feedback whole-pipe (private pod + central pod +
Privatemode) is a separate runbook.

---

## ⚠️ Read first — what syncs across the two devices, and what doesn't

The in-process household (what the circle bot dispatches to) keeps its items in a
**per-device in-memory store** (`new HouseholdStore()` in `realAgent.js`). So:

- **Does NOT sync across devices (yet):** the household *list state*. "Add milk" on the
  phone will **not** appear on the laptop's list — each device has its own household.
  Bot replies are also local (they don't fan out). Shared household state needs a
  pod-backed store, which isn't wired for the in-process household.
- **Does sync across devices:** the **peer transport** — user kring chat messages, DMs,
  presence/contacts. That's the cross-device thing you can actually verify here.

So this test is really two things: **(A) the household bot works on each form factor
with a live LLM** (the main event), and **(B) the two devices are peer-connected** (chat
reaches the other side). Don't expect a shared shopping list — that's a known gap (see
REMAINING-WORK "🔬 Research §4/pod-backed household").

---

## 0. Prerequisites (laptop)

```bash
# A running model. Qwen2.5 is the validated default; you also have mistral / phi4-mini / llama3.2.
ollama serve                 # (or it's already running)
ollama pull qwen2.5:7b-instruct
ollama list                  # confirm it's there
```

---

## 1. Laptop — the web app (production v2 circle)

```bash
cd apps/basis
VITE_CIRCLE_LLM_BASEURL=http://127.0.0.1:11434 \
VITE_CIRCLE_LLM_MODEL=qwen2.5:7b-instruct \
  npm run dev
# open the printed URL (e.g. http://localhost:5173) → this serves index.html → circleApp.js (the v2 app)
```

- Open a circle, make sure **household** is enabled for it (circle settings → apps).
- The bot is addressed by name — type **`@assistant …`** (or tap inline buttons).
- *(Optional — semantic RAG)* add `VITE_CIRCLE_EMBED_BASEURL=…` `VITE_CIRCLE_EMBED_MODEL=…`
  to point F-retrieve at an embeddings route (Privatemode enclave, or an Ollama with an
  embed model pulled). Without it, retrieval is keyword-based (fine).

## 2. Phone — the mobile app

The phone needs to reach **an** LLM endpoint. Easiest paths:

- **USB (simplest):** `adb reverse tcp:11434 tcp:11434` — now the phone's `localhost:11434`
  hits the laptop's Ollama. Use `EXPO_PUBLIC_CIRCLE_LLM_BASEURL=http://127.0.0.1:11434`.
- **Same Wi-Fi:** start Ollama as `OLLAMA_HOST=0.0.0.0 ollama serve`, then point the phone at
  the laptop's LAN IP: `EXPO_PUBLIC_CIRCLE_LLM_BASEURL=http://<laptop-LAN-ip>:11434`.

```bash
cd apps/basis-mobile
EXPO_PUBLIC_CIRCLE_LLM_BASEURL=http://127.0.0.1:11434 \
EXPO_PUBLIC_CIRCLE_LLM_MODEL=qwen2.5:7b-instruct \
  npm run android        # (or `npm start` for the Expo dev menu)
```

(*Optional semantic RAG:* `EXPO_PUBLIC_CIRCLE_EMBED_BASEURL=…` `_MODEL=…`.)

## 3. The peer transport (phone ↔ laptop)

The v2 app connects peers over **NKN** (the `nkn-sdk` loads at boot — no relay server to
run; NKN is a public network, works cross-network). On boot you should see in the console:
`[circleApp] NKN peer transport connected`. Both devices online ⇒ peer-connected.

> "Through relay" specifically (`agent.relay.connect`, your own `startRelay` broker on
> `:8787`) currently lives in the **classic** shell (`web/main.js` → `classic.html`), not
> the v2 production app. For this household test the NKN path is the simpler one; flag it
> if you specifically need the relay broker and I'll wire/verify a v2 relay connect.

---

## 4. Test script — household bot, per device

Run this on the **laptop**, then again on the **phone** (each has its own list):

| You type (after `@assistant`) | Expect | Tests |
|---|---|---|
| `add bread to the shopping list` | item added (a bubble + the list shows it) | gate "add" + addItem + structured render |
| *(tap the list / `@assistant what's on my list?`)* | a structured list with `[Done]` buttons | listOpen + adaptHouseholdReply + buttons |
| tap **`[Done]`** on an item | item completes | inline-button dispatch |
| `done bread` | bread completes | the deterministic gate (works even with the LLM off) |
| `/grab <task>` or tap **`[I'll do this]`** | task claimed | the renamed claim |
| `what do I still need to get?` | the assistant answers (free-text → LLM) | the live LLM tool-pick |

**Basic-mode check (the new indicator):** stop Ollama (or start the app with a wrong
`*_LLM_BASEURL`), then type a free-text question like `@assistant what should I buy?` →
the bot replies *"💬 I can do buttons and quick commands right now … chatting in your own
words isn't available at the moment."* Buttons + `/done` still work.

**Cross-device check (B):** type a **plain** message (no `@assistant`, not a command) in
the kring on one device → it should appear in the other device's kring (peer transport).

---

## 5. Known issues to watch for (from the live-LLM harness run, Qwen2.5-7B)

These are expected; logged in REMAINING-WORK "🧪 LIVE-LLM household run":
- **`add X to the shopping list` may add a *task*, not a shopping item**, and drop the
  "to the shopping list" qualifier (gate grammar gap — fix queued).
- **`I got the bread` / `I'll do the vacuuming` may do nothing** (`llm-nomatch`) — 7B is
  weak at mapping completion/claim phrasings to tools. Use `[Done]` / `/done` / `/grab`.
- Free-text list may pass a junk arg (`listOpen({type:"text"})`) — harmless (lists all).

If the bot feels weak on free text, try another pulled model:
`OLLAMA_MODEL=mistral:7b-instruct` (or `phi4-mini`, `llama3.2`) — re-run with that env, or
re-run the headless harness:
`LIVE_LLM=1 OLLAMA_MODEL=<model> npx vitest run test/live/householdPipeline.live.test.js`.
