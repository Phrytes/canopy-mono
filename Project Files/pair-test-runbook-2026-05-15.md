# Cross-app pair-test runbook (2026-05-15)

> A live runbook for walking the three @canopy apps (Stoop, Tasks,
> Folio) on a real-device **pair** — i.e. two phones, or one phone +
> one desktop install. Covers the surfaces that have *already shipped*
> as of 2026-05-15; forward references for P3 (pseudo-pod V1) are
> marked **deferred**.
>
> This doc is the upstream source for each app's own real-device
> runbook (Stoop's [Phase 40.23 checklist](../apps/stoop-mobile/docs/phase-40-23-checklist.md),
> Tasks's Phase 41.16 plan, Folio-mobile's smoke pass). The per-app
> docs cover the **single-device** walks; this doc covers the **pair
> interactions** between two devices/apps.

## Why pair tests, separately

Pair tests catch a class of regressions single-device tests can't:

- **Substrate fan-out latency** — substrate-mirror writes a notify-
  envelope from device A; device B has to pick it up and converge.
  Unit tests verify the protocol; pair tests verify the wall-clock.
- **Q-D `_v` stale-peer auto-heal** — concurrent writes from two
  devices need the substrate's Lamport clock to converge silently.
  Hard to fake with mocks.
- **Capability-token reach** — Folio's cap-token issued from device A
  has to be honoured by device B. Crosses signing + verification +
  transport + pod-write boundaries.
- **Cross-app shared-defaults (Rule 3)** — Stoop reads Folio's
  `shared.json` on first run. Requires both apps to be installed +
  both pods to be addressable from device B.
- **ACP sharing v2 round-trip** — Folio shares a note with another
  WebID; that WebID's pod has to be able to fetch it back. Needs a
  real Solid pod, not a mock.

## Pre-requisites

### Hardware

- **Two devices.** Recommended: two Android phones (Stoop +
  Tasks-mobile + Folio-mobile parity). Acceptable: one phone +
  one desktop install (Stoop-desktop / Tasks-v0 / Folio-desktop).
- USB-debugging on both for `adb logcat` correlation.
- Same LAN (so the mDNS + BLE shortcuts have a chance). The relay
  fallback should also work over an external network — exercise both.

### Infrastructure

- A running relay (`scripts/start-relay.sh`).
- At least one accessible Solid pod (Inrupt or self-hosted) per
  account that exercises pod-write paths.
- For the closed-beta APK paths: signing keystore for each app.

### Identity

- Per device, a fresh identity (each app generates one at first
  launch — keep them isolated unless a scenario explicitly imports).
- For multi-pod scenarios: two WebIDs (one per device), each backed
  by a pod the device can authenticate against.

---

## Pair scenarios — Stoop V4 (substrate fan-out)

> Reference: Stoop V4 substrate-mirror retirement of `groupMirror`
> (Phase 52.9.2 shipped 2026-05-14). Walk these on Stoop-desktop A ↔
> Stoop-mobile B (or two mobile devices).

### S1 — Post visibility

1. Device A: create group, invite QR.
2. Device B: scan QR, land in Feed.
3. Device A: post a `vraag`.
4. **Pass:** device B's Feed shows the post within ~5s.

### S2 — Concurrent posts converge

1. Same group as S1.
2. Within the same 1s window, device A posts a `vraag` AND device B
   posts a different `vraag` (use a stopwatch or two-tester sync).
3. **Pass:** both devices' Feed shows BOTH posts after convergence
   (≤ 3s). No duplicates. Order can differ; that's expected.

### S3 — `_v` Lamport stale-peer auto-heal (Phase 52.14)

1. Same group; pause B's network briefly (airplane mode).
2. Device A: post 3 messages.
3. Device B: while offline, post 1 message.
4. Bring B online.
5. **Pass:** after convergence, both devices show all 4 messages,
   B's message has the highest `_v` of the 4. No "post diverged"
   UI affordance ever flashes.

### S4 — Embed-ref propagation (V4 C-track)

1. Device A: post a `vraag` with a non-empty `embedRef`
   (kind=`task`, ref=`pseudo-pod://abc/x` for the smoke).
2. **Pass:** device B's Feed renders the embed chip below the body.
3. **Pass:** device B can tap the chip without crashing (no resolver
   yet — this is a forward hook only).

### S5 — Storage-policy hand-off (V4 C-track)

1. Device A: create a new group with `storagePolicy: 'centralised'`
   + a pod URI.
2. Device A: post into it.
3. Device B: joins via QR.
4. **Pass:** device B sees the post AND the group surface shows
   the centralised pod URI consistently between A + B.
5. **Defer to P3:** real pod-write through the substrate-mirror.
   Today, posts still ride the notify envelope; the pod URI is
   informational. Promote when pseudo-pod V1 lands.

---

## Pair scenarios — Tasks V2 (substrate-mirror)

> Reference: Tasks substrate-mirror (Phase 52.9.3 shipped 2026-05-14).
> Tasks-desktop A ↔ Tasks-mobile B, both joined to the same crew.

### T1 — Task creation fan-out

1. A: create a task with `dueAt` + DoD `text`.
2. **Pass:** B's Workspace shows the task within ~5s.

### T2 — Claim race

1. Same crew, open task on both devices.
2. Both tap "Claim" within 1s.
3. **Pass:** exactly ONE device wins (the other shows the task as
   claimed by the winner). No duplicate-claim artefact in audit log.

### T3 — V2.7 dependency-gate cross-device

1. A: create parent task P + child task C with `P depends on C`.
2. B: open P. Try to mark complete.
3. **Pass:** B's "Mark complete" CTA is disabled with the open-deps
   tooltip; admin "Force complete" CTA appears for admins only.

### T4 — Photo deliverable + approval

1. A: claim a photo-DoD task; submit a photo deliverable.
2. **Pass:** B (approver role) sees the thumbnail in Review within
   ~10s. Tap → full image fetches.

### T5 — V2.7 propose-subtask

1. A: parent task in `submitted`.
2. B: propose a sub-task against it.
3. **Pass:** A's Inbox shows the proposal card. A approves → parent
   rolls back to `claimed`, sub-task appears in workspace on both.

### T6 — Cross-device bot-token binding

1. A: open CrewSettings → Bot agents → Issue token QR.
2. B: scan QR.
3. **Pass:** bot agent registers; B's Crews dashboard counter
   increments; A's bot-agent list shows the new binding.

---

## Pair scenarios — Folio V1 (sharing v2)

> Reference: Phase 52.16 ACP/WAC sharing shipped 2026-05-14. Folio-
> desktop A (signed in to pod P_A) ↔ Folio-mobile B (signed in to
> pod P_B), with both WebIDs known.

### F1 — ACP grant + fetch

1. A: open a note `<P_A>/folio/notes/n.md`. Tap Share → enter B's
   WebID → grant `read`.
2. **Pass:** A's autoShare emits an ACP grant attempt. The grant
   resource lands at `<P_A>/folio/notes/n.md.acl` (or the ACP
   equivalent) within ~5s.
3. B: paste `<P_A>/folio/notes/n.md` into a fetch test (Diagnostics
   → fetch URI). B authenticates as B's WebID and pulls the note.
4. **Pass:** fetch succeeds; the note bytes match.

### F2 — Cap-token fallback (non-ACP pod)

1. Repeat F1 but with `<P_A>` on a non-ACP-supporting pod (e.g. an
   older NSS install).
2. **Pass:** autoShare logs an ACP-not-supported warning + emits a
   cap-token instead. B can use the cap-token to fetch.

### F3 — Revocation

1. A: revoke B's grant from F1.
2. **Pass:** B's next fetch attempt against `<P_A>/folio/notes/n.md`
   401s within ~30s (ACP cache TTL).

### F4 — Conflict resolution

1. A + B both have a synced note `n.md`.
2. Within 30s: A edits "line 5", B edits "line 7". Both save.
3. After sync window passes:
4. **Pass:** ConflictsScreen on whichever side lost the race shows
   the conflict; resolving it produces a converged file on both.

---

## Cross-app scenarios

### X1 — Sibling-app shared-defaults seed (Rule 3)

1. Install Folio first; sign in; set `displayName` + `defaultLocale`.
2. Install Stoop on the same device, on the same account.
3. **Pass:** Stoop's first-run onboarding pre-fills `displayName` +
   `locale` from Folio's `shared.json` (no manual re-entry).
4. Repeat with Tasks-mobile.

### X2 — Capability-token across apps

1. Folio A: mint a cap-token for a note URI, scoped `read`.
2. Stoop B: scan the cap-token (would-be future Stoop "import note
   as substrate-doc" surface). **Defer:** Stoop doesn't import
   notes today. Mark as forward-reference for the Hub track.

### X3 — Same-WebID, multiple apps on same device

1. Same device: install Folio + Stoop + Tasks-mobile.
2. Sign each into the same Solid WebID.
3. **Pass:** each app's pod-side namespace stays isolated
   (`<pod>/folio/...` vs `<pod>/stoop/...` vs `<pod>/tasks/...`).
   No write collisions; no app reads another's namespace except
   via the documented shared-defaults hook (X1).

---

## Battery + network sweep (per app)

Run alongside each app's individual `docs/battery.md` template
(currently only Stoop-mobile has one — to be ported to Tasks-mobile +
Folio-mobile when those apps run their own 41.16 / smoke passes):

| Scenario | Stoop-mobile | Tasks-mobile | Folio-mobile |
|---|---|---|---|
| 8h idle | (battery.md) | TODO | TODO |
| 1h active | (battery.md) | TODO | TODO |
| Cadence comparison | (battery.md) | TODO | TODO |

---

## Deferred to P3 (pseudo-pod V1)

These scenarios depend on P3 (pseudo-pod V1 + sync-engine
absorption). DO NOT attempt today; document for promotion when P3
ships:

- **D1.** Pod-primary write-through queue: any app writes to its
  per-bundle pseudo-pod URI; the substrate flushes to the real
  pod when online; offline writes durable across restarts.
- **D2.** No-pod-crew replicated mode: groups without a pod still
  fan out via pseudo-pod replication. Latency parity with current
  notify-envelope path.
- **D3.** Campsite-to-online queue drain: app written offline for
  hours/days; on reconnect, the queue drains in causal order
  without manual intervention.
- **D4.** Cross-app pseudo-pod URI consumption: an app embeds a
  ref to a pseudo-pod URI owned by another app's bundle on the
  same device; resolution succeeds (forward reference for Hub).

---

## Sign-off + reporting

For each pair-test session:

- Tester(s), date, devices (model + Android version), apps tested.
- Pass/fail per scenario from the lists above.
- Battery numbers (if running the per-app battery template alongside).
- Any unhandled rejections or redboxes during the walk — file as
  issues before promoting any app to closed-beta.
- Update each per-app phase status table (Stoop 40.23, Tasks 41.16,
  Folio-mobile smoke) once the corresponding single-device + pair
  scenarios are all green.

---

## Promotion gates

The standardisation plan's P3 acceptance criterion is "all three
apps pod-primary on real device pair for pod-having crews; no-pod
crews still work via pseudo-pod-replicated mode; latency parity with
current local-only; campsite → online drains queue cleanly."

Today's pair-test surface (S1–S5, T1–T6, F1–F4, X1, X3) covers the
shipped substrate work and serves as the **regression bar** for P3.
P3 will add D1–D4 to this list and the runbook gets promoted at
that point.
