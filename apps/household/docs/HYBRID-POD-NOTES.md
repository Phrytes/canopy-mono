# Hybrid pod — implementation notes

H2 ships the @onderling project's first **hybrid pod** pattern: three
pods (per-member / per-bot / shared household) cooperating via
references and capability tokens.

This file is the trap-by-trap walkthrough of what we discovered
while implementing it.  Modelled after `apps/folio-mobile/docs/SOLID-RN-NOTES.md`.
Read this BEFORE Archive Phase E or any other future RN-on-Solid
hybrid-pod work — every trap here is generalisable.

**Status (2026-04-30):** Phase 2 foundation committed; pod
implementations + orchestrator land per the implementation plan.
This doc is intentionally empty until the first real-pod run
surfaces something.

---

## Reading order if you're picking this up cold

1. `Project Files/coding-plans/track-H-app-household.md` § "Pod
   schema → Hybrid pod from v0 (Q-H2.6 lock)" — the design.
2. `Project Files/projects/07-household-app/programming-plan.md` §
   "pods/HybridPodOrchestrator.js" — the routing table + module
   contracts.
3. `apps/household/src/pods/routingTable.js` — the routing rules as
   pure data.
4. This file (you're here).

---

## Pre-emptive notes (locked from the design pass)

These aren't fence-post discoveries — they're things we already
know to do before they bite.

### Bot identity ≠ bot process (Q-H2.13 lock)

The bot has its own keypair (audit-trail-distinguishable from human
members), but it lives **in the same Node process** as the
HouseholdAgent.  Two cryptographic identities (bot + acting-on-behalf-of
each human member) inside one runtime.  Don't conflate process
boundaries with identity boundaries.

### Capability tokens are the admin handle on the bot's pod

Bot's pod root credential = bot's keypair.  Every household-admin
webid (Track D `admin` role) holds a capability token granting
admin powers on the bot's pod.  If the bot misbehaves, any human
admin can revoke + re-issue without touching the bot's keypair
directly.

### Per-pod encryption keys

- Per-member pod → member's own encryption key.
- Bot's pod → bot's own encryption key + admin capability tokens.
- Shared household pod → household group key (rotates on member-leave).

Each pod holds bytes encrypted-by-ACL.  Cross-pod listings
(orchestrator-merged) require the agent to hold the right keys for
each pod it reads from — typically all three for a household-admin
deployment.

---

## Open expectations (will fill in as we discover)

Things we expect to hit during Phase 2 but haven't yet:

- **Cross-pod listing latency.**  A "list everything open" query
  hits the household pod + N member pods.  Likely needs caching
  in v0 if N is large.
- **Reference staleness.**  Household pod has refs into member
  pods; if a member completes / removes an item from their own
  pod, the household ref points at nothing.  Resolution policy:
  the orchestrator's read path treats a 404 on ref-resolve as
  "completed" (best-effort consistency).
- **Group-key rotation midstream.**  When a member leaves and the
  household group key rotates, in-flight writes might still encrypt
  to the old key.  Likely needs a brief drain window during
  rotation.
- **First-time admin onboarding.**  Generating the bot's keypair
  on first `household init`, minting capabilities for each admin,
  storing them.  The "happy path" is straightforward; the "what
  happens when admin's webid is wrong" path needs an explicit
  retry.

When any of these surface as a real problem, document the
discovery here with a short "Trap X — symptom / cause / fix"
section.
