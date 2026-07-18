# Changelog — @onderling/skill-match

## [0.1.0] — 2026-05-02

L1e substrate — initial release.

- `SkillMatch` core class — `broadcast` (requester) + `subscribe` (responder).
- Posture flag: `always` / `negotiable` / `never` per skill.
- `InMemoryTransport` for V0 + tests.
- Group-scoped topic isolation.
- 7 Vitest tests.

Pattern source: `packages/core/src/protocol/pubSub.js` + Track D's
SkillsPubSub plan + H4/H5/H8 design docs.

V1+ deferred:
- Relay-backed transport (depends on Track A's SkillsPubSub).
- mDNS / BLE local-network transport.
- Anonymity protocol (Q-H5 parked).
- Persistence of unanswered requests (Track E2b).
- Anti-spam / rate limiting.
- Skill-embedding fuzzy match.
