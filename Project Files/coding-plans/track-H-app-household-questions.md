# H2 — design questions for review

Companion to [`./track-H-app-household.md`](./track-H-app-household.md).
This doc is a single-pass worksheet: read each question, write your
answer in the **Your answer:** block.  When all are answered I'll
fold the locks back into the main plan doc.

Status of abbreviations: I'll expand the less-common ones on first
use.  Common ones (LLM, API, URL) stay as-is.  Tell me if any are
still unclear.

---

## Group A — Telegram + delivery

### Q-H2.1 — Bot framework

**The choice:** when the bot polls / receives messages from Telegram,
does it use an npm package as a wrapper, or talk directly to
Telegram's HTTP API?

**Three options:**

- **(a) `node-telegram-bot-api`** — older (2015), battle-tested,
  Node-callback-style.
- **(b) `telegraf`** — newer (2017), more idiomatic Promises/async-await,
  larger community now.
- **(c) No package — talk to Telegram's HTTP API directly via `fetch`.**
  Same approach you used in the earlier `claude-telegram-bridge`
  project.  More code (you implement long-polling, message parsing,
  inline-button serialization yourself) but no Node-specific
  dependencies.

**Your point about phone-compatibility is the right thing to surface
here.**  My take:

- Both `node-telegram-bot-api` and `telegraf` use Node-only stuff
  internally (HTTPS streams, timers, `Buffer`).  They run fine on
  Node servers but bringing them to React Native means the
  polyfill saga we just shipped for Folio.  Painful.
- The "no package, raw HTTP" approach uses only `fetch` + JSON,
  which works identically on Node and RN.  No polyfill burden.
- That said: **do we expect a household-app phone client at all?**
  I'm not sure we do.  The whole H2 pitch is "Telegram IS the
  phone client" — the user already has Telegram on their phone;
  there's no separate household-app phone UI in v0.  The agent
  itself runs on a private server (where the LLM lives), and the
  user reaches it through Telegram.  No RN bundle.
- If a future *household app* phone UI is desired (a separate
  RN app that talks to the household agent), it'd talk to the
  agent over a REST/WS API just like Folio mobile does today —
  so the phone never imports the Telegram lib regardless.

**My lean:** **(b) telegraf** for the agent's Telegram integration,
because if we ever do build a phone app it talks to the agent (not
to Telegram directly), so the Telegram lib only needs to work on
Node.  Telegraf has the nicer modern API.

**But I'm sympathetic to (c).**  If you remember `claude-telegram-bridge`
working well without a package, we can absolutely do the raw-HTTP
route — the implementation is ~200 LOC and we learn nothing wrong
along the way.  The trade is "more code, fewer dependencies".

**Your answer:**
> [your previous answer recorded:] We didn't use a package at all in
> claude-telegram-bridge.  Open to packages for ease-of-implementation,
> but worried about polyfill maintenance if there's a future phone app.
>
> Follow-up: knowing that the agent runs on a private server (not
> the phone) and any future phone client would talk REST to the
> agent — does telegraf still feel risky?  Or do you have other
> reasons to prefer the raw-HTTP path?
>
> [Pick one:]
>   (x) telegraf (use a package; phone would talk REST anyway)
>   ( ) node-telegram-bot-api
>   ( ) raw HTTP / no package (matches claude-telegram-bridge)

---

### Q-H2.3 — Bot deployment (webhook vs long-polling)

**The choice:** how the bot receives messages from Telegram.

- **Webhook**: Telegram POSTs to your server at a public HTTPS URL
  whenever a message arrives.  Fast, low overhead.  Requires the
  server to be reachable from the public internet.
- **Long-polling**: the bot repeatedly asks Telegram "any new
  messages?" via outbound HTTPS calls.  Works without a public
  endpoint.  Slightly higher latency, more idle CPU.

**Your previous answer locked this:** support both.  Webhook for
production (the LLM needs a server anyway, so a public endpoint is
already on the table).  Long-polling for lightweight testing.

**Locked:** support both.  Default: webhook in production
configuration, long-polling in dev / test.  Choose via env var or
config.

**Your answer:** locked above.  No further question unless you want
to re-open.

---

### Q-H2.4 — Twist 2 (implicit signals / suggestions)

**The choice:** does the bot watch passive chat (no `@Household`
mention) and offer "🛒 add to groceries?" suggestions on phrases
like "we're out of coffee"?

**Your answer locked this:** suggestions not asked for, not needed.
The bot only responds when addressed (`@Household ...` mention,
reply-to-bot, or direct message).

**Locked:** Twist 2 is dropped from v0.  If a household later asks
for it, the LLM-skill machinery is already there; just remove the
"is the message addressed?" filter for that chat.

**Implication for the rest of the doc:** the "implicit-signals"
subsection in the design's "What you see" section is now misleading
— I'll prune it from the main plan when locking.

**Your answer:** locked above.

---

### Q-H2.5 — `MessagingBridge` interface in v0

**The choice:** how organised the code is internally — specifically,
do we define a small interface (a contract for "what does any
messaging platform have to provide?") that the Telegram adapter
satisfies, even though Telegram is the only platform we're shipping?

**What the interface is, concretely:**

It's a TypeScript-style description of "any messaging platform must
provide these four functions":

```js
{
  start(): start listening for messages
  stop():  stop listening
  sendReply({ chatId, text, buttons? }): post a reply
  onMessage(handler): register the function called when a message arrives
}
```

In v0 there's only one implementation of this — the Telegram
adapter.  In v1, if we add Signal, we write a Signal adapter that
satisfies the same shape.  The household agent only ever talks to
**the interface**, never directly to Telegram.

**The trade-off:**

- **Define it now (~50 lines of interface code + the Telegram
  adapter conforming to it).** When Signal/Matrix arrives, you write
  a Signal adapter and the agent doesn't change.  Cheap insurance.
- **Skip it for v0.**  Just write Telegram-specific code directly in
  the agent.  Simpler today.  When Signal arrives, you refactor —
  Telegram-specific assumptions are sprinkled across the agent code,
  which becomes a 1–2 day cleanup.

**My lean (and I tentatively locked this in the doc revision):
define it now.**  The cost is small (~50 LOC) and the discipline
keeps the agent code platform-agnostic from day one.

**Concrete example to make this less abstract:**

```js
// WITHOUT the interface (skip-it-for-v0 path):
//
//   The agent code does: bot.sendMessage(chatId, "added bread")
//   That's a Telegram-specific call.  When Signal comes, you have to
//   find every call like this and replace.
//
// WITH the interface (define-it-now path):
//
//   The agent code does: bridge.sendReply({ chatId, text: "added bread" })
//   The Telegram adapter implements `sendReply` by calling
//   bot.sendMessage internally.  A future Signal adapter implements
//   `sendReply` differently, but the agent code doesn't change.
```

**Why I described this as "I don't understand":** the question was
phrased as "do you want abstraction?" without explaining what the
abstraction looks like in code.  Hopefully the example above makes
it concrete.

**Your answer:**
> [Pick one:]
>   (x) Define MessagingBridge in v0 (cheap insurance) -- the author: does signal has similar api/bot options too?
>   ( ) Skip it; refactor later if Signal/Matrix arrives
>   ( ) I trust your call — pick the safer one

---

## Group B — Pod shape + retention

### Q-H2.2 — Chat archive retention

**Background:** by default, **raw Telegram messages are NOT stored
in the pod** (only the extracted items are — "bread" lands in
`/household/groceries/`, but the chat message that produced it
doesn't).

There's an *optional* "encrypted chat-archive" section, where the
bot persists the raw messages too — useful for full-text search
later or for trust ("show me the message that produced this item").

**The choice:** if we ship that optional section, how long does it
keep messages?

**Options:**

- (a) Forever.  Storage is cheap; encrypted on the pod.
- (b) 30 days rolling.
- (c) Configurable per-chat, default forever.
- (d) **Don't ship the chat-archive section in v0 at all.**  Just
  defer to "Telegram has its own chat history; that's enough."

**My lean:** (c) configurable, default forever.  But (d) is the
simplest "ship it, see if anyone asks for the archive" path.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) forever
>   ( ) (b) 30 days
>   (x) (c) configurable, default forever
>   ( ) (d) skip the archive section in v0
>   Comment:

---

### Q-H2.6 — One pod or many

**The choice:** how household state is stored across members.

- **(a) V0 lean: one shared household pod.**  Every member reads/writes
  the same pod with the same encryption key.  Simple.  Trade-off:
  Anne can't have items only-she-can-see inside the household pod —
  if she wants privacy she has to keep that data outside the
  household entirely.
- **(b) V1 lean: hybrid pod.**  Each household member has their own
  pod.  The household pod stores genuinely-shared state (groceries
  everyone can see) and *links to* per-member items where
  appropriate (Anne's personal errand list lives on Anne's pod;
  the household pod has a reference, but only Anne can read the
  contents).  More privacy; more complex schema + permissions.

**Note:** the current Folio + Archive validation has been
single-pod, so single-pod is the well-trodden path.  Hybrid is
documented in `Design-v3/topology.md` but no app has shipped it
yet; H2 would be the first if we picked (b) for v0.

**My lean:** (a) for v0, (b) when a real household asks for it.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) one shared pod for v0; revisit for v1
>   ( ) (b) start with hybrid in v0 (be the first to ship the pattern)
>   Comment:
>   

---

### Q-H2.14 — Channel-to-pod mapping

**The choice:** can one Telegram channel feed multiple household pods?

Picture: a single chat with both "family" and "sports club" members.
Shopping lands in family pod; sports schedule lands in club pod.
The bot would need to classify each message and route to the right
pod.

**Options:**

- (a) **Single channel, single pod.**  Simple.  If you want both
  family and sports state, run two bots in two channels.
- (b) **Multi-pod routing.**  The bot classifies each message by
  topic and routes to the right pod.  Adds complexity to the LLM
  prompt + agent.

**My lean:** (a) for v0.  Multi-pod routing can come later if a real
user asks for it.

**Your answer:**
> [Pick one or comment:]
>   (x) (a) single channel = single pod
>   ( ) (b) start with multi-pod routing
>   Comment:
yes, as the agent/bot is a household member, its received messages are owned by it too
---

## Group C — UX + cadence

### Q-H2.7 — Completion-loop cadence

**The flow:** items get extracted from chat → bot stores them in
the pod.  At some later point, the bot should ask "what got done?"
so members can mark items complete.

**The choice:** when to nudge, and how often.

**Sub-questions:**

- (a) **Default delay** before the first nudge.  Your framing said
  "30 minutes or so."  Is 30 min the right starting default?  Or
  longer (1 hour) / shorter (10 min)?
- (b) **Daily digest** at a fixed time (say 19:00 local) — separate
  from the per-extract nudge?  Or just rely on "30 min after last
  activity, then back off"?

**My lean:**
- 30 min after the latest ambient extract is a good default.
- Daily digest at 19:00 local IS worth shipping separately — it
  catches "we extracted things 3 days ago and never got around to
  them" stale state that a per-activity nudge can miss.
- Both are configurable per household.

**Your answer:**
> (a) Default delay before per-activity nudge:  1 hr  (e.g. 30 min, 1 hr, off)
> (b) Daily digest:
>   (x) Yes, at 20:00 local (configurable)
>   ( ) Yes, but at:  __________
>   ( ) No, only per-activity nudge
>   ( ) No, no nudges at all (silent until asked)
> Comment:
would be nice if the bot had a default for groceries, but that the user could also say something like 'check me again at HH:MM' or that the bot would ask for it itself.
---

### Q-H2.8 — Hallucination tolerance

**Background:** small local LLMs sometimes misclassify ("buy gym
membership" → shopping?) or invent items.  How aggressive should
the confirmation flow be?

**Note:** Twist 2 (ambient extraction) is dropped per Q-H2.4, so
this question now only applies to *direct commands* (`@Household add
bread` or similar).  That removes the "ambient = riskier" axis I
originally split on.  Cleaner choice now:

- (a) **Trust direct commands silently.**  `@Household add bread`
  → silent commit, no confirmation.  Daily digest is the safety net.
- (b) **Confirm every commit with an undo button.**  `@Household
  add bread` → bot replies "✓ added: bread [undo]".  60s undo window.
  Slightly more chatty but cheaper to recover from a misparse.
- (c) **Hybrid: silent for very-short / unambiguous commands; undo
  button for longer / parsed-from-multi-clause commands.**  Heuristic
  on whether the LLM had to do extraction work.

**My (revised) lean:** (b) — undo button every time.  The flow
"`@Household add bread` → ✓ added [undo]" reads naturally and the
60s safety net is cheap.  Daily digest still ships as the
long-term safety net.

**Your answer:**
> [Pick one or comment:]
>   (x) (a) trust direct commands; daily digest only
>   ( ) (b) undo button on every commit
>   ( ) (c) hybrid (heuristic)
>   Comment:

---

## Group D — LLM

### Q-H2.9 — Multi-language

**Background:** the household chats in Dutch / English / mixed.
Modern small models (Qwen 2.5 3B, Phi-3.5 mini) handle Dutch
reasonably well in benchmarks, but real performance varies.

**The choice:** do we ship a quality-bar test harness in v0 (lets
you run 50 real chat messages through the model and measure
extraction accuracy), or assume the default model is good enough
and only test if it actually fails in practice?

**Sub-options:**

- (a) **Ship the test harness.**  ~half-day of work; lets you
  verify before deploying.  Useful if/when we swap models.
- (b) **Skip until it fails.**  Just deploy with `qwen2.5:3b`,
  watch real chats, swap models if extraction quality is bad.
  Less proactive but cheaper to ship.
- (c) **Manual ad-hoc test only**: I write a one-off script the
  first time we deploy, but don't make it a permanent test
  harness.  Middle ground.

**My lean:** (c) — script when we first deploy; promote to a real
harness only if we end up swapping models more than once.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) ship the test harness in v0
>   ( ) (b) skip; test only when needed
>   (x) (c) ad-hoc script first time, formalise later if needed
>   Comment:

---

### Q-H2.10 — LLM hardware (production)

**The choice:** where does the always-on LLM live for production?

For *testing* the answer is "whatever you already have."  For
*production* (a household actually using H2 daily), the lean is
"used Mac mini M2 16 GB, ~€500 once, ~€2/mo electricity."

**But you may already have something that works.**  Concrete
options:

- (a) **Used Mac mini M2 16 GB** — buy fresh, ~€500.  Apple Silicon
  is exceptional for small LLM inference (30+ tokens/sec on Qwen 3B).
  Idle ~8 W.
- (b) **Raspberry Pi 5 8 GB** — ~€100 used, slower (3-7 tokens/sec for
  3B), but cheap.
- (c) **Existing always-on machine** — if you already have a home
  server / NAS / desktop that's always on, run the LLM there.
  Marginal cost = small bump in electricity.
- (d) **Friend's spare laptop** — your framing mentioned this option;
  cheap as long as a friend has a spare laptop they don't mind
  always-on.
- (e) **Defer the decision** — start testing on your laptop, decide
  hardware only when you're ready to deploy to a real household.

**My lean:** (e) defer until first deployment is on the table.
Testing works fine on your laptop.

**Your answer:**
> Production hardware plan:
>   ( ) (a) Mac mini M2 (commit now)
>   ( ) (b) Pi 5 (cheaper, slower)
>   ( ) (c) existing always-on machine (specify which: __________)
>   ( ) (d) friend's laptop / shared device
>   (x) (e) defer; decide at first deployment
> Comment:

---

### Q-H2.11 — Tool-calling shape

**Background:** when the LLM needs to invoke agent skills (e.g.
"add bread to the grocery list"), it has to phrase that invocation
in some structured format the agent code can recognise.

**The choice:** what format.

- **(a) OpenAI-style JSON schema.**  Models output structured JSON
  like `{"tool": "addItem", "args": {"text": "bread", "type":
  "shopping"}}`.  Native support in Qwen, Phi, Llama, GPT, Claude
  (via translation), Mistral.  De-facto standard.  The "agreed
  language" of model tool-calling.
- **(b) MCP** (Model Context Protocol — Anthropic's newer standard).
  More sophisticated; designed for complex tool ecosystems with
  many servers.  Over-engineered for a single-agent app like H2;
  fewer model implementations support it natively.
- **(c) Custom regex / parsed text.**  LLM emits "I'll add bread to
  groceries" in natural English; agent regex-parses it.  Brittle,
  error-prone, and gives up most of the structured-output benefit.

**My lean:** (a) OpenAI-style.  Universally supported, well-tested,
small implementation surface.

**Your answer:**
> [Pick one or comment:]
>   (x) (a) OpenAI-style JSON schema
>   ( ) (b) MCP
>   ( ) (c) custom / regex
>   Comment:

---

### Q-H2.12 — Cloud LLM as opt-in

**The whole H2 pitch is privacy → local LLM by default.  But should
the agent SUPPORT cloud LLMs at all?**

Reasons to support cloud:
- A user without LLM-capable hardware accepts the privacy trade for
  ease.
- A test/dev configuration where cloud is fast and the
  privacy-tier doesn't matter.
- The existing OpenAI-style tool-calling means cloud is just
  "different base URL" — minimal code surface.

Reasons NOT to support cloud:
- It defeats the point of H2.
- Users might enable it casually and forget — privacy regression.

**Options:**

- (a) **Support cloud, opt-in only, behind a visible warning.**  My
  lean.  "Are you sure?  Your household chat will be sent to
  <provider>.  Recommended only for development / testing."
- (b) **No cloud support shipped, period.**  If someone wants it,
  they fork.  Signals project values strongly.
- (c) **Support cloud as a first-class option, no warning.**
  Aligns with letting the user choose.  My weakest preference.

**Your answer:**
> [Pick one or comment:]
>   (x) (a) support, opt-in, with warning
>   ( ) (b) no cloud support
>   ( ) (c) first-class option
>   Comment:

---

## Group E — Identity (Q-H2.13)

### Q-H2.13 — Bot identity

**The choice:** does the bot have its own keypair (its own
cryptographic identity, separate from any human household member),
or does it sign on behalf of "the household" with a shared key?

**Trade-off:**

- **Own keypair**: audit trail distinguishes "the author added bread"
  (signed by the author's webid) from "bot marked complete" (signed by
  the bot's keypair).  Cleaner trust story, especially if a bug
  causes the bot to misbehave (you can roll back just the bot's
  actions).
- **Shared household key**: simpler — one identity for everything.
  Cheaper to manage.  Loses the audit-trail granularity.

**My lean (locked tentatively in the doc):** own keypair.  Twist 1
("the bot is a household member, not a feature") aligns with this.

**Your answer:**
> [Pick one or comment:]
>   (x) Own keypair (locked-as-leaning)
>   ( ) Shared household key
>   ( ) Other:
>   Comment:

---

## Once you've answered

Last question: do we really need an llm or would a normal telegram bot do (in dutch too)?