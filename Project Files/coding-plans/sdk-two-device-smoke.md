# SDK Two-Device Smoke

| | |
|---|---|
| **Status** | prep done; scenarios stubbed; awaiting hands-on runs |
| **Started** | 2026-04-29 — prep work in flight |
| **Last updated** | 2026-04-29 — Q-Smoke.1/3/4/5 locked, harness scaffolded, relay verbose logging added |
| **Owner** | unassigned |
| **Blocked on** | nothing — physical bring-up is the only remaining gate |

**Goal:** validate the new SDK substrate shipped in Tracks A–G on
**two physical devices** before committing to mobile work (Folio
Phase C, Track H Tier 2 apps).  The 39 in-process scenario tests
validate **logic**; this plan validates that the substrate **survives
real BLE / WiFi / clock-skew / battery / OS-keystore** behaviour.

**Why this exists, in one sentence:** the only multi-device code that
has been running on phones is the original mesh-chat (messaging over
BLE/WiFi).  None of the new SDK surface — vault, pod-client,
capability tokens, identity sync, governance, skills pubsub, A2A,
push — has touched a real radio yet.  If something is broken on
real hardware, we want to know **before** Phase C, not during.

**Refs:**
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — Phase C is gated on this
- [`./track-A-pod-substrate.md`](./track-A-pod-substrate.md) — pod client + capability tokens
- [`./track-B-identity-sync.md`](./track-B-identity-sync.md) — vault, identity sync
- [`./track-D-multi-member.md`](./track-D-multi-member.md) — governance, role-aware groups
- [`./track-E-mobile-push-relay.md`](./track-E-mobile-push-relay.md) — push (E2c deferred; we test what's shipped)
- [`./track-F-oauth-livesync.md`](./track-F-oauth-livesync.md) — OAuth vault, LiveSync
- [`./track-G-reachability.md`](./track-G-reachability.md) — reachability oracle gossip
- [`../apps/mesh-demo/`](../apps/mesh-demo/) — surface that runs on the phone

---

## Why now (not later)

The SDK shipped 7 tracks of substantial new surface.  Each track has
its own unit + integration tests, but **all of them in-process**.
That's enough to validate logic, not enough to validate that the
combined substrate survives:

- **Real BLE flap** during pod sync (a `runOnce()` taking 30+ seconds is
  qualitatively different from a tight in-process loop)
- **Real mDNS race** during identity sync (5-min poll cycles intersect
  with discovery in awkward ways on real Wi-Fi)
- **Real clock skew** between two devices (replay window is ±10 min;
  we've never measured the actual skew on phones)
- **Real OS keystore** for vault writes (Android Keystore, iOS Keychain
  via expo-secure-store) — different failure modes than VaultNodeFs
- **Real battery / sleep** behaviour (Android Doze, iOS background
  suspension; identity sync's 5-min poll is the obvious victim)
- **Real `B5` vault migration** running on a phone (the migration was
  designed in-process; it's never been exercised on a real device's
  encrypted keystore)

The cost of catching these bugs in Folio Phase C is **two weeks of
rework**.  The cost of catching them now is **one week of bring-up**.

---

## Scope

This plan covers **only the new SDK substrate**, not Folio.
Specifically: the things that Tracks A–G shipped.  Folio Phase C will
test Folio on top.  The two are independent.

### What gets tested on real devices

| # | Area | What we exercise | Pass criterion |
|---|---|---|---|
| **S1** | Bootstrap | Generate BIP-39 phrase on phone-A; recover identity on phone-B from same phrase | Both devices end with the same WebID; vault writes survive a process kill |
| **S2** | Vault migration (B5) | Phone-A starts on pre-B5 vault; restart triggers migration; restart again | All 7 vault keys present after migration; PRIVATE-SEED key migrated correctly; old format gone |
| **S3** | Pod sync — direct | Phone-A writes a Folio note to its pod; phone-B (granted token) reads it | <5s round-trip on Wi-Fi; <30s on BLE |
| **S4** | Pod sync — flap | Repeat S3 while toggling Wi-Fi off/on every 10s | No data loss; sync resumes within 1 oracle-interval after Wi-Fi returns |
| **S5** | Capability token share | Phone-A mints a token for phone-B's WebID; phone-B reads with it; phone-A revokes; phone-B gets denied on next read | Revoke takes effect within 1 sync cycle; no plaintext leak in logs |
| **S6** | Identity sync | Phone-A rotates its key; phone-B observes the rotation via 5-min poll | Phone-B accepts new key within 10 min; no replay-window false negatives |
| **S7** | Governance — role demote | Phone-A (admin) demotes phone-B (member) mid-session; phone-B's next write to a member-only path fails | Demote propagates within 1 sync cycle; mid-flight call gets rejected |
| **S8** | Skills pubsub | Phone-A publishes on a skill topic; phone-B (subscribed via 5-segment topic match) receives it | Receive within 5s on Wi-Fi; subscriber-side filter holds |
| **S9** | A2A external bridge | Phone-A sends to phone-B via Carol-bridge (laptop running the relay); sealed-forward | Bob's payload arrives intact; relay logs contain no plaintext fragment |
| **S10** | Battery / sleep | Phone-A goes to sleep (screen off, app backgrounded) for 30 min; pod sync survives | On wake, identity sync resumes within 1 poll cycle; no missed messages |

### What's out of scope

- Push notifications (E2c is deferred; not shipped)
- LLM-mediated agents (H3 blocked on LLM choice)
- Anything in Folio (Phase C handles that)
- BLE-only environments where Wi-Fi is fully off (BLE-only chat already works in mesh-demo; we re-test it once as part of S3 but don't expand)

---

## Deliverable

A single document: `coding-plans/sdk-two-device-smoke-results.md`
that records, per scenario:

- **Setup:** which build, which devices, which firmware, which network
- **Observed:** raw timing + screenshots / log excerpts where useful
- **Verdict:** PASS / FAIL / DEGRADED (with explanation)
- **Follow-up:** SDK-side bugs filed as TODOs in `TODO-GENERAL.md`

Plus, if we find substrate bugs, **fix them before Phase C kicks off.**

---

## Hardware setup

### Devices

- **Phone-A:** the existing dev-build phone (mesh-demo Expo build
  already installed per CLAUDE.md).  Android.
- **Phone-B:** **needs picking.**  Three options:
  1. **A second physical Android.**  Cleanest signal; matches how
     users will run the app.  Requires installing the dev build via
     `eas build` or sideload.
  2. **Android emulator on the laptop.**  Cheap; works for everything
     except real BLE.  Wi-Fi-side tests valid.
  3. **An iPhone.**  Highest-value test (catches iOS-specific bugs)
     but needs an Apple Dev account + TestFlight or sideload via Xcode.

  **Lean:** start with #2 (emulator) for S1, S3, S5, S6, S7, S8, S9 —
  fast iteration.  Then borrow a second Android (#1) for the BLE
  scenarios S4 + the BLE half of S3.  Defer iOS until after Phase C
  if budget is tight.

### Network

- **Wi-Fi router** the laptop and both phones can reach.  No special
  setup; the existing relay on the laptop handles bridging.
- **The relay** runs on the laptop (`npm run relay:start`) — already
  used by mesh-demo.

### Builds

- **Phone-A:** dev build is installed; Metro bundler picks up SDK
  changes.  To test post-Track-G code: `cd apps/mesh-demo && npx expo
  start -c` (cache-clear flag matters per CLAUDE.md gotchas).
- **Phone-B:**
  - If physical: `eas build --profile development --platform android`
    once, then sideload.  Re-runs of `expo start` reach it via Metro.
  - If emulator: `npx expo start --android` launches it.

---

## Open questions

| # | Question | Lean / status |
|---|---|---|
| Q-Smoke.1 | Phone-B platform — second Android, emulator, or iPhone? | **Locked 2026-04-29: emulator first, real Android second, iOS deferred.**  Beats picking a single platform up-front because the emulator gives near-instant Wi-Fi-side iteration on S1/S3/S5–S9, and a real Android only needs to come out for the BLE-touching scenarios (S4 + the BLE half of S3).  iOS would need an Apple Dev account + TestFlight/Xcode plumbing that has zero leverage over the substrate questions we want to answer first. |
| Q-Smoke.2 | How long do we run S10 (battery / sleep)?  30 min vs overnight? | **Lean: 30 min.**  Catches Doze; overnight is a follow-up if 30 min looks clean. |
| Q-Smoke.3 | Do we re-write mesh-demo screens to expose the new SDK surface (vault, pod, governance) for testing?  Or write a dedicated smoke harness? | **Locked 2026-04-29: new harness `apps/sdk-smoke/`.**  Beats extending mesh-demo because mesh-demo's chat UI and AgentContext are tuned for messaging, not for one-shot SDK probes — bolting in vault/pod/governance buttons would either pollute the chat code path or require a hidden second screen.  Standalone harness keeps mesh-demo as the canonical "messaging on radios works" surface and gives the smoke app room to add per-scenario logs without crowding the chat UI. |
| Q-Smoke.4 | Does the relay need any new instrumentation (verbose logs, sealed-forward leak detection on the wire)? | **Locked 2026-04-29: yes — `RELAY_VERBOSE=1` gated logging in `packages/relay/`.**  Beats "no extra logging" because S9 (sealed-forward) needs an explicit on-the-wire check that the relay never sees plaintext fragments — without a leak detector we'd be eyeballing log output for Bob's payload, which scales badly across 10 scenarios.  Off by default, plain `console.log` (no new deps), <50 lines added. |
| Q-Smoke.5 | Do we run this **in parallel** with Folio Phase B, or **after** Phase B lands? | **Locked 2026-04-29: parallel with Folio Phase B.**  Beats serial because Folio B is single-device web work (different test surface, different keyboards) and smoke is two-device hardware work; the only shared resource is the laptop's relay process, which both can use simultaneously.  No contention, halves wall-clock time to Phase C readiness. |

---

## Sequence

The plan is split into **prep** (one-time setup) and **scenarios**
(repeatable, ordered by dependency).

### Prep

- [x] 1. Lock Q-Smoke.1 (Phone-B platform) — locked 2026-04-29: emulator first, real Android second, iOS deferred
- [x] 2. Lock Q-Smoke.3 (existing mesh-demo vs new smoke harness) — locked 2026-04-29: new `apps/sdk-smoke/`
- [x] 3. Scaffold `apps/sdk-smoke/` (Expo app, shares packages with
      mesh-demo, one screen per scenario as a press-button test;
      stubs return structured `{ status, detail }` results today)
- [x] 4. Add verbose logging to relay, gated by `RELAY_VERBOSE=1`
      (per-message hop log + plaintext-leak detector for S9)
- [ ] 5. Bring up Phone-B per Q-Smoke.1 (see "Bring-up runbook" below)
- [ ] 6. Verify mesh-demo still reaches `ready` on Phone-A in three
      modes per CLAUDE.md DoD (BLE+Wi-Fi off, BLE-only, Wi-Fi-only) —
      regression check before we add new tests

### Scenarios

Run in order; each has its own checkbox so progress is trackable.

- [ ] **S1** — Bootstrap & recover (5 min)
- [ ] **S2** — Vault migration B5 on real keystore (15 min)
- [ ] **S3** — Pod sync direct, both networks (20 min)
- [ ] **S4** — Pod sync under Wi-Fi flap (20 min)
- [ ] **S5** — Capability token share + revoke (15 min)
- [ ] **S6** — Identity rotation across devices (30 min — bounded by 5-min poll cadence)
- [ ] **S7** — Governance role demote mid-session (15 min)
- [ ] **S8** — Skills pubsub round-trip (10 min)
- [ ] **S9** — A2A sealed-forward via relay (15 min)
- [ ] **S10** — Battery / sleep tolerance (30 min — wall-clock; mostly waiting)

**Total:** ~3 hours of attended testing once Phase B prep is done.

### Closeout

- [ ] Write `coding-plans/sdk-two-device-smoke-results.md` with one
      section per scenario
- [ ] File any SDK bugs as new entries in `TODO-GENERAL.md`
- [ ] Decision: Phase C **green** (all PASS), **green-with-fixes** (one
      or two minor failures, fix before C), or **red** (substrate
      blocker, Phase C postponed)

---

## DoD

- [ ] All 10 scenarios run on at least one device pair
- [ ] Results doc written
- [ ] Any FAIL/DEGRADED scenario has a follow-up TODO entry
- [ ] If Q-Smoke.4 added logging, it's behind a flag and doesn't ship
      to production by default

---

## Bring-up runbook

Once the prep work above lands, the user runs the scenarios from the
`apps/sdk-smoke/` harness.  Below is the minimum sequence to get one
emulator + one phone + a verbose relay all talking on the laptop.

### One-time emulator setup

1. Install **Android Studio** (>= Hedgehog).  `sdkmanager` ships with it;
   make sure the Platform-Tools + a system image (API 34, x86_64,
   Google APIs) are installed via SDK Manager.
2. Create an AVD: **Tools → Device Manager → Create Device**.  Pixel 6
   on API 34 is a known-good combination for Expo 52 / RN 0.76.9.
3. Start the AVD before launching Expo so Metro can attach.
4. (Optional, for parity with Phone-A) install Expo Go from the emulator's
   Play Store — but the smoke harness uses a dev build via Metro, so
   Expo Go is only needed if you're sanity-checking with `expo start`
   in Go mode.

### Launch the smoke harness

```bash
# Emulator (Phone-B):
cd apps/sdk-smoke && npx expo start --android

# Real Android (Phone-A or a borrowed second device, USB or Wi-Fi-attached):
cd apps/sdk-smoke && npx expo start
# Then press 'a' in the Metro CLI to deploy to a connected Android.
# Or scan the QR with Expo Go (if a dev build isn't yet on the device).
```

For the **first** run on a real Android, you'll need a dev build:

```bash
# One-time, from apps/sdk-smoke/:
eas build --profile development --platform android
# Sideload the resulting .apk; subsequent runs reach it via Metro.
```

> Do **NOT** run `npx expo run:android` — Phone-A's existing
> mesh-demo dev build lives at `com.canopy.meshdemo` and is unrelated
> to `ag.canopy.sdksmoke`; running the wrong target wipes the wrong
> dev build.  Phone-A's mesh-demo build is hand-installed per CLAUDE.md
> gotchas and we don't replace it.

### Launch the relay with verbose logging

```bash
# From the monorepo root:
RELAY_VERBOSE=1 npm run relay:start
```

When `RELAY_VERBOSE=1` is set, every hop the relay forwards is logged
on stdout as a `[verbose]` line including:
- the sender pubkey (short form)
- the recipient pubkey (short form)
- the bundled message size in bytes
- the message `_p` (protocol) field
- a `potential plaintext leak: ...` line whenever the envelope body
  contains 20+ readable UTF-8 characters in a row (the S9 sealed-forward
  smoke test fails the scenario if any such line appears for traffic
  it forwarded between phone-A and phone-B)

Without `RELAY_VERBOSE=1`, the relay is silent at message-hop level
(only the existing `[relay] registered/disconnected` lines from
`log: true` callers).  This means the production-default behavior is
unchanged.

### Read per-scenario logs

The harness mounts a `LogPane` under each `ScenarioRow`.  Press the
row's **Run** button to fire the scenario; the pane fills in real time
with timestamped log lines from the SDK call sites.  The status pill
at the right of the row updates between `pending → running → pass /
fail / degraded`, with the underlying detail string surfaced as a
tooltip.

When a scenario fails, **don't clear the pane** — copy the log into
`coding-plans/sdk-two-device-smoke-results.md` (created at closeout)
so the failure is traceable.  Pair the harness log with the relay's
`[verbose]` lines from the same wall-clock window.

---

## Notes (team scratchpad)

```
2026-04-29 — initial plan.  Prep work (Q-Smoke.1/3/4 locks + harness
scaffold) is the part that can run in parallel with Folio B without
device contention.  The actual scenario runs are bursty hands-on work
that should be batched into one or two sit-down sessions once prep is
done.

Open thought: if S2 (vault migration) fails, that's a Track B regression
and likely blocks ALL further phone work — handle it as the canary.
Run S2 first after S1.

2026-04-29 — prep done.  Q-Smoke.1/3/4/5 locked with rationale; harness
scaffolded at apps/sdk-smoke/ with all 10 scenario files as stubs;
relay verbose logging gated behind RELAY_VERBOSE=1 with leak detector.
Bring-up runbook added above.  Awaiting hands-on runs.
```
