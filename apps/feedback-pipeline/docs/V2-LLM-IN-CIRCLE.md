# V2 — LLM in a circle (feedback-bot rewire + household NL→slash)

Two asks (2026-06-09) that are the **same capability**: *a circle that interprets free text via an
LLM and dispatches.* The feedback bot is one consumer (NL → feedback dispatcher); the household LLM
is another (NL → household/tasks/list slash commands). Build the general capability once and both
fall out. The seam was pre-built in **Phase 5.8** (`v2/llmPicker.js` + the circle `llmTool` policy
axis), in anticipation of exactly this — so this **un-defers** `[[llm-pluggability-deferred]]`.

---

## Part A — Feedback bot in v2 (the rewire options)

Context (the device-run finding): the bot is wired into `ChatScreen.js`, which v2/SP-13.1 made an
**invisible background peer-router**; the live UX is the circle launcher + circle conversation
(`CircleStreamScreen`/`CircleScreenView`), which post to the kring and don't run slash dispatch. So
the bot is unreachable as wired. Three ways to fix, cheapest→most-native:

### Option 1 — A dedicated "feedback" affordance/entry *(lightest; ~2–3 days)*
A button/entry (in the launcher, or a contacts view) that opens a **feedback-mode conversation** —
a thread whose free text routes to the feedback bot (reusing `feedbackMount` exactly as today). No
change to the kring conversation; feedback lives in its own surface.
- ✅ Small, contained, reuses everything built. ❌ Not "the bot is a member of your circle" — a
  bolt-on surface, less v2-native.

### Option 2 — Feedback bot as an AGENT MEMBER of a circle *(most v2-native; recommended)*
A "feedback circle" where the participant **and the bot (an agent member)** are members. The
participant chats in the normal kring conversation; the bot, as a member, interprets + replies.
This is exactly `[[feedback-agent-is-just-a-user]]` (agents are members, not a special entity) and
the circle-as-building-block model.
- Needs: (a) the bot present as a circle member/agent, (b) the circle conversation routing
  free-text to the bot — **which is the general capability in Part B**. ✅ The right long-term shape;
  ❌ depends on Part B (so do them together).

### Option 3 — General "circle LLM" interprets free text → the feedback intents *(= Part B applied)*
Turn on `llmTool` for the feedback circle; free text → the circle's LLM → the feedback dispatcher's
fixed intent set (message/review/consent/withdraw). Identical machinery to the household case, just
a different "tool list" (feedback intents instead of the slash catalog).

**Recommendation:** do **Part B** (the general capability) and wire feedback as a consumer
(Option 2/3). Until then, **Option 1** is a 2–3 day stop-gap that makes the bot reachable now.

---

## Part B — Household LLM-in-a-circle (NL → slash), effort

**Ask:** a household circle (chat + tasks + lists) with an optional LLM that reads natural language
and runs it as a slash command — backed by a **local** LLM (running within the household) **or** the
**confidential-proxy** route (encrypt → proxy → optionally decrypt → Privatemode / ChatGPT).

### Already built (reuse — this is most of it)
| Piece | Where | Status |
|---|---|---|
| Per-circle LLM toggle `llmTool: off\|local\|cloud` | `v2/circlePolicy.js:18` | ✅ in the policy model |
| The picker `selectLlmClient(policy, providers)` | `v2/llmPicker.js` (Phase 5.8) | ✅ pure selector |
| Provider seam `agent.llmProviders` | `realAgent.js:1902` | ✅ surfaced (no call site yet) |
| Household / tasks-v0 / calendar apps + their **slash catalog** | composed in canopy-chat | ✅ the "tools" |
| LLM route layer (`local` / `privatemode` / base-url) + rate-limit/retries | `feedback-pipeline/src/ollama.js` | ✅ reuse |
| Confidential transport (encrypt → enclave gateway) | `CONFIDENTIAL-LLM-TRANSPORT.md` + `tee/attestation.js` | ✅ seam (M7; attested = hardware-gated) |
| A reference NL→intent classifier | `feedback-pipeline/src/channel/intent.js` | ✅ simpler cousin of NL→slash |

### New work
1. **NL→slash interpreter.** Free text + the circle's available slash commands (from the manifest
   catalog) → the LLM returns the best-matching command + args. The **catalog IS the tool list**
   (function-calling style). ~Medium. Reuses `LlmClient` + the catalog.
2. **Wire it to the circle conversation's free-text call site.** In a circle with `llmTool` on, a
   non-slash turn → interpreter → dispatch (then post the result). ~Small–medium. **This is the
   exact same call site the feedback bot needs** — hence the unification.
3. **Per-circle LLM config UX.** The `llmTool` toggle exists; add the route choice (local vs proxy
   vs cloud) + the endpoint to the circle settings + the provider wiring (`selectLlmClient` →
   `agent.llmProviders`). ~Small–medium.
4. **The routes** (all reuse the existing layer):
   - **local (within the household):** a household-run Ollama. Cheapest, most private; quality
     bounded by the local model (`[[llm-default-qwen25]]` — Dutch tool-calling is weak at small sizes).
   - **confidential-proxy:** the M7 Option-B gateway (raw NL encrypted to an attested enclave, which
     calls Privatemode/etc.). Reuse; the *attested* version is hardware-gated, a *plain* proxy works
     now with the host-trust caveat.
   - **cloud (ChatGPT/other):** trivial route addition (another base URL) — but raw NL to a cloud
     provider unless via the confidential gateway, so gate it behind the policy + a clear warning.

### Effort estimate
- **Local-route version** (interpreter + wiring + per-circle config, local Ollama): **~MEDIUM, ≈1–2
  weeks** for a solid first cut. The plumbing is mostly there; the **variable is model quality** —
  NL→slash reliability on a small local model needs prompt/tooling iteration (a deterministic
  fast-path for common commands + the LLM for the rest, like feedback's `classifyIntent`, helps).
- **Confidential-proxy route:** + the M7 gateway (separately tracked; plain-proxy faster, attested
  hardware-gated). The *route wiring* is small; the *gateway* is the cost.
- **Cloud route:** ~a day of wiring once the interpreter exists.

### The big win
Building this **builds the v2 surface the feedback bot also needs.** Household and feedback become
two consumers of one capability ("circle interprets free text via LLM → dispatch"), differing only
in the tool list (slash catalog vs feedback intents). So the right plan is: **build the general
circle-LLM dispatch (Part B), then wire feedback as Option 2/3.** One effort, two payoffs.

### Sequencing suggestion (for tomorrow)
1. Decide the UX: how NL feedback fits the kring (Part A recommendation = agent-member / circle-LLM).
2. Build the **NL→slash interpreter + the circle free-text call site** (the shared core).
3. Wire **household** (slash catalog) and **feedback** (intents) as the two consumers.
4. Routes in order of cost: local → cloud (warned) → confidential-proxy (M7 gateway).
