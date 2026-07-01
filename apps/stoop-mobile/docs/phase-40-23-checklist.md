# Phase 40.23 — Stoop-mobile real-device pass checklist

> Tick-off list for the closed-beta acceptance test. Walk this on
> a real Android device (USB-debugging on, `adb devices` shows it).
>
> Two devices recommended for the cross-device journeys (J3, J4,
> J5). One device + a desktop Stoop install also works.
>
> Date: ___________  Tester: ___________  Device(s): ___________
>
> **For pair (two-device) scenarios** — see the cross-app pair-test
> runbook: `Project Files/conventions/pair-test-runbook-2026-05-15.md`
> §"Pair scenarios — Stoop V4 (substrate fan-out)" (S1–S5).

## Pre-flight

- [ ] `cd apps/stoop-mobile && npm install --legacy-peer-deps` runs clean
- [ ] `./node_modules/.bin/expo run:android` builds + installs the
      dev-client APK on the device
- [ ] App boots without a redbox on the first launch
- [ ] First-launch metadata privacy notice (Phase 40.22) shows; tap
      "Acknowledge" → lands on Welcome

## J1 — First launch + identity bring-up

- [ ] Welcome → "Beginnen" → identity auto-generates via
      `KeychainVault` (no visible prompt)
- [ ] Status flips to `'no-groups'`; bottom-tab shell renders
- [ ] Profile / Feed / Contacts / Settings empty-state copy
      reads sensibly ("join a group first")

## J2 — Create a group (V4 C-track storage-policy picker)

- [ ] Welcome → "Maak een nieuwe groep" → wizard
- [ ] Step 4 (kind) — radio renders five options (household /
      project / team / friends / maintenance)
- [ ] **Step 7 (storage policy) renders** four radios:
      no-pod (default) / centralised / decentralised / hybrid
- [ ] **Picking centralised or hybrid reveals the pod-URI input**
      (and hides it again on no-pod / decentralised)
- [ ] Submit → `createGroupV2` → admin invite QR shown on
      OnboardIssueScreen. Verify QR renders + scans cleanly with
      a separate scanner.

## J3 — Join via QR (second device)

- [ ] Second device → Welcome → "Scan QR-code"
- [ ] Camera opens (permission prompt OK)
- [ ] Scan device-A's QR → redeem → land in the Feed of the
      joined group
- [ ] Device-A's tasksMirror / substrate-mirror roster grows the
      second device's pubKey (verify cross-device fan-out below)

## J4 — Post a vraag with attachment + embed

- [ ] PostComposeScreen renders kind radio + text + audience
- [ ] Camera-first photo capture works (or library pick)
- [ ] Distance preset chip row renders
- [ ] **V4 C-track embed-ref slot renders** (after the photo row,
      before the submit button)
- [ ] Add an embed: type=`task`, ref=`pseudo-pod://abc/x`
- [ ] Remove the embed via the × chip — disappears
- [ ] Re-add + post. Verify post shows on device A's Feed
- [ ] **Device B's Feed shows the post within ~5s** (substrate
      fan-out via notifyEnvelope)
- [ ] Device B's post card shows the embed chip below the body

## J5 — Profile (V4 C-track My Solid pods)

- [ ] ProfileMineScreen renders header, handle input, displayName
      input, avatar picker
- [ ] Holiday toggle
- [ ] Location: GPS-acquire works (permission prompt OK)
- [ ] Skills picker — pick 3
- [ ] **V4 C-track "Mijn Solid-pods" section renders** between
      Skills and Recovery
- [ ] Initial state: `podSignInStatus` returns `signedIn:false`
      — section shows "Geen pod aan dit account gekoppeld"
- [ ] (Optional) sign in to a Solid pod via the existing sign-in
      flow → My Solid pods section flips to show WebID + attached
      status; sign-out button appears
- [ ] Recovery phrase: tap "Toon herstelzin" → 12/24 word phrase
      renders → "Sluiten" closes
- [ ] Reload app → values survive

## J6 — Cross-device chat + reveal handshake

- [ ] From device A's Feed: tap a post from device B → "Ik help"
      → chat thread opens
- [ ] Send a text message → device B receives it
- [ ] Send a photo (CHAT_PRESET) → device B receives the thumbnail
      + can tap to fetch full
- [ ] Trigger reveal handshake from device A → device B sees the
      consent prompt → accept → both sides' chat headers show the
      displayName after the round-trip

## J7 — Settings → Rotate my address (Phase 40.22)

- [ ] Settings → "Rotate my address now" → ConfirmModal
- [ ] Accept → rotation runs → new pubKey shows (mid-flight via
      `Agent.swapIdentity`)
- [ ] Chat with device B continues working (Group FF grace period)

## J8 — Push (Phase 40.22)

- [ ] Settings → Notifications → enable push
- [ ] Tap the test-push button
- [ ] Notification appears on the device

## J9 — Background fetch

- [ ] Settings → set `onlineWindow.everyMinutes` to 15
- [ ] Background the app
- [ ] Send a message from device B
- [ ] Wait ≥ 15 min (OS may clamp on Doze)
- [ ] Verify the receive arrived

## V4 substrate-mirror additional checks (2026-05-14 C-track)

- [ ] Agent-registry: after first bundle bring-up, the per-bundle
      `pseudo-pod://<deviceId>/private/agent-registry` resource
      contains an entry with `kind:'stoop-mobile'` capability tag.
      Verify via the Workspace's diagnostic surface (or
      `adb logcat | grep agent-registry` for the registration log
      line, if DEBUG_AGENT_REGISTRY=1)
- [ ] Stale-peer auto-heal: when two devices race a write, the
      receiver with the older `_v` should silently converge within
      ~1s (no UI affordance — verify by checking that posts don't
      diverge between devices after concurrent posts)
- [ ] groupCheck on fetch-resource: a non-member trying to fetch
      a resource via `fetch-resource` skill should get FORBIDDEN
      (only testable with a constructed external request — out of
      scope for the smoke pass; documented for reference)

## Battery + push numbers

After the smoke pass, capture rough numbers (see
[`battery.md`](./battery.md)):

- [ ] 8-hour idle (foreground app suspended) — % battery delta
- [ ] 1-hour active session (J2-J7) — % battery delta
- [ ] Push notification round-trip latency (test → receive) — ms

## Closed-beta APK

After everything above is green:

```bash
cd apps/stoop-mobile
./node_modules/.bin/expo prebuild
cd android && ./gradlew assembleRelease
# APK lands at android/app/build/outputs/apk/release/app-release.apk
```

- [ ] APK builds without errors
- [ ] Sign with EAS managed signing OR your own keystore
- [ ] Install signed APK on a fresh device — boots without dev-mode
      JS bundling
- [ ] All J1-J9 journeys still work on the signed build

## Sign-off

- [ ] All checked items above pass
- [ ] No redboxes or unhandled rejections during the walk
- [ ] Battery numbers captured in `docs/battery.md`
- [ ] Closed-beta APK lands in distribution channel

**Tester sign-off:** ___________  **Date completed:** ___________
