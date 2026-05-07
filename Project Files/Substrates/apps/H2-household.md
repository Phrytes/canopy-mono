# H2 (household) — household assistant via Telegram DM

| | |
|---|---|
| **Status** | V1 shipped + substrate migration (hybrid mode) shipped 2026-05-02. V2 architecture pivot (drop regex, all-LLM, 1:1 DM proper) **deferred** by design. |
| **Code** | `apps/household` |
| **Tests** | 398 |
| **Source notes** | `projects/07-household-app/README.md`, `coding-plans/track-H-app-household.md` (V1 — group-chat), `coding-plans/track-H-app-household-v2.md` (V2 — 1:1 DM) |
| **App name** | TBD — placeholder: Hearth / Stoel / Bord / Telex |

---

## Current state

**V1 shipped** — Telegram bridge (group + DM modes), regex fast path, LLM slow path with `classifyAndExtract` skill, daily digest, nudges, hybrid pod (per-bot + shared household), bot-as-its-own-keypair attribution.

**Substrate migration shipped (2026-05-02 — hybrid mode)**:
- `HouseholdAgent` constructs a headless `ChatAgent` (`@canopy/chat-agent` v0.3) when `llm` is configured. Skills are wrapped as ChatAgent tool handlers via `src/llm/chatAgentBridge.js`.
- The regex fast path stays in `HouseholdAgent.#routeMessage`; on regex miss, control hands off to `chatAgent.processMessage(msg)`.
- `stateUpdates` (used by the scheduler for nudges) flow back through the toolResult `data` channel.
- `classifyAndExtract` is no longer called from the agent's main path but stays in the skill registry for back-compat / external invocation.
- Substrate gained `processMessage(msg)` public method, headless mode (no bridges), and richer `ToolResult` shape (replies-with-buttons + structured `data`) — see `packages/chat-agent/CHANGELOG.md` 0.3.0.

**Substrate consumption today**:

| Layer | Used? |
|---|---|
| L1b (item-store) | ✓ via `apps/household/src/storage/InMemoryStore.js` adapter |
| L1c (chat-agent) | ✓ headless mode, LLM path only |
| L1f (notifier) | ✓ `DailyDigest.js` thin wrapper over `nextDailyFireInTz` |
| L1j (llm-client) | ✓ `LlmClient.js` re-exports |

Not yet wired: L1g (oauth-vault) for the bot-token slot, L1h (identity-resolver) for member-webid mapping (Household has its own `MemberWebIdMap`).

---

## Open work

### V2 architecture pivot (deferred by design)
The V2 spec called for: drop regex, all-LLM dispatch, multi-session 1:1 DM proper. The hybrid migration we shipped is option (iii) from the migration discussion — minimal blast radius, regex stays. Full V2 would require:
- Delete `parsers/regexCommands.js` + its tests (~regex layer goes away).
- Remove the regex branch from `HouseholdAgent.#routeMessage` — every message becomes an LLM call.
- Real-LLM e2e tests rewrite (4 e2e files currently exercise both paths).
- Per-member 1:1 chat session model — already supported by ChatAgent's session manager; just need to verify the Telegram bridge surfaces per-DM `chatId` correctly.

Estimate: ~1 session of work + LLM availability for testing. Behavioural change.

### V1+ scope (per original sketch — unchanged)
- Signal / Matrix DM bridges (additional `MessagingBridge` implementations in `@canopy/chat-agent`).
- Group-chat adapter as overlay (translates group `@mention` into per-member sessions).
- Calendar bidirectional sync (Track-J style).
- Voice messages (Whisper transcription).
- Multi-household per agent.
- Photo / file attachments.
- LLM ramp-up to H3 capabilities (proactive scheduling, voice personality, yearbook).

### Substrate-side polish that would help H2
- **L1c `contextBuilder` for NL pod-state** — Household passes `noopContextBuilder` today. The H2 V2 spec calls for "Boodschappen: ... / Klusjes: ..." snapshot prepended to the system prompt. Would let the LLM see open items at session start.
- **L1f `scheduleCallback({triggerAt, callback, cancelKey?})` primitive** — Household's scheduler currently builds on the `Notifier` channel/recipient/builder pattern, which is heavier than needed. A lighter callback primitive was flagged during the B.3 work.
- **L1g (oauth-vault) wiring** — Household's bot-token slot still uses ad-hoc storage. Migrating to `@canopy/oauth-vault` closes the original H2 design intent.
- **L1h (identity-resolver) wiring** — replace `MemberWebIdMap` with the substrate equivalent.

---

## Pod schema (unchanged from V2 design)

```
─── per-member pod (read-only to others) ───────
  /private/
    errands.json               # member-personal errands

─── per-bot pod (admin = household admins) ─────
  /bot/
    config.json
    audit/yyyy-mm.jsonl
    chat-meta/<chatId>/cursor.json
    bot-token.enc              # consumed by L1g (V1+)

─── shared household pod ────────────────────────
  /household/
    config.json                # members, member-webid map (consumed by L1h V1+)
    open/<ulid>.json           # all items (type field; consumed by L1b)
    closed/yyyy-mm/<ulid>.json
    audit/yyyy-mm.jsonl
```

---

## Locked decisions (Q-H2.x — carried over)

All Q-H2.1–14 from the V1 design carry over (telegraf, both deployment modes, hybrid pod, own keypair, OpenAI-style tool-calling, opt-in cloud LLM, etc.). V2-specific Q-H2.15–21 (NL-context format, session TTL, id-token format, multi-tool-call handling, default LLM, LLM-offline fallback, member-webid mapping) are partly answered by ChatAgent's defaults; the rest become live decisions if the V2 pivot proceeds.
