# mesh-demo

A runnable, three-agent mesh scenario that demonstrates the core
routing story of `@onderling/core` end-to-end. No phones, no relay
server, no BLE — everything runs in a single Node process using the
in-process `InternalTransport`.

## Run it

```
node examples/mesh-demo/index.js
```

You should see a sequence of checkmarks ending in
`all phases passed.` The script exits with code 0 on success and 1
if any assertion fails, so CI can use it as a smoke test alongside
the `vitest` suite.

## What it proves

The scenario exercises a three-agent topology where the only path
between Alice and Carol is Bob:

```
Alice  ──relay bus──  Bob  ──loop bus──  Carol
```

Phases:

1–2. **Hello handshake** between Alice↔Bob and Bob↔Carol — proves
     SecurityLayer picks up each peer's key.
3.   **Gossip** — Alice asks Bob for his peer list and adds Carol as
     an indirect peer (`hops: 1, via: bob`).
4–5. **Hop routing with origin attribution** — `alice.invokeWithHop(carol)`
     routes through Bob. Carol sees `originFrom = alice`,
     `relayedBy = bob`. Return path works the same.
6.   **`agent.forget(bob)`** — removes Bob from Alice's SecurityLayer
     and PeerGraph. Re-hello restores the connection.
9.   **Oracle bridge selection** (Group T). All three enable
     `enableReachabilityOracle()`. Alice pulls Bob's signed
     reachability claim. Next `invokeWithHop(carol)` picks Bob on the
     *first* try (oracle hit) — we spy on `alice.invoke` to prove it.
     Then we manually expire the claim and confirm the probe-retry
     fallback still delivers.

Phase 7 (BLE buffer / Group V) and phase 8 (hello gate / Group W)
are intentionally absent — they'll be wired in when those groups
ship. The matching vitest file at
`packages/core/test/integration/mesh-scenario.test.js` already has
the `test.skip` placeholders.

## Real-phone smoke test

The same scenario, wired to physical transports, is how to smoke-test
a release:

1. Start a relay server on your laptop:
   ```
   cd packages/relay && npm start         # listens on ws://<lan-ip>:8787
   ```
2. Open `packages/core/mesh-chat.html` in a browser tab (= Alice).
3. On Phone A, build `apps/mesh-demo` and connect to the same relay
   (= Bob; this phone also has Bluetooth on).
4. On Phone B, build `apps/mesh-demo` with Bluetooth only (= Carol).
5. Exercise the same six phases by hand: hello, send, observe the
   hop badge in the UI, click Forget, re-discover, etc.

A full `wss://` run (T1-b-hardened TLS) uses the same recipe with
`TLS_CERT` / `TLS_KEY` env vars on the relay — see
`packages/relay/README.md`.
