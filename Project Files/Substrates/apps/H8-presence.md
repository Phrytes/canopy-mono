# H8 (presence) — proof of location

| | |
|---|---|
| **Status** | V0 (WiFi + on-LAN-agent) shipped as `apps/presence-v0`. Real-device WiFi/BLE/mDNS validation deferred. |
| **Code** | `apps/presence-v0` |
| **Tests** | 11 |
| **Source notes** | `projects/06-proof-of-location/README.md` (+ `wifi-and-agent.md`) |

---

## Current state

**V0 shipped** — `HomeAgent` + `ProverAgent` with capability-token-shaped attestation. Default 5-min TTL. `requestAttestation`, `verify`, `attest` skills.

The shape:
- **HomeAgent** issues attestations when both WiFi + LAN-direct signals pass. Verifies its own tokens (`{id, subject, issuer, location, issuedAt, expiresAt, signals}`).
- **ProverAgent** drives the two probes (`checkWifi`, `probeHomeAgent`) via injected stubs, calls `home.requestAttestation`. Real implementations of the probes are deferred — the test suite uses fake probes that simulate WiFi-associated + LAN-reachable.

**Substrate consumption**:

| Layer | What H8 uses |
|---|---|
| **L1b (item-store)** | Audit trail — issued attestations land in the open-items store keyed by ULID |

That's the only substrate H8 V0 needs. L1e + L1f only become relevant at V1+ (witness networks).

---

## Open work

### Real-device validation (the biggest V0 gap)
The substrate-side composition is shipped + tested. What's stubbed:
- **`checkWifi` probe** — needs a real RN WiFi-info implementation (`react-native-wifi-reborn` or `react-native-network-info`). Current tests mock it.
- **`probeHomeAgent` probe** — needs to use `@canopy/core`'s `transportFor()` to distinguish LAN-direct (mDNS/BLE) from relay paths. The existing transport-name routing already supports this; H8 just needs to wire it.
- **End-to-end on phone**: install on two phones, prove one phone is "home" using the other phone's home agent.
- ~1 week of focused work per `wifi-and-agent.md`.

### V1+ scope (unchanged)
- **Witness networks** via L1e — `attest-presence` as a skill, multiple co-signers.
- **Beacon firmware** (ESP32 + e-ink + Ed25519 + TOTP rotation) — separate sub-project, not JS SDK.
- **QR / NFC / BLE capture** from beacons.
- **Multi-signal composition** (WiFi fingerprint + signed GPS + C2PA photo + witness sigs).
- **ZKP composition** (privacy-preserving "all signals from inside region X").
- **Anti-Sybil** for witnesses.
- **Push wake** for witnessing agents (waiting on Track E2c).

### Substrate-side polish that would help H8 V1+
- **L1e + L1b composition pattern** — H8 V1+ would be a good rule-of-two consumer for L1e's witness-skill broadcast pattern. None of the current substrate consumers exercise that combination.

---

## Pod schema (unchanged)

V0 (minimal):

```
<podRoot>/presence/
  attestations/<ulid>.json   # short-lived attestation tokens issued by home agent
```

V1+ extends with witness records, beacon registrations, etc.

---

## Open issues (unchanged from V0 sketch)

- Beacon hardware scope (ESP32 vs phone-to-phone NFC/BLE).
- Trust model for beacon operators (closed-group governance).
- Witness incentives (altruism vs explicit).
- ZKP-composition realism for V1.
- Privacy of the witness graph.
- GUI for the V1+ flows.
