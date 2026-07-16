# Free-text experiment — results log

Running tally of model + prompt + parameter combinations evaluated
for the H2 free-text bot.  Captures what's been tried, what worked,
and what didn't.

> **Last updated: 2026-05-03**

---

## Test sets

### `lite` — 5 fixtures, 6 turns total

Quick first-impression set (used by `freetext-smoke-lite` /
`freetext-smoke-lite-3` / `freetext-smoke-lite-3-tuned`).  Marked
with `lite: true` in `scripts/freetext-smoke.js`.

| # | Fixture | Capability tested |
|---|---|---|
| 1 | `add 3 items (direct phrasing)` | Multi-item add + correct list name |
| 2 | `show list (toon de …)` | Show + buttons rendered |
| 3 | `remove via "ik heb X"` | Natural-language remove |
| 4 | `chitchat (hoi)` | NO tool call expected |
| 5 | `workflow: show → tap → confirm` | Two-turn: showList → button-tap → removeFromList |

### `full` — 19 fixtures, 23 turns

All atomic + multi-turn fixtures (used by `freetext-smoke`).
Includes the lite set + 14 more covering polite phrasings, alt
removal idioms, multi-list management, no-translate, typo
robustness, and 5 contrast pairs.

---

## Models tested

| Model | Size | Tool template | Dutch fluency | Tool-call reliability |
|---|---|---|---|---|
| `qwen2.5:3b-instruct` | 1.9 GB | ✓ native | competent | strong |
| `qwen2.5:7b-instruct` | 4.7 GB | ✓ native | competent | strong |
| `mistral:7b-instruct` (v0.3) | 4.4 GB | ✓ native (v0.3+) | reasonable | moderate, often emits JSON-as-text |
| `bramvanroy/geitje-7b-ultra:Q4_K_M` | 4.4 GB | ✗ (no tool template) | strongest | only via loose-parser recovery |

Hardware note: 7B Q4 models taking 60–270s per turn on cold cache
suggests partial CPU fallback.  3B sits comfortably in GPU.

---

## Prompts evaluated

| Variant | File / constant | Length (approx) | Style |
|---|---|---|---|
| `default` | `lib/freetext-core.js` `SYSTEM_PROMPT` | ~3500 tokens | Directive — explicit JSON-emission format + 8 contrast pairs + trigger-word cheat sheet + button-tap reinforcement |
| `trimmed` | `lib/freetext-core.js` `SYSTEM_PROMPT_TRIMMED` | ~1500 tokens | Same shape, ~50% shorter (trades example depth for fewer tokens) |
| `baseline` | `lib/freetext-core.js` `SYSTEM_PROMPT_BASELINE` | ~2500 tokens | Pre-directive (tool-call style, verbal "use these tools") |

---

## LLM parameters

| Parameter | Default | Tuned variant | Effect |
|---|---|---|---|
| `temperature` | (Ollama default ≈ 0.8) | `0.1` | Lower = less hallucination, but doesn't fix structural confusion |
| `stop` | (none) | `["\nUser:", "\nReply:"]` | Aborts when model echoes prompt example syntax |
| `top_p` | (Ollama default) | not tuned | — |
| `max_tokens` | (Ollama default) | not tuned | — |

Wired via `HOUSEHOLD_LLM_TEMPERATURE` and `HOUSEHOLD_LLM_STOP` env
vars; pinned as `defaultOptions` on the `ollamaProvider` per
`@onderling/llm-client` v0.2.0.

---

## Substrate parser improvements (`@onderling/llm-client` v0.2.0)

| Feature | What it catches |
|---|---|
| OpenAI `tool_calls` (native) | Models with proper tool template (qwen, mistral v0.3+) |
| Strict JSON `{tool, args}` (existing) | Substrate-convention JSON in clean form |
| OpenAI `{name, arguments}` JSON | OpenAI-style emission as text |
| Nested `{function: {name, arguments}}` | Variant OpenAI shape |
| JSON-with-noise (e.g. `blings\n{...}`) | Models that prepend prose before JSON |
| Markdown-fenced JSON | Code-block-formatted emission |
| JS-call syntax (`addToList("a", "b")`) | Models that emit calls as text expressions; mapped to schema params |
| Escaped braces `\{ ... \}` | Mistral observed escaping braces |
| Dutch + English natural-language patterns (`X is klaar`, `verwijder X`) | Models that "explain" actions in prose without structured form |
| Auto-fallback for tool-less models | Geitje (no tool template); retries without `tools` field |

---

## Run results

### Run A — default settings (directive prompt, no temperature override)

`HOUSEHOLD_LLM_MODELS=qwen2.5:7b-instruct,mistral:7b-instruct,bramvanroy/geitje-7b-ultra:Q4_K_M npm run freetext-smoke-lite-3 --prefix apps/household`

| Model | Lite score | Failures |
|---|---|---|
| qwen2.5:7b-instruct | **6/6 (100%)** | — |
| mistral:7b-instruct | 2/6 (33%) | Hallucinated items, echoed prompt example syntax, escaped JSON braces |
| bramvanroy/geitje-7b-ultra | 5/6 (83%) | Workflow tap: emitted natural-language "❌ appels is klaar" with no JSON |

**Average: 64% across 3 models.**
**Directive prompt verdict: best for qwen and geitje; mistral struggles regardless.**

### Run B — tuned settings (trimmed prompt + temp 0.1 + stop sequences)

`npm run freetext-smoke-lite-3-tuned --prefix apps/household`

| Model | Lite score | Δ vs Run A | Notes |
|---|---|---|---|
| qwen2.5:7b-instruct | 5/6 (83%) | **−1** | Workflow tap: narrated removal in past tense without emitting JSON |
| mistral:7b-instruct | 2/6 (33%) | **0** | Different failures — leaked contextBuilder back as user reply, hallucinated `removeFromList(appels)` for "Hoi" greeting |
| bramvanroy/geitje-7b-ultra | 2/6 (33%) | **−3** | Major regression: explained patterns instead of emitting them.  Trimmed prompt removed too many examples |

**Average: 50% across 3 models.**
**Tuned verdict: trimmed prompt hurts more than it helps.  Small models need MORE examples, not fewer.  Temperature drop didn't fix mistral's structural confusion.**

### Run C — qwen 3B baseline (lite)

Earlier reference run.

| Model | Lite score |
|---|---|
| qwen2.5:3b-instruct | **6/6 (100%)** — same as 7B |

3B reaches the same lite score as 7B at much higher speed (≈3–5×
faster turns).

### Run D — default settings, full button-tap reinforcement (2026-05-03)

Default prompt with the "ik heb X van Y is ALWAYS removeFromList"
section + 3 explicit button-tap examples that landed in this session.

`npm run freetext-smoke-lite-3 --prefix apps/household`

| Model | Lite score | Δ vs Run A |
|---|---|---|
| qwen2.5:7b-instruct | **6/6 (100%)** | 0 |
| **bramvanroy/geitje-7b-ultra** | **6/6 (100%)** | **+1** ← button-tap reinforcement closed the gap |
| mistral:7b-instruct | 1/6 (17%) | **-1** ← full meltdown — 21 tool calls for plain "Hoi" |

**Average: 72% across 3 models.**
**Run D verdict: two production-grade options confirmed (qwen, geitje
both 100%).  Mistral is definitively unsuitable — the same prompt that
took geitje from 5/6 → 6/6 took mistral from 2/6 → 1/6.  The model is
the bottleneck, not the prompt.**

---

## Key findings

1. **Small models need MORE examples, not fewer.**
   Trimming the prompt 50% dropped geitje from 83% → 33%.  Concrete
   examples are the highest-leverage prompt feature for sub-13B
   instruction-following.

2. **`SYSTEM_PROMPT` (directive, ~3500 tokens) is the sweet spot.**
   Going longer would help marginally; going shorter hurts a lot.
   Keep it.

3. **Mistral 7B Q4 is fundamentally unreliable for structured output.**
   Failures are model-level, not prompt-level: hallucinating items
   the user never mentioned, echoing prompt example dialog as if it
   were chat, leaking system context into user replies, calling
   `removeFromList` for a plain greeting.  Lower temperature didn't
   fix it.  Stop sequences didn't fix it.  Trimmed prompt didn't fix
   it.  The model lacks the fidelity for this workload.  Re-evaluate
   with `mistral-nemo-12b` or `mistral-small-3` when those land.

4. **Geitje is workable** for Dutch-fluency-first deployments at 83%
   on lite (with directive prompt + auto-fallback for missing tool
   template + loose-parser recovery for JSON-text emission).  Its
   one lite failure (button-tap synth) emits `"❌ appels is klaar"`
   in pure prose; the natural-language fallback parser catches this
   shape.

5. **Qwen 2.5 (3B or 7B) is the production answer.**
   100% on lite both sizes.  3B = 3–5× faster, no fidelity cost on
   this workload.  7B = slight Dutch-fluency edge.  Pick by
   priority.

6. **Auto-fallback for tool-less models works.**
   The `ollamaProvider` detects `"does not support tools"` HTTP 400
   and retries without the `tools` field.  Combined with the
   directive prompt's explicit JSON-emission instruction + the
   loose-parser, geitje became usable.

---

## Production recommendations (locked 2026-05-03)

| Decision | Choice | Rationale |
|---|---|---|
| **Model** | `qwen2.5:3b-instruct` (default) or `qwen2.5:7b-instruct` (capability) | 100% lite, reliable structured emission, native tool-calling |
| **Prompt** | `SYSTEM_PROMPT` (directive, current default) | Best across all 3 tested models |
| **Temperature** | (unset — use Ollama default) | Tuning didn't help; default is fine for the production models |
| **Stop sequences** | (unset) | Didn't help; default is fine |
| **Geitje status** | Backup for Dutch-fluency-first | 83% acceptable when fluency dominates over reliability |
| **Mistral status** | Not suitable | Reassess when newer variant lands |

---

## What next

- **Slash command pre-processor** — deterministic, model-agnostic
  fast path for `/add`, `/show`, `/remove`, etc.  No model-level
  smoke needed (purely deterministic parsing).  Scoped here:
  `lib/freetext-core.js` + `tg-freetext.js` + `cli-freetext.js`.
- **TG real-device feel test** — once slash commands ship, test
  with a real Telegram bot for private experience.
- **Eventual V2 pivot** — promote the experiment's design into the
  production `apps/household/src/HouseholdAgent.js` (the H2 V2
  architecture pivot per `Project Files/Substrates/apps/H2-household.md`).
  Out of scope for the experiment session; bigger work.

---

## Production deployment recipe (single-user, personal)

The experiment is now ready to run as a personal household bot in
TG.  Defaults pin best-known config; lists persist across restarts.

### Setup

```bash
# 1. Ensure Ollama is running with the production model
ollama list | grep qwen2.5:3b-instruct   # should show

# 2. Get a Telegram bot token from @BotFather (one-time)
export HOUSEHOLD_TG_BOT_TOKEN=<your token>

# 3. (Optional) override the model — defaults to qwen2.5:7b-instruct
export HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct      # faster
# or
export HOUSEHOLD_LLM_MODEL=bramvanroy/geitje-7b-ultra:Q4_K_M  # better Dutch

# 4. (Optional) override storage path — defaults to ~/.household/lists.json
export HOUSEHOLD_LISTS_PATH=/path/to/lists.json
# or
export HOUSEHOLD_LISTS_PATH=:memory:                # ephemeral (dev / smoke)

# 5. Run
npm run tg-freetext --prefix apps/household
```

### What you get

- Slash commands (deterministic, no LLM): `/add`, `/show`, `/remove`,
  `/done`, `/lists`, `/help`.
- Natural language as fallback: *"voeg melk toe aan boodschappen"*,
  *"ik heb melk"*, *"toon klusjes"*.
- Tappable buttons in `/show` results.
- Lists persist to `HOUSEHOLD_LISTS_PATH` after every change.
- Per-message logs in stderr for debugging:
  - `[user <name> chatId=<id>] <text>` — incoming
  - `[slash] /<cmd> <args>` — deterministic dispatch
  - `[tool] <name>(<args>)` — LLM-driven dispatch
  - `[reply chatId=<id>] <text>` — outgoing
  - `[persist] saved …` — disk write

### What's NOT in this deployment yet (single-user limits)

- **Single store**: all chats share one `~/.household/lists.json`.  Two
  TG users hitting the bot would see each other's items.  Multi-user
  support = bigger redesign (per-chatId store, per-pod auth).
- **No auth**: any TG user who knows the bot username can interact.
  For personal use this is fine; for shared deployment add an
  allow-list.
- **No backups**: a JSON file with no rotation.  Manual `cp` if you
  care about losing state.
- **No restart-survival of in-flight LLM calls**: a Ctrl-C mid-LLM
  drops that turn cleanly but the user's typed message is gone.

These are V1+ items.  Acceptable for personal use today.

---

## V2 architecture pivot of `HouseholdAgent`

The experiment validates the design (directive prompt + free-form
list names + slash commands + LLM fallback).  Promoting it into the
production `apps/household/src/HouseholdAgent.js` is the H2 V2
pivot per `Project Files/Substrates/apps/H2-household.md`.

### V2 Phase 1 — additive coexistence ✓ shipped 2026-05-03

- New class `apps/household/src/HouseholdAgentFreeform.js`
  exported from the package index.
- Wraps `@onderling/chat-agent`'s `ChatAgent` with the directive
  system prompt + free-form 3-tool catalogue + slash-command
  pre-processor + (optional) file-persisted list store.
- 18 new tests in `test/HouseholdAgentFreeform.test.js`:
  construction validation, slash-command routing (deterministic, no
  LLM), `/add`/`/show`/`/remove`/`/done`/`/lists`/`/help`,
  bot-username stripping, plain-text fallback to LLM, tool-call
  → store update, caller-supplied store.
- **All 398 legacy `HouseholdAgent` tests stay green** — Phase 1
  is purely additive.

Total household test suite: 398 → **416** tests (+18).

### V2 Phase 2 — retire legacy (next session)

The current production household app has:

| Layer | Current shape | V2 target |
|---|---|---|
| `HouseholdAgent.js` | regex fast path → ChatAgent slow path with `classifyAndExtract` | slash-command fast path → ChatAgent slow path with directive prompt |
| `parsers/regexCommands.js` | `add shopping bread` style with fixed types | retire — slash commands replace |
| `skills/classifyAndExtract.js` | LLM router that picks from 5 fixed-type tools | retire — directive prompt + 3 generic tools |
| `skills/{addItem,listOpen,markComplete,removeItem,help}.js` | type-bound (shopping/errand/repair/schedule) | retire or rewrite as free-form-list handlers |
| `storage/Store.js` interface | items have `type: ItemType` enum | items have `listName: string` (free-form) |
| `@onderling/item-store` substrate consumption | one big bucket of items with type field | one bucket per list name |
| `scheduler/DailyDigest.js` | groups by type for daily summary | groups by list name |
| `bridges/TelegramBridge.js` | shipped | unchanged |
| Tests | 398 tests, ~30 files | ~150 require updates / rewrites |
| Pod schema | `<household>/open/<ulid>.json` with `type` field | same path, replace `type` with `listName` |

### Migration approach (final)

Two-phase migration to avoid a big-bang rewrite.  **Phase 1 done
2026-05-03**; Phase 2 is the next session.

**Phase 1 — additive coexistence (✓ shipped)**

Implemented as a NEW sibling class rather than a constructor flag
on `HouseholdAgent`.  Reasoning: the legacy class has too much
type-bound logic (skills, classifyAndExtract, scheduler integration)
to cleanly fork at the constructor.  Two parallel agents in the
same package + the consumer picks at construction is cleaner.

- `apps/household/src/HouseholdAgentFreeform.js` — new class.
- `apps/household/test/HouseholdAgentFreeform.test.js` — 18 tests.
- `apps/household/src/index.js` — exports both `HouseholdAgent` and
  `HouseholdAgentFreeform`.
- All 398 legacy tests pass.  Total: 416.

Code organisation is intentionally minimal in Phase 1 — the new
class imports from `scripts/lib/freetext-core.js` (across
src ↔ scripts) to keep the diff small.  Phase 2 cleans this up.

**Phase 2 — retire legacy + clean code organisation (next session)**

Steps, in dependency order:

1. **Move `scripts/lib/freetext-core.js` → `src/freeform/core.js`.**
   Update `scripts/tg-freetext.js`, `scripts/cli-freetext.js`, and
   `src/HouseholdAgentFreeform.js` to import from the new location.
   Tests stay green.
2. **Add a freeform CLI entry**: `apps/household/src/cli.js serve
   --mode=freeform` (replaces "not implemented" scaffold).
3. **Wire scheduler into freeform agent**: `addToList` /
   `removeFromList` emit state-update events that the
   `@onderling/notifier` scheduler consumes for digests + nudges.
   Currently the freeform agent has a `scheduler` getter but no
   wiring.
4. **Wire pod persistence as an option**: `createPersistedListStore`
   currently writes to a local JSON file.  Add a pod-backed variant
   that uses the existing `@onderling/pod-client` (multi-device
   safety).
5. **Migrate user-facing language to localisation** (per the multilingual
   extension plan in `PROMPT-EXPERIMENTATION.md`).
6. **Deprecate legacy** with a console warning when `HouseholdAgent`
   is constructed.  Document that `HouseholdAgentFreeform` is the
   recommended path.
7. (Future) **Retire legacy code**: delete `parsers/regexCommands.js`,
   `skills/classifyAndExtract.js`, fixed-type skills, the type field
   from `Store`.  Migrate the ~50 tests that depend on those.

### When to start Phase 2

When (1) the user has had a real-device feel test of the freeform
agent in TG and reports it's good, AND (2) there's appetite for a
focused refactor session.  No urgency before then — Phase 1 already
unblocks production deployment of the freeform variant.

---

## Test reproducibility

- `npm run freetext-smoke-lite       --prefix apps/household` — quick lite, 1 model (qwen 3B by default)
- `npm run freetext-smoke-lite-3     --prefix apps/household` — quick lite, 3 default models
- `npm run freetext-smoke-lite-3-tuned --prefix apps/household` — lite-3 with trimmed prompt + temp 0.1 + stop
- `npm run freetext-smoke            --prefix apps/household` — full sweep (all 19 fixtures, 3 models)
- `npm run cli-freetext              --prefix apps/household` — interactive REPL
- `npm run tg-freetext               --prefix apps/household` — live Telegram bot
- `npm run tool-probe                --prefix apps/household` — single-shot raw model probe (`-- <model> "<prompt>"`)
