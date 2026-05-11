# 02 — Neighborhood app: gated relay + skill matchmaking

> **2026-05-06 update:** the design captured in this folder has shipped
> as `apps/stoop` (V2 of what was `apps/neighborhood-v0`). Active
> design + coding work has moved to
> [`Project Files/Stoop/`](../../Stoop/) — see
> [`advice-2026-05-05.md`](../../Stoop/advice-2026-05-05.md) and
> [`coding-plan-v1-2026-05-05.md`](../../Stoop/coding-plan-v1-2026-05-05.md).
> This folder kept for historical context (anonymity-parked decision,
> open questions, V0 scope record).

**Use-case section:** [`../../USE CASES.md` § 2](../../USE%20CASES.md#2-gated-relay--neighborhood-skill-matchmaking-with-anonymity)
**Status:** pass-3 design.  Anonymity protocol is **parked** —
the author has thoughts to share.  The non-anonymity parts of #2
overlap heavily with use case #4 (skill matchmaking, push
notifications, group governance) and will be designed together.

**In het kort**
- je wilt een server waar gebruikers de buurt kunnen querieen
- dit gaat om taakjes of spullen of wat dan ook
- iedereen heeft een model van de anderen lokaal (opgehaald via relay)
- op basis hiervan kan de agent zelf filteren, eventueel ondersteund met een llm die dan weer ergens draait
- dan worden verzoekjes verzonden naar de relevante geselecteerden
- dan begint de onderhandeling en evt toewijzing

## In one paragraph

A relay you can only join by invitation (closed network — your
block, your building, your sports club).  Each member runs an
agent on their phone.  Members can broadcast a question tagged
with one or more skills; matching members get a notification
asking whether they want to respond.  Skills can be machine
skills (auto-callable) or human skills (the human gets a prompt).
Browsing skills and being listed are anonymous-by-default;
identity reveal is a two-sided handshake.  An agent can belong
to multiple groups (block + sports club + family) — matchmaking
is per-group.

## Resolved (pass 2)

- **Both broadcast forms** are needed: interactive prompts (for
  negotiable / human skills) AND direct skill calls (for
  always-callable / machine skills).  Per-skill posture flag.
- **Human skills are first-class.**  Skill registration must
  carry `humanInTheLoop: true`.  Browsing UI surfaces this so
  requesters know what to expect.

## Resolved (pass 3)

- **Anonymity model parked.**  Open until the author shares input on:
  relay correlation power, governance shape (operator /
  invite-link / web-of-trust), abuse-tracing tradeoff.
- **Skill clustering** (technical / human / app-related) raised
  by the author as a possible taxonomy axis on top of the posture
  flag.  Useful for browsing UI ("show me only humans-with-bike-
  skills").  Still to be designed.

## Open questions

1. **Anonymity protocol** (parked): who issues handles, how
   reveal is mutually verified, what cryptography prevents the
   relay from correlating before reveal.
2. **Closed-group governance**: operator / invite-link / web-of-
   trust?
3. **Notification UX**: interactive prompts mean the receiver's
   agent has to wake the user — implies mobile push (APNs/FCM)
   bridge.  Acceptable infra cost?
4. **Persistence of unanswered requests**: relay-side queue with
   multi-recipient fan-out / fan-in.
5. **Spam, abuse-tracing, "graceful identity reveal"**: explicit
   policy needed.
6. What llm to use for skills - request matching? see [[LOCAL LLM OVERVIEW]]

## What this app needs that the SDK doesn't have today

(L0 / L1 work — shared with #4 unless marked otherwise.)

- **Skill posture flag** (`always` / `negotiable` +
  `humanInTheLoop`) — L0, shared with #4.
- **Pubsub-of-skills primitive** — L0, shared with #4.
- **Mobile push (APNs/FCM) bridge** — L0, shared with #4.
- **Closed-group membership with invitation governance** at the
  relay — L0, partial overlap with #4 (groups as a concept).
- **Skill taxonomy** (technical / human / app-related) — L0,
  shared with #4 and possibly #1.
- **Anonymous discovery + bilateral identity reveal** — L0,
  unique to #2 (parked).

L2 (purely app-level for the neighborhood app):

- Onboarding flow for invite codes.
- Anonymous skill browsing UI.
- Negotiation flow for negotiable skills.
- Group switcher for users in multiple groups.

## Cross-app substrate compatibility (added 2026-05-07)

Tasks V1 introduced or flagged several substrate movements that
Stoop should track for forward-compat. None require code changes
in Stoop today; all are heads-up so the next Stoop pass picks
them up cleanly.

- **Canonical user-skills profile at `<user-pod>/profile/skills.json`.**
  Stoop V2 already lets a user list skills per group. Tasks V1
  expects to **import the user's skills from their canonical
  profile via a prefilled, editable form** (instead of typing
  fresh per app). Stoop should adopt the same pattern: when a
  user adds skills to a Stoop group, prefill from
  `<user-pod>/profile/skills.json` with an "edit before submit"
  step, and offer to write new skills back to the canonical
  profile (default OFF for added, ON for edits). The intersection
  with the *group* skill vocabulary is the rendered list. Same
  shape across Tasks / Stoop / Household / future skill-shaped
  apps.
- **Approval / DoD lifecycle on `item-store`.** Stoop's lend-
  return flow (V1.5+) likely wants a "lender confirms returned
  intact" approval step. Tasks V1 lands `submitted` + `rejected`
  states + `definitionOfDone` / `approval` / `deliverable` /
  `master` / `parentTaskId` fields on `item-store` — Stoop can
  reuse these without further substrate work.
- **`InAppInboxChannel`.** Tasks V1 ships an in-app inbox channel
  on `@canopy/notifier` (notifications without push). Stoop
  can adopt it as a non-push surface where the calmness story
  matters.
- **`PushPolicy` promotion.** Stoop authored `PushPolicy` (≤ 3
  per day, batching, quiet hours). Tasks is the second consumer;
  the candidate gets promoted into `@canopy/notifier` once the
  relay-side push lands as production-grade. No action for Stoop
  beyond accepting the eventual API location change.
- **Calendar adapter (V1.5).** Tasks V1 ships an iCal read +
  `getFreeBusy` skill. Stoop V2's "share my agenda" Settings
  toggle is the natural second consumer.
- **Pod-data-sharing caution.** Each cross-pod read needs an
  explicit per-context opt-in; carry the same caution principles
  documented in
  [`../04-tasks-app/README.md`](../04-tasks-app/README.md) §
  *Pod-data sharing*.

## Related work in the repo

- `packages/core/src/protocol/pubSub.js` — existing pub/sub;
  potential foundation for the pubsub-of-skills primitive.
- `packages/core/src/security/sealedForward.js` — existing
  blind-bridge primitive; closest analogue to anonymity model
  (but does NOT hide identity, only content).
- `packages/relay/` — needs invite-only auth (already on the
  production-relay roadmap in TODO-GENERAL.md).
- `Design-v3/anonymous-marketplace.md` — to-be-written when the
  anonymity model unparks.
