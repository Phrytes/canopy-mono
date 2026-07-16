# iOS reliable-wake runbook (the native follow-up)

**Status: NEEDS ON-DEVICE VERIFICATION BY FRITS.** This runbook describes the
**native iOS work** that the offline-delivery M2 substrate is built to plug into.
The substrate — the durable sealed inbox, the reliable-wake payload, the
`.ios` adapter slots — is built and hermetically tested in this repo. The pieces
below are **Swift / Xcode / Apple-account** work that **cannot be built or
verified in the SDK sandbox** (no Apple developer account, no device). Do not
treat the reliable-wake path as "working on iOS" until the acceptance test at the
bottom (**S11 with the app KILLED**) passes on a real device.

## What is already built (the substrate this lands on)

- **Durable sealed inbox** on the companion node (rung-c holder):
  `../apps/companion-node/src/sealedInbox.js`, wired into
  `../apps/companion-node/src/index.js` (`inbox.deposit` / `inbox.drain` /
  `inbox.count`). Sealed-only (refuses non-sealed deposits, never decrypts),
  owner-gated drain, file-backed durability, contentless drain digest (M1
  batching). Proven by `../apps/companion-node/test/companionInbox.test.js`.
- **Reliable-wake payload** behind the `PushSender` port:
  `../packages/relay/src/push/wakePayload.js` +
  `ReliableExpoPushSender` in `../packages/relay/src/push/ExpoPushSender.js` —
  alert-push + `mutable-content:1` + a **contentless** data body
  (`{wake, hint}`). Proven by `../packages/relay/test/push/reliableWake.test.js`.
- **The `.ios` adapter slots** (JS side satisfies the port contracts today):
  `../packages/react-native/src/ports/pushAdapters/IosPushAdapter.js` and
  `../packages/react-native/src/ports/backgroundAdapters/IosBackgroundAdapter.js`.
  Their native operations are marked `@todo native` and are exactly the work
  below.
- **The end-to-end journey (hermetic):** `../apps/tasks-v0/test/j-offline.test.js`
  proves hold → wake → reconnect → drain → deliver with no message loss and no
  plaintext at the inbox.

## The reliable "wake → pull → render" loop (what native must do)

On iOS a backgrounded/killed app's sockets freeze; only an Apple-routed push
(APNs) can wake it. **Silent push (`content-available:1`) is the unreliable
path** — opportunistic, throttled, dropped in Low Power Mode. The reliable path,
used by Signal and Element/Matrix, is an **alert push carrying
`mutable-content:1`**, which hands CPU to a **Notification Service Extension
(NSE)** on ~every delivery, before the alert is shown:

1. The companion node / relay sends the **contentless reliable wake** (via
   `ReliableExpoPushSender`): an alert with `mutable-content:1`, a **generic
   placeholder alert** ("New activity") that names nobody and nothing, and data
   `{wake, hint:'message-pending'}`.
2. iOS invokes the **NSE (native, Swift)**. The NSE must:
   1. read the **App-Group-shared** session + recipient keys (written by the app
      via the `SecureStore` port into the shared container);
   2. **fetch** the sealed blob from the owner's companion inbox — call
      `inbox.drain` over the relay (capability-gated); the node holds it durably;
   3. **decrypt on device** with the recipient key (`@onderling/pod-client/sealing`
      `open`) — decryption never happens on the node;
   4. **rewrite** `bestAttemptContent.title/body` with the real message (or
      suppress it) before `contentHandler(...)` fires.
3. On next foreground, the **BGTask cold-start drain**
   (`IosBackgroundAdapter.defineColdStartTask`) pulls anything the NSE missed, so
   nothing is lost.

The JS `IosPushAdapter._deliver` / `IosBackgroundAdapter._wake` are the bridge
points the native NSE/app calls into. **The NSE process itself is native and is
the follow-up.**

## Native configuration checklist

All of this is Xcode / Expo config-plugin / Apple-portal work — none of it exists
or is verifiable in this repo.

- **NSE target.** Add a *Notification Service Extension* target. It is a separate
  binary; in managed Expo it requires a **config plugin / prebuild** (`expo
  prebuild`) — it is **not** available in pure managed Expo. The plugin injects
  the NSE target, its `Info.plist`, and its entitlements.
- **`UIBackgroundModes`** (app `Info.plist`): `remote-notification`, `fetch`,
  `processing`.
- **APNs entitlement**: `aps-environment` (`development` / `production`).
- **BGTaskScheduler identifiers**: register the app-refresh / processing task ids
  in `Info.plist` under `BGTaskSchedulerPermittedIdentifiers`, and
  `BGTaskScheduler.register(forTaskWithIdentifier:)` at launch.
- **App Group** (`group.<bundle-id>`): shared container so the app and the NSE
  share the session + keys. Both the app target and the NSE target must declare
  the same App-Group entitlement. The `SecureStore` port writes here.
- **Push credential**: a per-deployment APNs key/cert (or Expo push credential).
  For MVP the Expo `exp.host` hop is acceptable; move to **direct APNs** before
  public launch to drop the extra intermediary (see the offline-delivery plan's
  metadata-floor discussion).
- **Encryption export**: `ITSAppUsesNonExemptEncryption=YES` + the standard
  exemption + the BIS self-report (paperwork; every messenger does it).

## Expo config-plugin sketch

A config plugin (`app.config.js` → `plugins`) must: add the NSE target + its
`Info.plist`; add the App-Group + APNs entitlements to both targets; add the
`UIBackgroundModes` and `BGTaskSchedulerPermittedIdentifiers` keys; and copy the
Swift NSE source into the target. Ship the Swift NSE as plugin assets. This
requires `expo prebuild` and an EAS build — it is **not** exercised by any test
here.

## Acceptance test — S11 with the app KILLED (Frits, on device)

The substrate's DoD is met in-repo; the **native DoD** is this on-device test:

1. Real device, app **force-killed** (swiped away), ideally in **Low Power
   Mode** (to prove it beats the silent-push path).
2. From another account, send a message to this user while their device is away.
3. The companion node holds it sealed and fires the reliable wake.
4. **Expect:** the NSE wakes, fetches + decrypts, and a notification with the
   **real message text** appears within seconds — no app foregrounding required.
5. Open the app: the cold-start drain shows the same message, exactly once (no
   loss, no duplicate).

Until step 4 passes on a real device, the reliable-wake path is **scaffolded, not
proven**. The in-repo tests prove everything up to the APNs boundary; the NSE is
the last mile only a device can verify.
