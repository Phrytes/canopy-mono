# H2 — Household app: implementation plan

| | |
|---|---|
| **Status** | Plan-only.  No code yet.  Ready to kick off (all 14 design questions locked). |
| **Drafted** | 2026-04-30 |
| **Lives in** | `apps/household/` (target).  Same monorepo as Folio + Archive. |
| **Companion docs** | [DESIGN](../../coding-plans/track-H-app-household.md), [PROGRAMMING-PLAN](./programming-plan.md), [README](./README.md) (L2 design notes), [llm-cost](./llm-cost.md) |

This doc covers **how the work is sliced and sequenced**.  The
actual code design (modules, contracts, types) lives in
[`programming-plan.md`](./programming-plan.md).

---

## Compatibility ground rules

These are inherited from CLAUDE.md and the existing apps (Folio,
Archive); listed here so the H2 team doesn't drift:

- **Monorepo layout**: `apps/household/` alongside `apps/folio/`,
  `apps/archive/`, etc.  Workspace deps via `file:`, mirroring how
  Folio + Archive depend on `@canopy/core` and `@canopy/pod-client`.
- **Code style**: ES modules (`"type": "module"`), `.js` only (no TS).
  Vitest for tests.  Private class fields (`#foo`) where appropriate.
  PascalCase for class files, camelCase for helpers — same as
  `apps/folio/src/`.
- **Reuse first.**  Pod operations via `@canopy/pod-client`; identity
  + capabilities + groups via `@canopy/core`.  Don't fork.
- **No new top-level deps without approval.**  This plan calls out
  every new npm package below; each needs explicit OK before install
  (CLAUDE.md rule).
- **No regressions in existing apps**: every phase ends with `npm test
  --prefix apps/folio && npm test --prefix apps/archive` still green.
  H2 is a new app, not a change to existing ones — so this is a sanity
  check, not an active concern.

---

## Phase overview

```
Phase 0 — Scaffold                          (~half day)
            │
            ▼
   ┌────────┴────────┬─────────────────┐
   │ Stream A         │ Stream B        │
   │ (skills+bridge)  │ (hybrid pod)    │
   ▼                  ▼                 │
Phase 1 — Bridge   Phase 2 — Pod plumbing│
+ regex commands   + identity wiring     │
+ skill registry                         │
   │                  │                  │
   └────────┬─────────┘                  │
            ▼                            │
        Phase 3 — LLM slow path           │
        (depends on skills existing)      │
            │                            │
            ▼                            │
        Phase 4 — Scheduler + digest      │
        (depends on skills + pod)         │
            │                            │
            ▼                            │
        Phase 5 — Polish + ship           │
```

**Sequential view (1 dev)**: Phase 0 → 1 → 2 → 3 → 4 → 5.
~5–6 weeks total at one dev's pace.

**Parallel view (2 devs)**: dev1 = Stream A (bridge + skills); dev2 =
Stream B (pod plumbing).  Both join at Phase 3.  ~3 weeks total.

**Parallel view (3 devs)**: as above, plus dev3 starts Phase 3 (LLM)
in parallel with dev1 finishing Phase 1 — using a stub skill set
until Stream A's skills land.  Then converges at Phase 4.  ~2 weeks.

---

## Phase 0 — Scaffold

**Goal**: an empty `apps/household/` workspace that builds, tests,
and runs a hello-world CLI.

**Files**:

```
apps/household/
  package.json                   # name: @canopy-app/household
  vitest.config.js
  README.md                      # one-page quick-start
  src/
    index.js                     # exports HouseholdAgent (empty for now)
    cli.js                       # `household serve` / `household help`
  test/
    smoke.test.js                # imports work, CLI exits 0
```

**Sequence**:

1. Create the workspace, mirror `apps/folio/package.json` shape.
2. Add `file:` deps on `@canopy/core` + `@canopy/pod-client`.
3. Vitest green with one smoke test.
4. CLI prints help and exits 0.

**DoD**:
- [ ] `npm install --prefix apps/household` succeeds.
- [ ] `npm test --prefix apps/household` passes (1 test).
- [ ] `npx household help` prints usage from `apps/household/`.
- [ ] No new top-level deps yet.

**Parallel sub-streams**: not really parallelizable — single task,
~half-day for one dev, no benefit to splitting.

**Parallel-readiness**: this phase MUST complete before either
phase-stream starts.

---

## Phase 1 — Stream A: Bridge + regex + skills

**Goal**: a Telegram bot that responds to structured commands
(`@household add bread`, `list shopping`, `done <id>`, `help`).
**No LLM yet, no pod yet** — items live in an in-memory store.
This is the smallest end-to-end demo: a real Telegram chat
exchanges messages with the bot.

**New top-level dep**: **`telegraf`** — needs explicit approval
(CLAUDE.md rule).  Per Q-H2.1 lock.

**Files**:

```
apps/household/
  src/
    HouseholdAgent.js            # registers skills, holds bridges, holds (later) pod
    bridges/
      MessagingBridge.js         # interface (jsdoc typedefs)
      TelegramBridge.js          # telegraf-backed implementation
      MockBridge.js              # test seam — emits scripted messages
    parsers/
      regexCommands.js           # Path 2 fast-path
      grammar.md                 # human-readable command spec
    skills/
      index.js
      addItem.js
      listOpen.js
      markComplete.js
      help.js
    storage/
      InMemoryStore.js           # placeholder; replaced in Phase 2 by pod-backed
  test/
    bridges/MessagingBridge.test.js
    bridges/TelegramBridge.test.js   # uses MockBridge for the test plumbing
    parsers/regexCommands.test.js
    skills/addItem.test.js
    skills/listOpen.test.js
    skills/markComplete.test.js
    e2e/round-trip.test.js       # MockBridge → agent → response
```

**Sequence**:

1. Define `MessagingBridge` interface (Q-H2.5 lock).  Pure jsdoc
   typedefs — no code, just the contract.
2. Build `MockBridge` — drives tests; emits scripted messages,
   records replies.
3. Build `regexCommands.js` — parses `add <type> <text>`,
   `list <type>`, `done <id|keyword>`, `help`, `what do we need?`.
   Returns `{ skillId, args }` or `null`.
4. Implement skills against `InMemoryStore`.  Each skill is a pure
   function: `(args, ctx) → { replies, stateUpdates }`.
5. Wire `HouseholdAgent` — receives messages from a bridge, runs the
   regex parser, dispatches to skill, returns replies.
6. Round-trip test using `MockBridge`.
7. Implement `TelegramBridge` against telegraf — both webhook +
   long-polling per Q-H2.3.
8. **User-attended check**: register a real Telegram bot, point it
   at a test chat, confirm round-trip.

**DoD**:
- [ ] `MessagingBridge` interface documented and tested via MockBridge.
- [ ] Regex parser handles all v0 commands (>15 unit tests).
- [ ] `addItem`, `listOpen`, `markComplete`, `help` skills tested
      individually.
- [ ] Round-trip test covers happy-path + parse-error + unknown-command.
- [ ] Real Telegram chat: `@household add bread` → bot replies
      `✓ added: bread`.  `list shopping` → bot returns the list.
      `done bread` → bot marks complete.
- [ ] Webhook AND long-polling deployments both verified.
- [ ] Existing apps' tests still green.

### Parallel sub-streams within Phase 1

After the foundation step, **four parallel streams** can run as
independent agents.  Each owns disjoint file paths — zero merge
conflicts at the filesystem level.

**Foundation (sequential, ~1 hour, single dev)**:
- Define `MessagingBridge` interface — `src/bridges/MessagingBridge.js`
  (jsdoc only).
- Define `Store` interface — `src/storage/Store.js` (jsdoc only).
- Define core types — `src/types.js` (jsdoc shapes for `Item`,
  `IncomingMessage`, `Reply`, `StateUpdate`, `Sender`).
- Lock the regex grammar — `src/parsers/grammar.md` (English +
  Dutch synonyms).

**Parallel streams (each = one agent, no overlap):**

| Stream | Files owned | Depends on foundation |
|---|---|---|
| **1a — MockBridge** | `src/bridges/MockBridge.js`, `test/bridges/MockBridge.test.js` | `MessagingBridge` interface |
| **1b — Regex parser** | `src/parsers/regexCommands.js`, `test/parsers/regexCommands.test.js` | grammar.md |
| **1c — TelegramBridge** | `src/bridges/TelegramBridge.js`, `test/bridges/TelegramBridge.test.js` | `MessagingBridge` interface, `telegraf` install |
| **1d — Skills + InMemoryStore** | `src/skills/*.js`, `src/storage/InMemoryStore.js`, `test/skills/*.test.js`, `test/storage/InMemoryStore.test.js` | `Store` interface, `Item` typedef |

**Convergence (sequential, single dev)**:
- Wire `HouseholdAgent` — `src/HouseholdAgent.js`.  Pulls in
  MockBridge (for default tests), regex (for routing), skills
  (for handlers), InMemoryStore (default storage).
- Round-trip test — `test/e2e/round-trip.test.js`.
- User-attended Telegram check — depends on 1c + the converged agent.

A small but important nuance: stream 1d (Skills) needs `MessagingBridge`'s
`Reply` shape from the foundation typedefs but doesn't *import* MockBridge
or TelegramBridge.  It returns `Reply` objects; the agent figures
out which bridge gets called.  No cross-stream import.

**Hand-off**: Stream B (Phase 2) can pick up from here once `Store`'s
interface lands (foundation step), not the entire phase.  Phase 2 is
genuinely concurrent with Phase 1's parallel streams 1a–1d.

---

## Phase 2 — Stream B: Hybrid pod plumbing

**Goal**: the three-pod hybrid pattern (bot pod / per-member pods /
shared household pod) with capability-token authorization.
**This is first-of-kind work for @canopy** — Folio and Archive
both ship single-pod patterns; H2 is the first hybrid.  Expect
fence-post discoveries.

**No new top-level deps** — uses `@canopy/core` + `@canopy/pod-client`.

**Files**:

```
apps/household/
  src/
    pods/
      HouseholdPod.js            # shared pod ops (groceries, errands, repairs, schedule)
      BotPod.js                  # bot's pod ops (config, audit, chat-meta, bot-token)
      MemberPod.js               # per-member pod ops (private items)
      HybridPodOrchestrator.js   # routes items to the right pod
      HybridPodStore.js          # implements the InMemoryStore interface
    identity/
      BotIdentity.js             # bot's keypair + audit-trail signing (Q-H2.13 lock)
      AdminCapability.js         # admin role → admin capability on bot's pod
      MemberWebIdMap.js          # @frits → webid resolution
    config.js                    # pod URLs, member webids, household group key id
  test/
    pods/HouseholdPod.test.js
    pods/BotPod.test.js
    pods/HybridPodOrchestrator.test.js
    identity/BotIdentity.test.js
    identity/AdminCapability.test.js
    e2e/hybrid-roundtrip.test.js
  docs/
    HYBRID-POD-NOTES.md          # trap-by-trap walkthrough as we discover them
```

**Sequence**:

1. **Bot identity setup** — generate keypair, persist via
   `@canopy/core` `Vault`.  Mint admin capability tokens for each
   household-admin webid (Track D primitive).
2. **HouseholdPod operations** — `addOpenItem`, `listOpenItems`,
   `markComplete`, `archive` (move to `done/yyyy-mm/`).  All
   encrypted-by-ACL via `@canopy/pod-client`.
3. **BotPod operations** — config, audit-log writes, chat-cursor
   reads/writes, bot-token storage in OAuthVault (Track F1).
4. **MemberPod operations** — read-only by default (the bot can
   query a member's pod via their capability token; can't write
   without a separate write capability).
5. **HybridPodOrchestrator** — given an item + intent, decides which
   pod it lands in.  Default routing:
   - `type='shopping'` → household pod (shared)
   - `type='errand'` with explicit assignee → member pod + reference
     in household pod
   - `type='repair'` → household pod
   - `type='schedule'` with assignee → member pod + reference
6. **HybridPodStore** — exposes the same interface `InMemoryStore`
   uses (so Phase 1's skills work unchanged).  Internally, calls
   into the orchestrator.
7. **Migration test** — swap `InMemoryStore` for `HybridPodStore` in
   `HouseholdAgent`; Phase 1's tests still pass.
8. **Real-pod validation** — point at an actual Solid pod (Inrupt or
   Community Server), exercise the full round-trip.  This is where
   the first-of-kind fence posts will surface.  Capture in
   `apps/household/docs/HYBRID-POD-NOTES.md` as we go.

**DoD**:
- [ ] Bot keypair persists across restarts.
- [ ] Capability tokens for each admin verified (Track D primitive).
- [ ] `HybridPodStore` passes the same tests as `InMemoryStore`.
- [ ] Real-pod round-trip works against an Inrupt-hosted pod.
- [ ] Bot's pod can be revoked + re-issued by a household admin
      (the coup-protection scenario).
- [ ] `HYBRID-POD-NOTES.md` exists, even if it's empty (it'll fill
      up as the pattern is exercised).

### Parallel sub-streams within Phase 2

**Foundation (sequential, single dev, ~half day)**:
- Lock the routing table — `programming-plan.md` already has the
  table; cross-check with the implementation as a doc commit.
- Define pod-layer types if they need to extend the core ones —
  `src/types.js` (extend the existing typedefs).

**Parallel streams (each = one agent):**

| Stream | Files owned | Depends on |
|---|---|---|
| **2a — Bot identity + admin caps** | `src/identity/BotIdentity.js`, `src/identity/AdminCapability.js`, `test/identity/*.test.js` | `@canopy/core` `Vault` + `CapabilityToken` |
| **2b — HouseholdPod** | `src/pods/HouseholdPod.js`, `test/pods/HouseholdPod.test.js` | `@canopy/pod-client` |
| **2c — BotPod** | `src/pods/BotPod.js`, `test/pods/BotPod.test.js` | `@canopy/pod-client`, OAuthVault (Track F1) |
| **2d — MemberPod + WebID map** | `src/pods/MemberPod.js`, `src/identity/MemberWebIdMap.js`, `test/pods/MemberPod.test.js`, `test/identity/MemberWebIdMap.test.js` | `@canopy/pod-client` |

**Convergence (sequential, single dev)**:
- Build `HybridPodOrchestrator` — `src/pods/HybridPodOrchestrator.js`.
  Pulls in 2b + 2c + 2d.
- Build `HybridPodStore` — `src/pods/HybridPodStore.js`.  Implements
  the `Store` interface from Phase 1 over the orchestrator.
- Migration test — swap `InMemoryStore` for `HybridPodStore` in
  `HouseholdAgent`; Phase 1's tests still pass.
- Real-pod validation — user-attended; capture findings in
  `apps/household/docs/HYBRID-POD-NOTES.md` as they surface.

**File-conflict note**: streams 2a–2d touch separate folders
(`identity/` and `pods/`).  The orchestrator + store pull them
together but only after streams converge.

---

## Phase 3 — LLM slow path

**Goal**: when regex doesn't parse, fall through to the LLM.  Local
Ollama + OpenAI-style tool calling (Q-H2.11 lock).  Cloud-LLM
opt-in via env var (Q-H2.12 lock).

**New top-level dep**: **possibly `ollama`** (the npm client) —
needs approval.  Alternative: raw `fetch` against
`http://localhost:11434/api/chat` (no new dep).  Lean: raw `fetch`
to avoid the dep.

**Files**:

```
apps/household/
  src/
    llm/
      LlmClient.js               # OpenAI-style tool calling; provider-agnostic
      providers/
        ollama.js                # local default (qwen2.5:3b-instruct)
        openai.js                # cloud opt-in (with privacy warning)
        anthropic.js             # cloud opt-in (ditto)
      prompts.js                 # system prompts, version-tracked
      audit.js                   # local audit log (writes to BotPod's audit/)
    skills/
      classifyAndExtract.js      # the LLM-mediated skill (Path 2 slow path)
  test/
    llm/LlmClient.test.js        # uses mock provider
    llm/audit.test.js
    skills/classifyAndExtract.test.js  # uses recorded LLM fixtures
    e2e/regex-then-llm.test.js   # full hybrid routing
  docs/
    LLM-PROMPTS.md               # prompts + their version + rationale
```

**Sequence**:

1. **LLM client** with OpenAI-style tool-calling.  Provider-agnostic
   (Ollama / OpenAI / Anthropic) — base URL + headers swap.
2. **Tool-catalog accessor on `SkillRegistry`** — small L0 SDK
   addition (already flagged in design doc).  Returns
   `[{ id, description, schema }]` for the LLM's tool list.
3. **Prompts** — system prompt for `classifyAndExtract`.  Version
   pinned (`PROMPT_VERSION = 1`) so we can regression-test against
   recorded fixtures.
4. **`classifyAndExtract` skill** — the slow path.  Calls the LLM
   with the agent's tools available.  LLM returns either a tool
   call (e.g. `addItem({ ... })`), structured JSON
   (`{classification: 'noise'}`), or a reply text.  Skill executes
   accordingly.
5. **Audit log** — every LLM call (input + output) logged to the
   bot's pod under `audit/yyyy-mm.jsonl`.  Encrypted.
6. **Hybrid routing in `HouseholdAgent`** — try regex first; if
   `null`, route to `classifyAndExtract`.  Already designed in the
   DESIGN doc.
7. **Cloud-opt-in plumbing** — env var `HOUSEHOLD_LLM_PROVIDER` +
   visible warning at startup if non-default.
8. **Quality-bar script** (Q-H2.9 lock) — `npm run quality-bar`
   takes 50 chat lines + expected extractions, runs them through
   the configured model, prints precision/recall.  Used at first
   deployment to confirm Dutch handling.

**DoD**:
- [ ] LLM client passes unit tests with mock provider.
- [ ] `classifyAndExtract` test using recorded Ollama fixtures.
- [ ] Hybrid routing test: structured command → regex; freeform → LLM.
- [ ] Local Ollama with `qwen2.5:3b-instruct` runs the slow path
      end-to-end on a real machine (user-attended).
- [ ] Cloud opt-in shows the warning prominently.
- [ ] LLM-unavailable fallback: bot replies "I couldn't parse
      that — try `add <type> <text>`?" when LLM is offline.
- [ ] Audit log appends to pod, encrypted.

### Parallel sub-streams within Phase 3

**Foundation (sequential, single dev, ~half day)**:
- Define LLM-related types — `src/types.js` extension
  (`ToolDescriptor`, `LlmInvocationResult`, etc.).
- Add tool-catalog accessor to `agent.skills` —
  `src/HouseholdAgent.js` (small extension).  This is shared with
  Stream 3a; lock the shape during foundation.

**Parallel streams (each = one agent):**

| Stream | Files owned | Depends on |
|---|---|---|
| **3a — LlmClient + providers** | `src/llm/LlmClient.js`, `src/llm/providers/{ollama,openai,anthropic}.js`, `test/llm/LlmClient.test.js` | LLM types from foundation |
| **3b — Prompts** | `src/llm/prompts.js`, `apps/household/docs/LLM-PROMPTS.md` | grammar.md (Phase 1), `Item` typedef |
| **3c — AuditLog** | `src/llm/audit.js`, `test/llm/audit.test.js` | BotPod (Phase 2) |
| **3d — Cloud opt-in plumbing** | `src/config.js` (extension), startup-warning logic in `src/cli.js` | nothing |

**Convergence (sequential, single dev)**:
- Build `classifyAndExtract` skill —
  `src/skills/classifyAndExtract.js`.  Pulls 3a + 3b + tool catalog.
- Wire hybrid routing into `HouseholdAgent` — when regex returns
  null, route to `classifyAndExtract`.
- Wire the audit log to LlmClient — every `invoke()` call logs
  via 3c.
- Quality-bar script — `apps/household/scripts/quality-bar.js`
  (manual run; Phase 5 formalises if needed).

**File-conflict note**: 3a–3d each own separate folders/files.  Only
the convergence step touches `HouseholdAgent.js` (and that's after
Phase 1's owner is done).

---

## Phase 4 — Scheduler + completion-loop

**Goal**: per-activity nudges (1 hr after items added — Q-H2.7) +
daily digest at 20:00 local (configurable per household — Q-H2.7).

**No new top-level deps** — Node's built-in `setTimeout` and
`setInterval` plus a small cron-ish helper for the daily slot.

**Files**:

```
apps/household/
  src/
    scheduler/
      NudgeTimer.js              # 1-hour-after-activity timer
      DailyDigest.js             # 20:00 local digest
      CronLite.js                # tiny interval-based scheduler
    skills/
      nudgeCompletion.js         # "what got done?" message
      composeDigest.js           # daily summary text
  test/
    scheduler/NudgeTimer.test.js   # uses fake timers
    scheduler/DailyDigest.test.js
    skills/nudgeCompletion.test.js
    skills/composeDigest.test.js
```

**Sequence**:

1. **NudgeTimer** — when an item is added, schedule a 1-hour timer.
   When it fires, post `nudgeCompletion` to the chat where the item
   was added.  Reset on activity.  Configurable per household via
   `/household/config.json`.
2. **DailyDigest** — runs at 20:00 local (each household's
   timezone).  Composes a summary: open items, items completed
   today, anything that's been open >7 days.  Posts to the
   household's primary chat.
3. **Wire into `HouseholdAgent`** — items added trigger
   `NudgeTimer.schedule()`.  Items completed trigger
   `NudgeTimer.cancel()`.  Daily digest is timezone-driven.

**DoD**:
- [ ] Nudge fires 1 hour after `addItem`, unless `markComplete`
      cancels it first.
- [ ] Daily digest posts at the configured local time.
- [ ] Both are configurable per household via the config skill.
- [ ] Test uses fake timers (vitest's `vi.useFakeTimers()`).

### Parallel sub-streams within Phase 4

**Foundation (sequential, single dev, ~hour)**:
- Lock the `StateUpdate` shape (already in types.js); confirm the
  scheduler subscribes via the agent's event surface, not via a
  direct skill import.
- Decide the timezone resolution — household config carries `tz`
  string (`Europe/Amsterdam`); document.

**Parallel streams (each = one agent):**

| Stream | Files owned | Depends on |
|---|---|---|
| **4a — NudgeTimer** | `src/scheduler/NudgeTimer.js`, `test/scheduler/NudgeTimer.test.js` | Phase 1's `Store` + agent events |
| **4b — DailyDigest** | `src/scheduler/DailyDigest.js`, `test/scheduler/DailyDigest.test.js` | Phase 1's `Store` + agent events, Phase 2's HouseholdPod |
| **4c — CronLite (timezone helper)** | `src/scheduler/CronLite.js`, `test/scheduler/CronLite.test.js` | nothing (pure JS) |
| **4d — nudgeCompletion skill** | `src/skills/nudgeCompletion.js`, `test/skills/nudgeCompletion.test.js` | Phase 1's `Store`, `Reply` typedef |
| **4e — composeDigest skill** | `src/skills/composeDigest.js`, `test/skills/composeDigest.test.js` | Phase 1's `Store` + Phase 2's HouseholdPod |

**Convergence (sequential, single dev)**:
- Wire the scheduler into `HouseholdAgent` — `addItem` triggers
  `NudgeTimer.schedule()`; `markComplete` triggers `cancel()`;
  `DailyDigest` is a long-running background job.
- E2E scheduler test under fake timers.

**File-conflict note**: 4a–4e each own separate files.  Only the
convergence step touches `HouseholdAgent.js`.

---

## Phase 5 — Polish + ship

**Goal**: production-readiness.  Audit logs, capability rotation,
multi-language quality verification, deployment story, docs.

**No new top-level deps**.

**Files**:

```
apps/household/
  src/
    cli.js                       # extend: install-service, init, doctor
    install-service/
      systemd.js                 # systemd unit for Linux
      launchd.js                 # launchd plist for macOS
  README.md                      # full quick-start + deployment guide
  docs/
    DEPLOYMENT.md                # private-server setup, wake-on-LAN, etc.
    HYBRID-POD-NOTES.md          # finalised
    LLM-PROMPTS.md               # finalised
```

**Sequence**:

1. CLI commands: `household init` (set up config + bot keypair +
   admin capabilities), `household serve` (run the agent),
   `household doctor` (sanity-check config, pod connectivity, LLM
   reachability), `household install-service` (deploy as systemd /
   launchd unit — same pattern as `folio install-service`).
2. Capability rotation flow — admin command to issue new admin
   tokens, revoke old ones.  Documented + tested.
3. Quality-bar script run against real chat data.  Document model
   choice + precision/recall numbers in `docs/`.
4. README: one-page quick-start.  DEPLOYMENT.md: production setup
   (private server, wake-on-LAN auto-suspend, co-host with pod).
5. Final audit: error handling, retries, graceful shutdown
   (SIGINT / SIGTERM, mirroring the `folio serve` Ctrl-C fix from
   commit `f40086e`).

**DoD ("v0 ships")**:
- [ ] `household init` produces a working config end-to-end.
- [ ] `household serve` runs the agent; SIGINT shuts down cleanly
      within 4s (same target as Folio v2.12).
- [ ] `household install-service` works on Linux (systemd) — macOS
      verified or explicitly punted.
- [ ] `household doctor` catches the common misconfigurations.
- [ ] Quality-bar script result documented.
- [ ] README + DEPLOYMENT.md sufficient for a new user to run H2 on
      their own server.
- [ ] All 14 design questions still match implementation.
- [ ] Folio + Archive tests still green (sanity check; H2 doesn't
      touch them but lints across the monorepo).

### Parallel sub-streams within Phase 5

This phase is **almost entirely parallelisable** — most items don't
share files.  Six streams can run simultaneously.

**Foundation (sequential, ~hour)**:
- Decide CLI command surface: `init` / `serve` / `doctor` /
  `install-service` / `help`.  Lock subcommand names + flags.

**Parallel streams (each = one agent):**

| Stream | Files owned | Depends on |
|---|---|---|
| **5a — CLI** | `src/cli.js`, `test/cli.test.js` | All earlier phases (calls into them) |
| **5b — install-service Linux** | `src/install-service/systemd.js`, `test/install-service/systemd.test.js` | nothing |
| **5c — install-service macOS** | `src/install-service/launchd.js`, `test/install-service/launchd.test.js` | nothing |
| **5d — Capability rotation flow** | `src/identity/AdminCapability.js` (extend), `test/identity/AdminCapability.rotate.test.js` | Phase 2 |
| **5e — Quality-bar formal harness** | `apps/household/scripts/quality-bar.js`, `apps/household/test/fixtures/chat-50.json` | Phase 3 |
| **5f — Docs** | `apps/household/README.md`, `apps/household/docs/DEPLOYMENT.md`, `apps/household/docs/HYBRID-POD-NOTES.md` (finalise), `apps/household/docs/LLM-PROMPTS.md` (finalise) | All other phases (writes about them) |

**Convergence (sequential, single dev)**:
- Final integration test against a real Telegram + real pod + local
  Ollama on a real always-on machine.
- Graceful shutdown audit — confirm Folio v2.12-style
  `closeAllConnections` + 4s safety-net is present in the agent's
  `serveCmd`.
- Sanity: Folio + Archive tests still green.

**File-conflict note**: 5d touches `AdminCapability.js` which is
2a's territory.  By Phase 5 that file's owner has handed off, but
flag this in the team chat to avoid surprise edits.

---

## Test strategy (cross-cutting)

- **Unit tests** for every module via vitest.
- **Mock everything external**: `MockBridge` for messaging;
  recorded LLM fixtures for prompts; `FsBackedMockPodClient` (the
  Folio pattern from `apps/folio-mobile/`) for pod ops.
- **Real-Telegram integration test** gated behind
  `HOUSEHOLD_TEST_REAL_TG=1` + a test bot token.  Like Folio's
  `FOLIO_TEST_MOCK_POD=1` flag — explicit opt-in.
- **Real-pod integration test** likewise gated behind
  `HOUSEHOLD_TEST_REAL_POD=1`.
- **Snapshot LLM outputs** for prompt regression tests — record once,
  re-record manually when prompts change.

---

## Compatibility checks (explicit, per phase)

| Phase | Compatibility check |
|---|---|
| 0 | New workspace; no existing-app changes; cross-app `npm test` should still pass. |
| 1 | New telegraf dep — confirm with user before install (CLAUDE.md rule).  No SDK changes. |
| 2 | New `BotIdentity` + `AdminCapability` — built atop existing `@canopy/core` `Vault` + Track D primitives.  No SDK changes; surface tightening optional. |
| 3 | Tool-catalog accessor on `SkillRegistry` is a small L0 SDK addition — needs a separate PR to `@canopy/core` if we want it shared.  Alternative: app-level for v0, promote later. |
| 4 | No SDK changes. |
| 5 | `install-service` mirrors Folio's pattern.  No SDK changes. |

**Net**: H2 v0 can ship without any changes to `@canopy/core` or
`@canopy/pod-client` if we keep the tool-catalog accessor app-level.
That's the conservative path; the design doc already noted L1
promotion as a "when a second consumer arrives" decision.  H3
(conversational household assistant) will be the second consumer.

---

## Hand-off triggers (between phases)

| When this completes | What it unblocks |
|---|---|
| **Phase 0** | Either stream can start. |
| **Phase 1** | Real Telegram chat works.  Stream B can swap in for `InMemoryStore`. |
| **Phase 2** | Hybrid pod is real.  Phase 3 has a place to write audit logs. |
| **Phase 3** | LLM slow path works.  H2 is the "first @canopy app where the LLM is the agent's intelligence" claim becomes true. |
| **Phase 4** | Production-grade UX (nudges + digest). |
| **Phase 5** | "v0 ships" — first real household deployment. |

---

## Loose ends (for the planner to track)

These belong in the implementation conversation but I want them
visible so they don't surprise mid-phase:

- **Member ↔ webid mapping** — how does the bot know `@frits`
  (Telegram) is `https://id.inrupt.com/frits` (webid)?  V0: explicit
  mapping during the bot's onboarding DM with each member, stored
  in `/household/config.json`.  Belongs to Phase 2 implementation.
- **New-member onboarding** — when someone is added to the chat,
  the bot DMs them with a sign-in flow that mints a household
  membership proof.  Belongs to Phase 5 polish.
- **Group key rotation on member-leave** — Track A + D primitive.
  H2's UX surfaces "remove member" → triggers rotation.  Phase 5.
- **Bot-inactivity handling** — Bridge agent should queue messages
  if the LLM is offline AND the regex didn't match.  Bounded queue
  with exponential backoff.  Belongs to Phase 3.
- **Twist 1 — bot mints membership proofs.**  The "bot is a member,
  not a feature" framing implies the bot can issue proofs (Track D's
  `coordinator` role).  Belongs to Phase 2 (identity wiring).
- **Telegram `privacy mode` setting.**  With Q-H2.4 locked
  (addressed-only), the bot only needs `privacy mode ON` (default).
  Document in `DEPLOYMENT.md`.
- **First-of-kind hybrid pod** — expect fence-post discoveries
  during Phase 2.  Capture in `apps/household/docs/HYBRID-POD-NOTES.md`
  as they surface — same approach as
  `apps/folio-mobile/docs/SOLID-RN-NOTES.md`.
