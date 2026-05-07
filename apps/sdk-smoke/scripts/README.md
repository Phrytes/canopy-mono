# sdk-smoke laptop-side scripts

Companion scripts for scenarios that need a host-side counterpart.
Run with Node ≥ 20 from the repo root or `apps/sdk-smoke/`.

---

## S11 — Push wake-up (E2c)

End-to-end real-device test for `MobilePushBridge` (receive) +
`ExpoPushSender` + relay token registry + relay wake hook (send).

### Why a LAN IP is required (and mDNS isn't a substitute)

This test is **specifically** verifying the relay+push code path, which
is the only mechanism the SDK has to wake an offline/backgrounded peer.
mDNS is a peer-to-peer discovery + transport — it requires both
devices' JS engines and network stacks to be active, which a backgrounded
phone is not. mDNS also has no "queue for an offline peer" or "wake the
device" primitive. Substituting mDNS would mean we never exercise
`tryWakePush`, the offline queue, or `RelayTransport`'s reconnect-and-drain
loop — i.e. we'd be testing a different code path and calling it a push
test.

For other smoke scenarios (S3 direct pod-sync, S5 cap-share, S8 skills
pubsub) where both devices are foregrounded, mDNS is the right transport
and `createMeshAgent` already wires it up — no IP config needed there.

(Future possibility: relay-discovery-via-mDNS — i.e. the relay advertises
itself on the LAN so apps don't need a hardcoded URL. Not implemented today;
the relay is a server, not a peer, and `MdnsTransport` is peer↔peer only.)

### Platform note

This test plan is **Android-only** for now. iOS push verification is
deferred per the sdk-smoke top README (Q-Smoke.1, locked 2026-04-29) and
broader project direction (real-device iOS not in scope until a much later
stage). All instructions below assume an Android device.

### One-time setup

1. **Install peer-deps in this app.** From repo root:

   ```bash
   cd apps/sdk-smoke
   npm install
   ```

   Picks up the new `expo-notifications`, `expo-constants`, and
   `@canopy/relay` (devDep, used only by these scripts).

2. **Provision an EAS project ID.** Expo can't mint push tokens without one.
   - In Expo dev: `npx eas init` (creates a project, writes the ID to
     `app.json` automatically).
   - Or edit `apps/sdk-smoke/app.json` manually under
     `expo.extra.eas.projectId`.
   - Or set the env var before launching: `EXPO_PUBLIC_EAS_PROJECT_ID=...`

3. **Make sure both devices and laptop are on the same Wi-Fi**, and
   the laptop's LAN IP is reachable from the phone (firewall off).

4. **Update `apps/sdk-smoke/src/lib/config.js` `RELAY_URL`** to point
   at your laptop's LAN IP (the relay-with-push script logs the
   URL at startup).

### Running the test

Three terminals.

#### Terminal 1 — relay (laptop)

```bash
cd apps/sdk-smoke
npm run relay:push
```

Logs the URL to use. The relay starts with `ExpoPushSender` wired and a
fresh in-memory `PushTokenRegistry`. Default port 8787; pass an arg to
override.

If your Expo project enforces enhanced security, set
`EXPO_ACCESS_TOKEN` first.

#### Terminal 2 — phone (Expo dev build)

```bash
cd apps/sdk-smoke
npm run ios       # or: npm run android
```

In the harness:
1. Press **S1 — Bootstrap** to construct the agent.
2. Press **S11 — Push wake-up**. The scenario logs:
   - The push token it received (truncated).
   - The agent's pubKey — **copy this** for the next step.
   - The trigger command to run.
   - "waiting up to 60s for the wake skill to fire…"
3. **Background the app** (home button, lock screen — anything that
   stops it being foreground).

#### Terminal 3 — trigger (laptop)

While S11 is in its 60s wait window AND the phone is backgrounded:

```bash
cd apps/sdk-smoke
npm run trigger:s11 -- ws://<laptop-LAN-IP>:8787 <phone-pubkey>
```

Or directly:

```bash
node apps/sdk-smoke/scripts/trigger-s11.mjs ws://192.168.1.10:8787 A1B2C3...
```

The trigger script:
- Connects to the relay as an ephemeral peer.
- `agent.invoke()`s `s11-wake` on the phone.
- Phone is offline → relay queues the envelope → fires push wake.
- Phone wakes → `RelayTransport` reconnects → drains queue → A2A
  dispatches `s11-wake` → S11's harness Promise resolves.

### What success looks like

**Relay logs (Terminal 1):**

```
[relay] registered   <phone-pubkey-prefix>
[relay] push-tok-reg <phone-pubkey-prefix> (ios)     # phone ran S11
[relay] disconnected <phone-pubkey-prefix>           # phone backgrounded
[relay] registered   <trigger-pubkey-prefix>         # trigger connected
[relay] <trigger> → <phone>                           # trigger sent
                                                      # peer offline → queued → push fires
                                                      # (silent — no relay log line for that)
[relay] registered   <phone-pubkey-prefix>           # phone reconnected after wake
                                                      # queue drains: [relay] send-queued ...
```

**Phone harness (Terminal 2):**

```
S11: ✓ s11-wake skill ran (0 parts)
S11: pass — wake delivered + skill ran at 2026-05-04T...
```

**Trigger (Terminal 3):**

```
trigger-s11: ✓ s11-wake completed in 4123ms
```

### What can go wrong + diagnosis

| Symptom | Likely cause | Fix |
|---|---|---|
| `S11: SKIP — adapter import failed` | `expo-notifications` not installed | `npm install` in `apps/sdk-smoke` |
| `S11: SKIP — EAS project ID not found` | Step 2 above not done | `npx eas init` or edit `app.json` |
| `S11: FAIL — bridge.register: PUSH_PERMISSION_DENIED` | User denied notification prompt | Settings → SDK Smoke → enable Notifications |
| `S11: FAIL — relay.registerPushToken: ... did not acknowledge` | Relay doesn't have `pushSender` configured | Run `npm run relay:push` (not the bare relay) |
| `S11: FAIL — relay.registerPushToken: Relay: push not configured` | Same as above | Same |
| Phone never wakes (60s timeout) | Background-fetch suppressed; missing `UIBackgroundModes`; iOS heuristic throttled | Check `app.json` includes `ios.infoPlist.UIBackgroundModes: ["remote-notification"]`. Try with screen on, briefly out of app. iOS Low Power Mode kills push wake — turn it off. |
| Trigger errors with `Relay: not connected` | Wrong relay URL | Use the URL the relay-with-push script printed |
| Push fires but app doesn't reconnect | `RelayTransport.connect()` doesn't run on wake | Add a `'push'` handler in App.js that calls `agent.transport.connect()` if needed (open issue if you hit this) |

### How this exercises each piece

- **`MobilePushBridge`** (device-side, `@canopy/react-native`) —
  receives push, dispatches `'push'` event.
- **`ExpoNotificationsAdapter`** (peer-dep) — Expo notification listener.
- **`RelayTransport.registerPushToken`** (`@canopy/core`, added 2026-05-04) —
  ships token to relay over the existing socket.
- **`PushTokenRegistry`** (`@canopy/relay`) — relay's address→token map.
- **`ExpoPushSender`** (`@canopy/relay`) — relay calls Expo's HTTP push API.
- **`server.js` `tryWakePush`** (`@canopy/relay`) — fires push when an
  envelope queues for an offline peer.
- **`server.js` offline queue + drain on reconnect** — delivers the
  queued envelope when phone reconnects.
- **`Agent.invoke` over A2A** — trigger side; `taskExchange.handleTaskRequest`
  on the phone; `s11-wake` skill registered by the scenario.

The whole pipeline runs end-to-end on the live device — no mocks, no
fakes. If S11 returns `pass`, the E2c push-wake loop is verified.
