# DESIGN — the verify-summary loop (own-pod-first, user-verified release to central)

*Status: DESIGN → BUILDING (Slice 1). Set 2026-06-25 (Frits + Claude). This is the original feedback-app
plan, made concrete after a live audit + headless runs proved the rest of the pipeline works. It inverts the
currently-built directionality into a stronger privacy model.*

---

## 0. Why (the inversion)

The pipeline as built today does: **contribute → consent → raw cleaned points written to the CENTRAL pod →
curator aggregates → participant notified after**. The summary lives curator-side and post-hoc; the participant
never verifies what represents them before it leaves.

The original plan (this doc) flips it:

```
Stage 1 — CONTRIBUTE (anytime)
          raw feedback → the USER's OWN pod (sealed + signed). It NEVER leaves the user's pod.

Stage 2 — VERIFY-SUMMARY (opened by the project lead)
          lead opens a "verification round" for the project
       → the user's OWN bot summarises the user's OWN-pod points ON-DEVICE (LLM via the loopback
         Privatemode proxy — the confidential path, validated working 2026-06-25)
       → bot shows: the summary  +  "see what changed" (raw vs curated, the existing `compare` skill)
       → user VERIFIES / edits / withdraws
       → ONLY the user-VERIFIED SUMMARY → the CENTRAL pod (sealed + signed). Raw is never included.
```

**Privacy win:** the central pod only ever holds **user-verified summaries**, never raw text; the summary is
generated **on the user's device** through the confidential proxy, so raw never exposes to any host; and the
**user is the gatekeeper of their own representation** before anything goes central. The lead can *request* a
verification, not *extract* — only the user's bot can produce + release the summary.

---

## 1. Bot state machine (extends `channel/dispatcher.js`)

```
collecting ──(/klaar)──> review ──(consent)──> stored-in-OWN-pod
   ▲                                                  │
   └──────────────── (more feedback) ─────────────────┘
                                                       │
        [lead opens verification round]  ─────────────┤
                                                       ▼
                          summarising ──> awaiting-verification
                                                       │
              ┌── verify ──> sealed+signed summary → CENTRAL pod → done
   user ◄─────┼── edit  ──> revise the summary, re-present
              └── withdraw ─> nothing leaves the own pod
```

Two consent gates by design: **(1)** at contribution → the user's own pod; **(2)** at the summary → central.
Gate 2 is this loop. *(Decision, Frits 2026-06-25: keep BOTH gates — contribute freely to your own pod, then
verify once at the summary.)*

---

## 2. Components — ~75% reuse, one genuinely-new mechanism

| Piece | Build / reuse | Where |
|---|---|---|
| Bot↔user channel · consent buttons · signing · sealed write | **Reuse** (verify = a consent with a summary payload) | `channel/dispatcher.js`, `channel/actions.js`, `pod/signing.js`, `pod/crypto-config.js` |
| Own-pod storage of raw | **Reuse `ByoCentralPod`** (already: "contributions live on each participant's OWN pod; central never holds a copy") — make it the *contribute* target | `pod/byo-central-pod.js` |
| Per-user summary, on-device | **Reuse `summarize()`**, scoped to the user's OWN points; LLM via the loopback proxy | `pipeline.js`, `triage.js` |
| "See what changed" (raw vs curated) | **Wire the existing `compare`** into the verify bubble (closes the audit gap "compare not connected to the bot") | canopy-chat `src/v2/curation.js` + the `compare` op |
| Verified-summary → central | **Reuse** the sealed+signed write; payload = the verified summary | `pod/central-pod.js` / `pod/css-central-pod.js` |
| **Lead trigger** (lead → user's bot) | **NEW** (§3) | `src/verify/*` + portal |
| `awaiting-verification` state + per-user summary record | **NEW** (small dispatcher additions) | `channel/dispatcher.js` |

---

## 3. The lead trigger — the one new mechanism (pull/poll for V1)

A lead→device *push* doesn't exist (activation is pull), and we don't want to add a server-push trust surface.
So: **the lead writes a request; the user's own bot picks it up and does the asking.**

- The lead, in the **portal**, opens a *verification round* → writes a small **`verification-request`** record
  to a project-control location (the central pod's `/control/` container, or each participant's own-pod inbox).
- The user's bot, **on open of the `fp-bot` contact** (V1 poll), checks for a pending `verification-request`
  for any project it's enrolled in → enters `summarising → awaiting-verification`.
- **V2 enhancement:** a real nudge via the existing push infra (`subscribeWebPush`/`triggerSelfPush` /
  expo-push) so the user is prompted without opening the app first.

So "the lead triggers the bot to ask the user" is satisfied without the lead ever reaching into the device:
the lead's request is data; the producing + releasing of the summary stays entirely on the user's side.

---

## 4. Data shapes (new)

```js
// written by the lead (portal) — a project-level control record
verification-request = { projectId, round, openedAt, deadline?, message? }

// the per-user summary the bot generates on-device + presents for verification
summary-draft = { projectId, round, points:[…own cleaned points…],
                  summary:"…", curatedFrom:[contributionIds], generatedAt }

// the ONLY thing that leaves the user's pod, after verify — signed + sealed; raw NOT included
verified-summary = { projectId, round, summary, verifiedAt,
                     sig: <user-key>, sealed: <to project key> }
```

---

## 5. Privacy / security properties (the acceptance bar)

1. **Raw never leaves the user's pod** — only the verified summary is written central.
2. **On-device summary via the confidential proxy** — generation never exposes raw to any host.
3. **User-gated** — nothing central without an explicit verify; edit/withdraw fully supported.
4. **Signed + sealed** — central holds ciphertext, signed by the user's key (anti-sybil reused).
5. **Lead can request, not extract** — only the user's bot can produce + release the summary.

---

## 6. Build plan

### Slice 1 — the core loop, headless (all local)
1. ✅ **`src/verify/summary-round.js`** (`6f97c608`) — `summariseOwnContributions` (on-device, reuses `summarize()`)
   + `releaseVerifiedSummary` (reuses `buildContribution`+`contributionMeta`+`pod.write`; tags `verified-summary`).
2. 🟡 **Redirect contribute → own pod** — the dispatcher now ACCEPTS `{ pod: ownPod, centralPod }` (the verify-turn
   reads `pod`, releases to `centralPod`). The remaining bit is the CALLER wiring `pod = ownPod` (the bot/mount layer).
3. ✅ **Verify turn in the dispatcher** (this commit) — `openVerificationRound` + `verifySummary`/`editVerificationSummary`/
   `withdrawVerification`, routed via `command('verify'|'verify-edit'|'verify-withdraw')`; the `verify-summary` bubble
   carries `{summary, points}` for the UI to render the `compare` (raw vs curated). Test `test/verify-turn.test.js` (3) +
   `test/verify-summary.test.js` (3); existing dispatcher tests still green (9).
4. ✅ **Lead trigger (poll)** — `src/verify/round-control.js`: `openVerificationRound` (lead writes a
   `verification-request` to a control store, idempotent) + `pendingRoundsFor` (rounds this participant hasn't
   verified) + `pollAndOpenVerification` (on contact-open → opens the verify-turn for the first pending round).
   `InMemoryRoundControl` for tests/demo; a project `/control/` container is the production backing.
   `test/verify-round-control.test.js` (3): lead→poll→verify→no-re-ask · idempotent · pending-oldest-first.
5. ✅ **Headless e2e** — `scripts/verify-summary-smoke.js` (full flow, dispatcher + lead-trigger) PASSES against the
   live proxy: contribute(own) → lead opens round → poll → summarise(proxy) → verify → central holds only the
   verified summary, raw stays own, no re-ask. **⇒ Slice 1 is engine-complete (9 verify tests green).**

### Slice 2 — channel render + actions ✅, then canopy-chat wiring
- ✅ **Channel render + control grammar** (`render.js` + `actions.js` + `strings/{en,nl}.js`) — the `verify-summary`
  bubble (summary + the points it's based on = the textual raw-vs-curated compare) + `[fp:verify | fp:verify-edit |
  fp:verify-withdraw]` buttons; `verified`/`verification-withdrawn`/`verify-none` replies; `parseControl`+`runAction`
  route the taps to the dispatcher, incl. tap-`[Edit]` → prompt → the next free text rewords (`awaitingEdit`).
  Channel-agnostic ⇒ **canopy-chat AND TG both render it.** `test/verify-render-actions.test.js` (5).
- ⏳ **canopy-chat mount wiring** — wire the `fp-bot` surface's dispatcher with `pod = ownPod` / `centralPod`, and run
  `pollAndOpenVerification` on contact-open. Optional: the richer visual `compare` (canopy-chat `curation.js`).

### Slice 3 — portal + push
Portal "open verification round" button (writes the request, shows per-participant verify status); V2 push nudge.

---

## 7. Open questions
- **Summary granularity** — one summary per participant per round, or per-domain? (V1: one per participant.)
- **Edit affordance** — free-text edit of the summary, or accept/reject only? (V1: accept / withdraw; edit = re-run.)
- **Round semantics** — can a participant be asked to re-verify a later round? (V1: yes, rounds are independent.)
