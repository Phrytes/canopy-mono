# Household circle with an LLM assistant — journeys, architecture, token heuristics

A household runs a shared circle (chat + tasks + lists + calendar) with a **bot** wired to an LLM —
either a **local** model (e.g. a laptop on the home network) or **Privatemode via a proxy** the
household configures. Builds on the general "circle interprets free text via LLM → dispatch"
capability in `V2-LLM-IN-CIRCLE.md`; this doc is the household-specific shape + the interaction model.

## The shape (one paragraph)
A **household = a circle bound to a household Solid pod** (shared; stores chat, tasks, lists,
calendar, and the circle's config). Members **join the circle** (invite/QR) and need **no pod of
their own** — the household is a trust unit, so members write to the **household pod** via the
circle. A **bot is an agent member** of the circle, reachable over whatever transport the interface
uses (mDNS/loopback on the home network, NKN/relay, or a Telegram bridge). Interaction (phase 1):
in the group chat you **tag the bot** to route a message to its LLM → NL→slash interpret → dispatch
against the household apps → the result is posted back in the chat.

Who holds what: **household pod = shared store**; **members = circle members (no pod required)**;
**bot = agent member + the LLM route**. (Contrast the feedback app, where each *participant* has
their own BYO pod because they're mutually private — a household is not.)

---

## User journeys

### Journey A — Local LLM, mobile app + mDNS (the Jansens, fully in-house)
1. Pieter installs the canopy mobile app, **creates "Huishouden Jansen"** (a circle), and connects
   the **household Solid pod** (self-hosted, or a managed CSS — see business model).
2. In circle settings he sets **`llmTool: local`** and points it at the family laptop running
   **Ollama** — the app **discovers it via mDNS** on the home WiFi (the "Nearby" path,
   `MdnsTransport`), or he types the laptop's `http://192.168.x.x:11434`.
3. His partner + the teens **join via QR**. No pods, no accounts beyond circle membership.
4. In the group chat someone types **"@assistent zet melk op de boodschappen"**. The bot sends that
   turn to the local LLM → it returns `/addtolist boodschappen melk` → the bot dispatches it against
   the list app → **"melk toegevoegd ✓"** appears in the chat, and the list (on the household pod)
   updates for everyone.
5. **Nothing leaves the house** — model, pod, and traffic all stay on the home network.

### Journey B — Privatemode via proxy, Telegram (the De Vries, low-friction + cloud model)
1. They already live in **Telegram**. The organizer adds the **canopy bot to a Telegram group**
   (the proven `@canopy/chat-agent` TelegramBridge household path).
2. Household pod is **managed-hosted by us**. In setup the organizer sets **`llmTool: cloud`** and
   **configures the proxy route**: the bot encrypts each message to the **proxy server** (our
   open-source confidential proxy) → which talks to **Privatemode** (or another model).
3. "**@huisbot wie is er deze week aan de beurt om af te wassen?**" → the bot encrypts the turn →
   proxy → Privatemode → returns `/chores whose-turn dishes` (or a direct answer) → dispatched →
   posted. With the **attested gateway**, neither the proxy host nor we can read the raw message;
   without attestation it's a plain proxy with the host-trust caveat (their choice, configured).

### Journey C — canopy web (same circle, another window)
A member opens the circle on **canopy web** (desktop). Same bot, same household pod, same LLM route —
the web client is just another interface onto the one circle. Useful for the "household admin" who
prefers a keyboard.

---

## What needs to be done (build checklist)

**Already there (reuse):**
- Circle model + the per-circle **`llmTool: off|local|cloud`** policy (`v2/circlePolicy.js`) + the
  **`selectLlmClient(policy, providers)`** picker (`v2/llmPicker.js`, Phase 5.8) + `agent.llmProviders`.
- Household / tasks-v0 / calendar apps **and their slash catalog** (composed in canopy-chat).
- Transports: **mDNS** (`MdnsTransport`), NKN/relay, the **Telegram bridge**.
- The LLM **route layer** (`feedback-pipeline/src/ollama.js`: local / privatemode / base-url) + the
  **confidential transport** (`CONFIDENTIAL-LLM-TRANSPORT.md`, `tee/attestation.js`).
- Household **Solid pod** (CSS) + `@canopy/pod-client`.

**New work:**
1. **Household pod ↔ circle binding** — a circle whose shared store is a household pod (members
   write via the circle; the pod holds chat/tasks/lists/calendar/config). *(Verify how much of the
   circle-backed-by-pod path already exists.)*
2. **Bot as an agent member** of the circle, reachable on the chosen interface (mDNS/loopback,
   NKN/relay, or Telegram). One bot, three front-ends.
3. **The NL→slash interpreter + the @tag router** — the shared capability: a tagged turn → the
   circle's LLM (via `selectLlmClient`) → a slash command from the circle's catalog → dispatch.
4. **Per-circle LLM route config UX** — the circle **starter** sets `llmTool` + the endpoint:
   local URL / mDNS pick, or the **proxy URL** (+ optional attestation pin). Stored on the household
   pod with the circle config.
5. **Route wiring** — local Ollama (mDNS or URL) and the proxy/Privatemode route reuse the route
   layer; the confidential gateway reuses M7.

The interfaces are not equal effort: **Telegram** is the most proven for household; **mobile** adds
mDNS local discovery; **web** is the thinnest. Suggest shipping **one interface end-to-end first**
(Telegram or mobile) on the **local route**, then add the proxy route, then the other interfaces.

---

## Token-minimizing heuristics — "when should the bot act?" (the roadmap you asked about)

The core problem: in a group chat **most messages are human↔human chit-chat, not for the bot.**
Sending everything to the LLM wastes tokens, money, and (for the cloud route) privacy. The answer is
a **cheap gate under the expensive LLM** — the *same principle as the feedback app's deterministic
floor under the model.* Tiered, each tier opt-in:

- **Tier 0 — explicit tag (now).** Only `@bot` turns reach the LLM. Zero waste, zero ambiguity. Ship this.
- **Tier 1 — tag + bounded context.** When tagged, include the **last N turns** (or turns since the
  bot's last action) so "@bot do that" resolves. Cap N **and** a token budget; send only *new*
  context and keep a **rolling summary** on the pod for older history.
- **Tier 2 — cheap deterministic gate (no LLM), opt-in auto-act.** A rule pre-filter flags candidate
  turns even without a tag, and only candidates reach the LLM:
  - **trigger lexicons** — task/command verbs ("zet op de lijst", "herinner", "wie is aan de beurt",
    "plan", "voeg toe", "boodschappen"…). *(Literally the feedback-floor pattern.)*
  - **shape** — imperatives + questions are far more actionable than statements.
  - **direct address** — the assistant's name / second-person without an explicit `@`.
- **Tier 3 — cheap *learned* gate (local).** A tiny **local classifier or embedding-similarity**
  gate: embed the turn, compare to "actionable-intent" prototypes, call the big LLM **only** above a
  threshold. Local embeddings are cheap (`qwen3-embedding` via Privatemode, or a tiny on-device
  embedder). **Two-tier: cheap local gate → expensive interpret** — the heart of cost control.

**Cross-cutting controls (apply at every tier):**
- **Run the GATE locally even when the heavy LLM is the cloud proxy** — so most traffic never leaves
  the house and costs nothing; only gated candidates hit the paid/remote model.
- **Cooldown / debounce** — the bot doesn't act on every message; rate-limit + collapse bursts.
- **Conversation scoping** — only consider turns since the bot's last action / within an active
  exchange, not the whole log.
- **Confidence threshold → confirm, don't guess** — if the gate is unsure, the bot asks "bedoel je
  X?" (cheap) rather than firing a wrong action.
- **Context as a rolling summary** — store a short summary on the pod; send summary + new turns, not
  the raw backlog.

Net: **Tier 0 ships now**; Tiers 1–3 are progressively smarter auto-action, but the invariant is
*a cheap (ideally local, ideally deterministic) gate decides whether to spend an LLM call* — never
"send everything."

---

## Business-model fit (noted)
The architecture is naturally a **hosted-services** play, and the privacy story is the selling point:
- **Managed Solid pods** — household pod hosting (the shared store).
- **The open-source confidential proxy / LLM gateway** — a hosted service (the `cloud` route);
  attested = "we host it but can't read it," which is the differentiator vs. a plain cloud LLM.
- **Other hosted apps** on the same pod/circle substrate.
The **local route stays free + fully private** (their own laptop) — so the paid hosted proxy is the
*convenience+capability* upsell for households without a capable local machine, not a privacy
downgrade (because attested).
