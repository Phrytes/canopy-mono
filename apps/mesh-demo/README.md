# mesh-demo

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).
>
> **Scheme rollout deferred to Phase 8 (2026-05-04).** The full app-readme-scheme.md sections (`## Substrates` / `## Direct SDK use` / `## Bring it up` / `## What's in here`) are filled in as part of the substrate migration that ships with Phase 8 (originally Phase 6.6, rescoped because the regression check is a real-device run on the same hardware as push-wake validation). Today the app constructs a `core.Agent` directly + wires every transport — that's the right shape for an SDK demo, and the substrate migration audit will preserve the working patterns. Until then, the existing manual-bring-up + scenario docs below carry the load.

React Native app demonstrating cooperative mesh routing across BLE, WiFi/mDNS,
a relay server, and WebRTC DataChannel rendezvous.

**Groups A / B / D** — agent setup, peer list, per-peer chat.
**Group DD**       — origin-signature UI, sealed forwarding, rendezvous upgrade.

## Prerequisites

- Node.js ≥ 18
- JDK 17 (for Android builds)
- Android SDK (API 33+) via Android Studio
- A physical Android device (BLE advertising requires a real device — emulators don't support it)
- USB debugging enabled on the device

## Setup

### 1. Initialize the React Native project structure

The JS source files are already here, but the Android native project needs to be generated:

```bash
cd apps/mesh-demo
npx react-native@0.76 init MeshDemo --skip-install --directory .
# Answer "yes" if asked to overwrite — this creates the android/ directory
# Do NOT let it overwrite App.js, index.js, package.json, metro.config.js, or babel.config.js
```

### 2. Install dependencies

```bash
npm install
```

> **⚠ Heads-up: fresh `npm install` may fail with `ERESOLVE`.**
> `react-native-get-random-values@2.0.0` (latest at time of writing)
> declares a peer dep on `react-native@>=0.81`, but mesh-demo is pinned
> to RN 0.76.9 (the costly Expo 52 downgrade — don't bump without an
> explicit ask, per CLAUDE.md).  The existing `node_modules/` from an
> older install resolved to v1.x and still works.
>
> If you wipe `node_modules/` and re-install fresh, either:
>
> 1. Pin `react-native-get-random-values` to `^1.11.0` in this
>    `package.json` (matches what `apps/folio-mobile` does), or
> 2. Run `npm install --legacy-peer-deps` once.
>
> The phone's already-installed dev build is unaffected — it's compiled
> from a working snapshot.  This caveat only bites a fresh dev env.

### 3. Link native modules

React Native 0.60+ auto-links most modules, but BLE and mDNS need explicit Android setup.

**android/app/build.gradle** — add inside `android { defaultConfig { ... } }`:
```gradle
missingDimensionStrategy 'react-native-camera', 'general'
```

**android/app/src/main/AndroidManifest.xml** — add inside `<manifest>`:
```xml
<!-- BLE scanning and advertising -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<!-- mDNS / WiFi peer discovery -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
```

### 4. Run on device

```bash
npx react-native run-android
```

## Architecture

```
App.js
└── AgentProvider           (starts the agent, exposes via React context)
    └── PeersScreen         (Group A stub: shows my address + discovered peers)

src/agent.js                (Group A: createAgent — KeychainVault + mDNS + BLE)
src/context/AgentContext.js (React context + useAgent hook)
src/hooks/usePeers.js       (live peer list from PeerGraph)
src/screens/PeersScreen.js  (Group B stub UI)
```

## What Group A gives you

When two phones running this app are on the same WiFi network, they should
discover each other via mDNS within a few seconds and appear in the peer list
as **direct** peers.

When two phones are in Bluetooth range, BleTransport scans and advertises,
and they appear as **direct (BLE)** peers.

Groups B–E (peer UI, relay skill, messages, routing) are defined in
`Design-v3/relay-demo-app.md`.

## Package boundary

The SDK packages (`@canopy/core`, `@canopy/react-native`) are not modified
by this app except for the `AsyncStorageAdapter.list()` bug fix added in
`packages/react-native/src/storage/AsyncStorageAdapter.js`.

All application-level decisions live in `src/`:
- Which transports to combine → `src/agent.js`
- Whether to relay for trusted peers → `src/agent.js` (config)
- How to wire inbound hellos into PeerGraph → `src/agent.js` (`agent.on('peer', ...)`)
- UI and routing helpers → future groups

## Rendezvous / WebRTC (Group DD)

The app can lift any peer's data path off the relay onto a direct
WebRTC DataChannel once both sides advertise the capability. This is
transparent — nothing to do from the UI — but you need the right build
and a relay to make it happen.

### Expo Go caveat

`react-native-webrtc` is a native module, so **Expo Go cannot load it**.
On Expo Go the rendezvous upgrade is silently skipped (see the warning
in the Metro log); messages keep working via the relay. To actually
exercise rendezvous you need a dev build:

```
cd apps/mesh-demo
npx expo run:android                 # or: eas build --profile development --platform android
```

### Two-phone smoke test

1. Start the relay on your laptop:
   ```
   cd packages/relay && npm start
   ```
   Note the LAN IP and port it prints (e.g. `ws://192.168.1.42:8787`).
2. Install the dev build on **two** Android phones on the same Wi-Fi.
3. On each phone, enter the relay URL from step 1 in the setup screen.
4. Let both phones reach the Peers screen and hello each other (either
   via direct mDNS/BLE or through the relay).
5. A `🔗` icon should appear in the transport row of each peer within
   a second or two — that's the rendezvous-upgraded event firing.
6. Send a message. The message still delivers; round-trip is noticeably
   tighter over the DataChannel than over the relay.
7. Toggle airplane mode on/off on one phone. The `🔗` badge disappears
   as the channel closes, the next message still arrives via relay, and
   the badge re-appears once the auto-upgrade re-fires after hello.

### Disabling rendezvous

If you want to force-test relay-only behaviour without uninstalling
`react-native-webrtc`, flip `rendezvous: true` to `false` in
`src/agent.js`.

### Verified-origin badge

Incoming messages that arrived via a bridge AND carried a valid
Ed25519 signature from the original sender render a `🔒 verified`
indicator (Group Z / DD1). Direct messages omit the badge because the
sealed envelope already authenticates them; unsigned hops render the
message but without the badge.

## NKN — rendezvous-less reachability

Beyond mDNS / BLE / relay, the SDK also ships an `NknTransport`
(`@canopy/core`) that connects to the
[NKN](https://nkn.org) public messaging network.  This is useful in
the case where two phones don't share a relay URL and have no direct
LAN/BLE path — both ends only need NKN access, and the address is
derived from the agent's identity seed (no operator credentials
needed).

The mesh-demo doesn't enable NKN by default — to try it, add an
`NknTransport` to your agent in `src/agent.js`:

```js
import { NknTransport } from '@canopy/core';

const nkn = new NknTransport({ identity });
await nkn.connect();
agent.addTransport('nkn', nkn);
```

`RoutingStrategy` will then pick NKN per peer when nothing else
reaches.  See the repo root [`README.md`](../../README.md)
§Reachability for the bigger picture across all four mechanisms
(direct / relay / NKN / hop).
