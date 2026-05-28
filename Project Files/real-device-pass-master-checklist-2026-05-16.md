# Real-device pass — master checklist (2026-05-16)

> **One ordered entry point** for the hardware acceptance passes
> (Phase 40.23 Stoop-mobile, 41.16 Tasks-mobile, Folio-mobile smoke +
> the new P3 **OQ-6** cache verification, cross-app X1–X3).
>
> This is a **driver/index, not a copy** — the per-scenario steps stay
> single-source in their canonical docs (linked below). The only steps
> written *inline here* are **OQ-6** (they exist in no other runbook).
>
> Co-pilot loop: run a section, paste the result/redbox/error back in
> chat — Claude triages and fixes code if a pass surfaces a real bug.
>
> Date: ________  Tester: ________  Devices: ________

---

## 0. Global prerequisites (do once, before any pass)

- [ ] **Hardware:** ≥1 Android phone with USB debugging; `adb devices`
      lists it. **2 devices** for the cross-device journeys
      (Stoop J3–J5/S1–S5, Tasks T1–T6, X1–X3) — 1 device + a desktop
      install also works for most.
- [ ] **Solid accounts:** ≥2 real pods/WebIDs (an Inrupt-hosted login
      is the supported path — see the ACP note in §3). Note them:
      owner=________  second=________
- [ ] **Workspace clean & green:** `git status` clean; the last full
      sweep was 43/43 (P3 + ACP follow-ups landed). Build from current
      `master`.
- [ ] Per-app build deps installed (each pass lists its exact build cmd).

Canonical detailed runbooks (the per-scenario steps live here):
- Stoop-mobile: [`apps/stoop-mobile/docs/phase-40-23-checklist.md`](../apps/stoop-mobile/docs/phase-40-23-checklist.md) (+ `battery.md`)
- Tasks-mobile: [`apps/tasks-mobile/README.md`](../apps/tasks-mobile/README.md) §"Real-device test plan (Phase 41.16 runbook)"
- Cross-app pair scenarios (S/T/F/X/D): [`pair-test-runbook-2026-05-15.md`](pair-test-runbook-2026-05-15.md)

---

## 1. Stoop-mobile — Phase 40.23

- [ ] **Build:** `cd apps/stoop-mobile && npm install --legacy-peer-deps && ./node_modules/.bin/expo run:android`
- [ ] **Single-device walk:** follow `phase-40-23-checklist.md`
      Pre-flight + **J1–J9** + V4 C-track checks + battery (`battery.md`)
      + closed-beta APK build. Tick there.
- [ ] **Pair (2-device):** pair-test runbook **S1–S5** (post visibility,
      concurrent-converge, `_v` stale-peer auto-heal, embed-ref
      propagation, storage-policy hand-off).
- [ ] **Gate:** all J* + S* green; battery measured; APK built.
- Result: ☐ PASS ☐ FAIL — notes/issues → paste in chat:

## 2. Tasks-mobile — Phase 41.16

- [ ] **Build:** `cd apps/tasks-mobile && npm install && expo run:android --device`
- [ ] **Single-device walk:** `apps/tasks-mobile/README.md` §41.16
      runbook — full V1 user journey on a clean phone.
- [ ] **Pair (2-device):** pair-test runbook **T1–T6** (creation
      fan-out, claim race, dependency-gate, photo-deliverable+approval,
      propose-subtask, cross-device bot-token binding).
- [ ] **Gate:** single-device journey + T1–T6 green.
- Result: ☐ PASS ☐ FAIL — notes/issues → paste in chat:

## 3. Folio-mobile — smoke + **P3 OQ-6 cache verification**

### 3a. Folio sharing smoke (existing)
- [ ] **Build:** `cd apps/folio-mobile && npm install && expo run:android --device`
- [ ] pair-test runbook **F1–F4** (ACP grant+fetch / cap-token
      fallback / revocation / conflict). **ACP note:** F1 ACP needs an
      ACP-capable pod — use an **Inrupt-hosted** pod (the supported
      path). Against modern CSS, `client.sharing` fails *loudly*
      (`SHARING_*_NOOP`) by design — that's expected, not a pass
      failure (see `Inrupt-migration/css-acp-integration-test-design-2026-05-16.md`).
- Result: ☐ PASS ☐ FAIL — notes → paste in chat:

### 3b. OQ-6 — folio-mobile pseudo-pod cache default (NEW; gates the flip)

> Why: P3 wired folio-mobile's cache-mode pseudo-pod (offline
> write-through queue + read cache, RN persistent backend) but left it
> **opt-in** because RN engine bring-up has no vitest signal. This
> on-device pass is the gate to flip its default ON (P3 OQ-6).

- [ ] **Step 0 — build with the flag ON (enablement now wired).**
      `ServiceContext.js` accepts `EXPO_PUBLIC_FOLIO_PSEUDO_POD` (Expo
      inlines `EXPO_PUBLIC_*` into the RN bundle at build time; plain
      `process.env` does NOT survive into RN — that gap was fixed
      2026-05-16). Build folio-mobile with:
      `cd apps/folio-mobile && EXPO_PUBLIC_FOLIO_PSEUDO_POD=1 npx expo run:android --device`
- [ ] Cache mode confirmed active in the running build (the
      ServiceContext cache branch is taken — confirm via a log line /
      that an offline write queues rather than errors).
- [ ] **Online write:** create/edit a Folio note while online → syncs
      to the pod as before (parity with the direct path).
- [ ] **Offline queue:** enable airplane mode → make ≥2 note
      edits/creates → they succeed locally (no error); a pending/queued
      indication is observable (or at least no data loss).
- [ ] **Restart-durability:** kill the app **while still offline** →
      relaunch (still offline) → the queued writes are **still
      pending** (the RN persistent backend survived process death —
      the headline P3 mobile guarantee).
- [ ] **Reconnect drain:** disable airplane mode → within a short
      window the queued writes **drain to the pod** (verify the edits
      land server-side, e.g. via desktop Folio / pod browser).
- [ ] **No regression:** read-back of a pod-only note still works
      (cache read-through), conflict behaviour unchanged.
- [ ] **Gate met → the OQ-6 flip is earned.** Report PASS here; the
      follow-up code change is: flip folio-mobile's default ON
      (`ServiceContext` flag default) + update P3 plan OQ-6 +
      TODO-GENERAL. (Claude does that code change post-pass; it is
      deliberately NOT done until this gate is green.)
- Result: ☐ PASS ☐ FAIL — notes → paste in chat:

---

## 4. Cross-app — X1–X3

- [ ] pair-test runbook **X1** (sibling-app shared-defaults seed),
      **X2** (capability-token across apps), **X3** (same-WebID,
      multiple apps, same device).
- Result: ☐ PASS ☐ FAIL — notes → paste in chat:

---

## 5. Sign-off

| Pass | Result | Tester | Date | Notes |
|---|---|---|---|---|
| Stoop-mobile 40.23 (J* + S*) | ☐ | | | |
| Tasks-mobile 41.16 (journey + T*) | ☐ | | | |
| Folio-mobile smoke (F1–F4) | ☐ | | | |
| **Folio-mobile OQ-6 cache** | ☐ | | | → unblocks the default flip |
| Cross-app X1–X3 | ☐ | | | |

On full green: report back in chat. Post-pass code changes Claude will
make (gated on the relevant PASS, not before): (a) **OQ-6** → flip
folio-mobile cache default ON + record; (b) any bug a pass surfaced →
fix + re-verify; (c) move the shipped passes Done in TODO-GENERAL.
Also cross-reference the canonical pair-test runbook's own
"Sign-off + reporting" + "Promotion gates" sections.
