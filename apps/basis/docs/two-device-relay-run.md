# Two-device run — household no-pod sync over a LAN relay (laptop + phone)

Run the real v2 circle app on two devices and watch a household item added on one cross
to the other **over a relay, with no pod**. This is the browser counterpart of the
automated proof in `test/live/layer3RelaySync.live.test.js` (which runs the same
`connectPeerTransport` relay-only path headless).

Transport-neutral / local-first: a configured relay alone is enough — NKN is **not**
required (the app brings the relay up even when the NKN CDN doesn't load).

## 0. One-time
Both devices must be on the **same Wi-Fi/LAN**. Find the laptop's LAN IP (here `192.168.2.20`):
```
hostname -I | awk '{print $1}'
```

## 1. Start the relay (laptop) — bound on all interfaces so the phone can reach it
```
cd packages/relay && PORT=8787 node bin/relay.js
```
It listens on `0.0.0.0:8787` → reachable at `ws://192.168.2.20:8787`.

## 2. Point the app at the LAN relay
```
cd apps/basis
cp .env.example .env.local
# edit .env.local:  VITE_CIRCLE_RELAY_URL=ws://192.168.2.20:8787
```

## 3. Serve the app to the LAN (laptop)
```
npm run dev -- --host        # vite, reachable at http://192.168.2.20:5173
```
- **Laptop**: open `http://localhost:5173`
- **Phone** (same Wi-Fi): open `http://192.168.2.20:5173` in its browser

Each device's console should log `[circleApp] peer transport connected (relay, routed) …`
(or `nkn + relay` if the CDN loaded).

## 4. Pair the two devices
Production feeds the household roster from the circle's members (`listGroupRoster →
addHouseholdPeer`). For a quick test without standing up the invite flow, a **dev build**
exposes a pairing helper (gated to `import.meta.env.DEV`):

- On **each** device console, read its address: `ccMyAddr`  (also logged after ~2s)
- On **each** device, add the other's address:
  ```js
  ccPairHousehold("<the OTHER device's ccMyAddr>")
  ```

(When you do have a real circle with both devices as members, step 4 happens
automatically — `feedHouseholdRosterForCircle` runs on open.)

## 5. Verify
- On the **laptop**, add a household item (chat: `@assistant add olive oil to the shopping
  list`, or the household add UI).
- Within ~1s it appears in the **phone's** household list — carried publish-on-write →
  secureMeshEnvelopeAdapter → `sa.peer.sendTo` → relay → `handleInbound` → mirror. No pod.
- Add one on the phone → it appears on the laptop (bidirectional).

## Confidential LLM (optional, laptop only)
To drive adds via the live Privatemode LLM, run the loopback proxy on the laptop and set
the `VITE_CIRCLE_LLM_*` vars in `.env.local` (see `.env.example`). The phone does **not**
run a model — phone-side confidential LLM needs the attested enclave gateway (Option B,
not built). The route guard (`@onderling/llm-client/routeSafety`) refuses a non-loopback
confidential endpoint, so the laptop's loopback proxy is the production-safe shape today.
```
