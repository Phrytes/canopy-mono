# M3 — Tasks-mobile real-device acceptance checklist

> Re-baselined runbook (was Phase 41.16). The surface changed under
> M1/M2/S5 — storage-policy picker, multi-circle onboarding dispatch,
> cross-device substrate fan-out, and pod OIDC sign-in now exist —
> so this supersedes the old 13-journey README runbook.
>
> Walk this on a **real Android device** (USB-debugging on,
> `adb devices` shows it). **Two devices required** for the
> cross-device substrate fan-out journey (J5) — that is the
> acceptance gate. One device + a desktop `bin/tasks-ui.js
> --multi-circle` install also works for J5.
>
> Date: ___________  Tester: ___________  Device(s): ___________
>
> Model: `apps/stoop-mobile/docs/phase-40-23-checklist.md`. Pair
> (two-device) scenarios mirror Stoop's S1–S5 substrate-fan-out
> pair scenarios.
>
> Debugging cheat-sheet (not a runbook):
> [`../REAL_DEVICE.md`](../REAL_DEVICE.md) — carried-forward gotchas
> are summarised in the Appendix below.

## Pre-flight

- [ ] Linux only: `fs.inotify.max_user_watches` already bumped to
      524288 (see Appendix A1) — else first `expo run:android`
      throws `ENOSPC`
- [ ] Reuse stoop-mobile's dev client when possible (same Expo 52 /
      RN 0.76.9 pin; Tasks' native modules are a near-superset —
      only adds expo-calendar — saving a ~30–40 min native rebuild)
- [ ] `cd apps/tasks-mobile && npm install` runs clean
- [ ] `./node_modules/.bin/expo run:android` builds + installs the
      dev-client APK
- [ ] `expo start --clear` if swapping dev clients between
      stoop-mobile and tasks-mobile in the same session (stale Metro
      cache hands tasks-mobile stoop's `@onderling-app/stoop`
      resolution — BRING-UP-NOTES Trap 2)
- [ ] App boots without a redbox on first launch; splash clears
      within ~3s (cold-start target — see Appendix A2)

## J1 — First launch + identity bring-up

- [ ] Welcome screen renders
- [ ] Identity auto-generates via `KeychainVault` (no visible prompt)
- [ ] Status flips to no-circles; Welcome onboarding stack is shown
      (bottom-tab `Main` shell only after a circle exists)
- [ ] Welcome shows BOTH CTAs: the quick "Create a new circle" path
      AND the secondary "Create with storage policy…" (M1-S2) link

## J2 — Create a circle with a storage policy (M1-S1/S2)

- [ ] Welcome → "Create with storage policy…" → CreateCircleScreen
      (modal) renders
- [ ] Circle name input; **Circle ID slug auto-derives** from the name
      and is editable; invalid slug (caps/spaces) shows the inline
      validation error + red border
- [ ] Circle-kind chip row renders 5 options (household / project /
      team / friends / maintenance)
- [ ] **Storage-policy radio renders ALL FOUR**: no-pod (default) /
      centralised / decentralised / hybrid, each with its hint line
- [ ] **Picking centralised OR hybrid reveals the group-pod-URI
      input**; picking no-pod / decentralised hides it again
- [ ] Submit → `provisionMyCircle` persists the config → `joinCircle`
      builds the runtime CircleState → nav resets to `Main` +
      `OnboardIssue(freshlyCreated:true)`
- [ ] OnboardIssueScreen shows the admin invite QR. Verify the QR
      renders + scans cleanly with a separate scanner app

## J3 — Verify the stored policy + upgrade (M1-S4)

- [ ] Main menu → "Pod & storage settings" → PodSettingsScreen
- [ ] Section 1 shows the **current policy** matching what J2 chose
      (+ the group-pod-URI row when centralised/hybrid)
- [ ] "Upgrade storage policy…" reveals the inline form with the
      upgradeable radios (centralised / decentralised / hybrid; no
      no-pod — one-way, no downgrade)
- [ ] Pick centralised → pod-URI field appears; submit →
      `setCircleStoragePolicy` → "Storage policy updated."; Section 1
      reflects the new policy
- [ ] (Negative) attempting to downgrade is not offered (no no-pod
      option in the upgrade form) — one-way contract holds
- [ ] Section 2 (Agent registry): after the circle is up, status reads
      **"Registered"** (a meshAgent + substrate were both available
      — M1-S3). If "Not registered", see Appendix A3

## J4 — Multi-circle onboarding dispatch (M2-S8)

- [ ] From the active circle, OnboardIssueScreen → `issueInvite`
      returns an invite; QR renders
- [ ] **Second device** → Welcome → "Scan an invite QR" → camera
      opens (permission prompt OK)
- [ ] Scan device-A's QR → `redeemInvite` routes by the invite's
      `groupId` (no manual circleId needed) → device B builds the
      CircleState + lands in the joined circle's Workspace
- [ ] On device A, the circle's MemberMap grows device B's member
      (visible in CircleSettings → members)
- [ ] Create a SECOND circle on device A (J2 again, different slug);
      add a task in each circle → **tasks do NOT leak across circles**
      (per-circle `mem://tasks/circles/<id>/` itemStoreRoot — M2 Slice-7
      parity). Workspace switched to circle A shows only A's tasks

## J5 — Cross-device substrate fan-out  ★ ACCEPTANCE GATE ★

> Mirrors Stoop's S1–S5 substrate-fan-out pair scenarios. Two
> devices (A, B) both joined to the same circle (via J4).

- [ ] **S1 add fan-out:** add a task on A (ComposeScreen) → **B's
      Workspace shows it within ~5s** (notifyEnvelope fan-out via
      the shared `tasksMirror.publishTask` in the skill body —
      M1-S3 wiring + M2 shared-skill fan-out)
- [ ] **S1b embed fan-out:** add a task on A with an embed
      (type=`note`, ref=`pseudo-pod://abc/x` — M1-S1 embeds slot);
      remove it via the × chip then re-add + submit → B's mirrored
      task carries the embed
- [ ] **S2 claim:** claim the task on B → A reflects the claim
      (`claimTask` → `applySync` gate-bypass on the receiver)
- [ ] **S3 complete:** complete on A → B moves it to closed
- [ ] **S4 submit→reject→submit→approve:** run the review lifecycle
      across A/B → both converge to the same final state
      (`_inferAction` resolves submit/reject/approve from reviewLog)
- [ ] **S5 remove:** remove the task on A (admin) → B hard-deletes
      its local copy (`publishTaskRemoved` → `removeSync`)
- [ ] **Live peer-roster (M2-S10):** the device that joined LAST
      still receives fan-out for tasks added AFTER it joined
      (redeemInvite pushed its pubKey to `tasksMirror.addPeer`)
- [ ] **Stale-peer auto-heal:** race a concurrent edit of the same
      task on A and B → within ~1s they converge silently (no UI
      affordance; verify the two devices don't diverge)

## J6 — Pod OIDC sign-in (S5)

> RN flow: PKCE in the system browser via `expo-auth-session`
> (`useTasksAuth`), then the `completePodSignIn` skill adopts the
> tokens onto `OidcSessionRN` and attaches a `SolidPodSource` to the
> bundle cache through the SHARED `apps/tasks-v0` `podSignIn.js`
> orchestration (session injected via the additive seam — zero web
> change). Skill ids/return shapes match tasks-v0.

- [ ] PodSettingsScreen → Section 3 "Solid pod sign-in" renders the
      **enabled** "Sign in to Solid pod" button (no longer the
      disabled stub) — initial `podSignInStatus` → `signedIn:false`
- [ ] Tap "Sign in to Solid pod" → system browser opens the IdP
      (default issuer `https://login.inrupt.com`)
- [ ] Complete the IdP login → browser redirects back via
      `tasks://auth/callback` (verify the AndroidManifest intent
      filter exists post-`expo prebuild` — Appendix A4)
- [ ] Back in-app: `completePodSignIn({tokens})` runs → Section 3
      flips to signed-in: shows **"Signed in as <WebID>"** + a
      "Sign out of pod" button
- [ ] Backgrounding mid-flow then returning does not wedge the
      screen (token exchange completes or surfaces a clear error)
- [ ] **OIDC HTTP timeout:** the Node `@onderling/oidc-session` web
      path honours `OIDC_HTTP_TIMEOUT_MS` (default **30000 ms** vs
      the openid-client 3500 ms default — inherited fix). The RN
      path (`@onderling/oidc-session-rn` / expo-auth-session) does NOT
      use this env var; if discovery/token is slow on a poor
      connection, the failure surfaces as the hook's `lastError`,
      not a 3.5 s hard cut. Note the observed behaviour here:
      _______________
- [ ] Tap "Sign out of pod" → `signOutOfPod` skill + ServiceContext
      `detachPod` → Section 3 returns to signed-out; local cache
      preserved (tasks still visible offline)
- [ ] Reload the app → if a session was persisted to SecureStore,
      Section 3 reflects it; otherwise signed-out (acceptable for
      V1 — no auto-restore is wired in M1)
- [ ] (Cross-check) the same skill surface drives nothing else
      mobile-specific: `podSignInStatus` / `signOutOfPod` return the
      exact tasks-v0 Slice-5 shapes (portability with screens that
      consume them, e.g. stoop-mobile's ProfileMineScreen pattern)

## J7 — Background fetch (carried from 41.14)

- [ ] Settings → set the online-window cadence (e.g. 15 min)
- [ ] Background the app; mutate a task from device B
- [ ] Wait ≥ 15 min (Android Doze may clamp longer); foreground →
      the receive arrived. Force with `adb shell cmd jobscheduler
      run -f ag.canopy.tasksmobile <jobId>` if needed

## Sign-off

- [ ] All checked items pass
- [ ] **J5 (cross-device substrate fan-out) fully green — this is
      the acceptance gate**
- [ ] No redboxes or unhandled rejections during the walk
- [ ] Closed-beta APK (`eas build --profile preview`) boots on a
      fresh device without dev-mode JS bundling and J1–J7 still pass

**Tester sign-off:** ___________  **Date completed:** ___________

---

## Appendix — carried-forward `REAL_DEVICE.md` gotchas

**A1 — Linux inotify limit (do this once per machine BEFORE the
first build):**
```bash
sudo sysctl -w fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=512
echo -e 'fs.inotify.max_user_watches=524288\nfs.inotify.max_user_instances=512' | \
  sudo tee -a /etc/sysctl.d/90-watchers.conf
sudo sysctl --system
```
`metro.config.js` also blocks Gradle/Pods build dirs from HMR.

**A2 — Cold-start baseline (Pixel 5, dev client):** target
< 3 s to first Workspace render. Budget: `buildMeshAgent` ~600 ms +
`wireSkills` (60+ skills) ~200 ms + React mount ~400 ms.
Pull-to-refresh target < 500 ms.

**A3 — Boot stuck / "Registered" missing:**
`adb logcat | grep ServiceContext`. Common causes:
`react-native-keychain` not autolinked (rebuild the dev client);
AsyncStorage autolinking; a `react-native-keychain` ABI break.
Agent-registry "Not registered" usually means the substrate stack
failed best-effort — check `adb logcat | grep buildCircleState`.

**A4 — Pod sign-in "redirect didn't return":** `app.json` declares
`scheme: "tasks"`; `expo-auth-session`'s redirect computes to
`tasks://auth/callback`. After `expo prebuild`, confirm in
`android/app/src/main/AndroidManifest.xml`:
```xml
<data android:scheme="tasks" android:host="auth" android:pathPrefix="/callback" />
```
Inrupt DCR caches `client_id` under SecureStore key
`tasks-oidc-client`; on identity rotation run `clearStoredClient`
or wipe app data.

**A5 — Biometry lockout (deferred):** if the device locks between
launches and `KeychainVault.get('agent-privkey')` throws
`BIOMETRY_LOCKOUT`, V1 ships the Stoop-shape (no biometry gate on
the agent identity). A `useTasksAuth` biometry-lockout fallback is
**explicitly deferred** (plan §6) — re-evaluate after M3.

**A6 — Native-calendar live sync (deferred):** Phase 41.12 ships
native-write-on-demand only; the live `wireCalendarEmission`
listener is **V1.x deferred** (plan §6). To exercise the on-demand
path: flip `Settings.calendarSyncMethod` to `native` AND complete +
submit a task.

**A7 — Camera permission loop:** if "Don't allow" was tapped once,
the OS suppresses re-prompts — System Settings → Apps → Tasks →
Permissions → re-enable Camera.

## Deferrals tracked against M3

- `useTasksAuth` biometry-lockout fallback — deferred (A5).
- `wireCalendarEmission` live native-calendar sync — V1.x deferred
  (A6).
- Pod-session auto-restore from SecureStore on cold start — not
  wired in M1 (J6 notes signed-out-after-reload is acceptable for
  V1). Candidate follow-up.
- Hardware acceptance (the physical walk above) is **not
  automatable here** — this doc is the deliverable; the orchestrator
  / a human runs the device pass.
