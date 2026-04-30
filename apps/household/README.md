# @canopy-app/household

Household app — H2.  Telegram-driven, optionally LLM-mediated
household state on a Solid pod.

**Status**: scaffold + Phase 1 in progress.  Not usable yet.

## Plan documents

- [`../../Project Files/projects/07-household-app/README.md`](../../Project%20Files/projects/07-household-app/README.md) — L2 design notes
- [`../../Project Files/projects/07-household-app/implementation-plan.md`](../../Project%20Files/projects/07-household-app/implementation-plan.md) — phased rollout, parallel streams
- [`../../Project Files/projects/07-household-app/programming-plan.md`](../../Project%20Files/projects/07-household-app/programming-plan.md) — code design / module map
- [`../../Project Files/coding-plans/track-H-app-household.md`](../../Project%20Files/coding-plans/track-H-app-household.md) — cross-track design doc with all 14 design questions locked

## Quick start (when usable)

```bash
npm install --prefix apps/household
npm test    --prefix apps/household
```

## Why a separate app

H2 is a chat-driven, optionally-LLM-mediated agent — a different
shape from Folio (notes-folder ↔ pod sync) and Archive (FTS5 over
pod content).  Shares `@canopy/core` + `@canopy/pod-client` with
the others; adds `telegraf` (Q-H2.1 lock) for Telegram, and an
optional Ollama / cloud LLM provider (Q-H2.12 lock).
