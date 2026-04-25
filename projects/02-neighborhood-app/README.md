# 02 — Neighborhood app: gated relay + skill matchmaking

**Use-case section:** [`../../USE CASES.md` § 2](../../USE%20CASES.md#2-gated-relay--neighborhood-skill-matchmaking-with-anonymity)
**Status:** pass-3 design.  Anonymity protocol is **parked** —
the author has thoughts to share.  The non-anonymity parts of #2
overlap heavily with use case #4 (skill matchmaking, push
notifications, group governance) and will be designed together.

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
