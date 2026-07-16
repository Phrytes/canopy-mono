# Changelog — @onderling/chat-agent

Versioning per `Project Files/Substrates/policies.md`.

## [0.3.1] — 2026-05-03

### Fixed

- **`TelegramBridge` now exposes the `id` getter required by the
  `MessagingBridge` contract** (returns `'telegram'`).  Previously
  only exposed `bridgeId` — which means
  `ChatAgent.#sendReply`'s lookup
  (`this.#bridges.find((b) => b.id === msg.bridgeId)`) silently
  returned `undefined`, the reply path emitted an
  `error` event ("no bridge for bridgeId=telegram"), and nothing
  reached Telegram.  Bug surfaced when an experimental free-text
  bot composed `ChatAgent` directly with `TelegramBridge` (rather
  than going through `HouseholdAgent`, which has its own all-bridges
  dispatch path that didn't depend on the `id` lookup).

- **`bridgeId` getter retained for back-compat** but marked
  `@deprecated`.  Slated for removal in v0.4.  Existing callers
  (notably `apps/household/test/bridges/*`) keep working.

## [0.3.0] — 2026-05-02

Plan B sub-task B.4 — Household consumes ChatAgent for the LLM slow path.

### Changed (small, additive)

- **`bridges` is now optional** — pass `null`/`[]` to construct a
  ChatAgent in *headless mode*.  In headless mode, `start()`/`stop()`
  are no-ops; the only useful entry point is `processMessage`.  This
  is the composition pattern Household uses: HouseholdAgent owns the
  bridges + the regex fast path; ChatAgent runs only the LLM slow
  path via direct `processMessage` calls.
- **New public method `processMessage(msg)`** — runs the LLM-with-tools
  pipeline against a message and returns
  `{replies: Array<{text, buttons?}>, toolResults: Array<object>}`
  WITHOUT sending replies to a bridge.  The internal `#onMessage`
  bridge handler now delegates to `processMessage` then forwards the
  resulting messages to the bridge.
- **Tool replies are sent as separate bridge messages** — each tool's
  reply lands as its own `bridge.sendReply` call so per-reply buttons
  + metadata survive.  Apps that want one consolidated reply can join
  texts at the tool-handler layer.
- **Tool result shape extended** — handlers may return:
  - `{reply: 'string'}` (legacy — still works)
  - `{replies: Array<{text, buttons?}>}` (preferred)
  - `{reply: {text, buttons?}}` (forward-compat)
  - and `{data}` for structured side-channel data (Household uses this
    to forward `stateUpdates` to the scheduler).

### Validation

`apps/household` (398 tests) now routes its LLM slow path through
`ChatAgent.processMessage` in headless mode.  Test count stays 398;
behaviour unchanged from the user's perspective.  Substrate tests
went 14 → 15 (added headless-mode test).

## [0.2.0] — 2026-05-02

Plan B sub-task B.5 — closes the long-standing TelegramBridge gap (Task #12).

### Added

- **`TelegramBridge`** at `./bridges/telegram` — telegraf-backed implementation of `MessagingBridge`.  Moved from `apps/household/src/bridges/TelegramBridge.js` (real-bot tested, 396 LOC).  Features: addressed-only filter (Q-H2.4), button-tap → IncomingMessage synthesis, webhook + long-polling modes (Q-H2.3), graceful shutdown.
- **`telegraf`** added as optional peer-dependency.  Apps that consume TelegramBridge install telegraf themselves; apps using only InMemoryBridge / a custom bridge don't pay the cost.

### Validation

`apps/household` now imports TelegramBridge through the substrate via a re-export shim.  398/398 household tests pass.  The bridge has historic real-bot validation (the user's bench Android phone has used it).

## [0.1.0] — 2026-05-02

Initial release.  L1c substrate (Phase B step 3 of the substrate-first plan).

### Added

- **`ChatAgent`** core class — receives messages from `MessagingBridge`s, maintains per-chat session, builds NL context once per session, dispatches tool calls, posts replies.
- **`MessagingBridge`** interface — defined.  Apps implement one per messaging platform.
- **`InMemoryBridge`** — for tests and headless scenarios.
- **`SessionManager`** — per-chat session state with TTL eviction.
- Multi-tool-call dispatch in one LLM response.
- Events: `tool-call`, `reply`, `error`.
- `agent.dispatch(chatId, text)` for outbound delivery (notifier hook).

### Tests

14 Vitest tests covering: lifecycle, message handling, single + multi tool dispatch, session TTL + context-rebuild, member resolution, outbound dispatch.

### Pattern source

Generalised from `apps/household/src/{HouseholdAgent.js, bridges/TelegramBridge.js, skills/classifyAndExtract.js}`.  Differences from V0 noted in README.

### Known gaps (V1+ / next session)

- **TelegramBridge** (Task #12) — needs real-bot test environment.
- **SignalBridge / MatrixBridge** — when a real consumer demands.
- Restart-survival of session state.
- Streaming LLM responses.
