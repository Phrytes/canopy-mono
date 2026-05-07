# Changelog — @canopy-app/presence-v0

## [0.1.0] — 2026-05-02

H8 V0 — initial release.  Phase C; phone-side prover + home-agent
issuer for "WiFi + on-LAN-agent" presence attestation.

### Added

- `HomeAgent` — issues short-lived attestation tokens when prover
  signals (wifiAssociated + lanReachable) both pass.  Logs every
  attestation via L1b ItemStore audit trail.
- `ProverAgent` — phone-side flow: WiFi check → LAN probe →
  request attestation → return token or error result.
- `LocalPresenceProbe` interface for stubbable probes (RN-side WiFi
  info + SDK transport-routing probe).
- `AttestationToken` shape — capability-token-like with
  `{id, subject, issuer, location, issuedAt, expiresAt, signals}`.
- 11 integration tests across happy-path, denial paths, token
  verification, custom TTL.

### Substrate dependencies

- `@canopy/item-store` (L1b) — audit log for issued attestations

Most logic at the SDK transport layer (already shipped per topology
audit); H8 V0 is mostly the agent shape + UX flow.

### V0 scope

- Phone-side WiFi-association + LAN-direct probe
- Home-agent attestation issuance + verification
- 5-minute default TTL
- Unsigned tokens (V1 adds Ed25519)
- GDPR: WiFi data stays on user's devices

### Deferred to V1+

- Witness networks via L1e (skill-match, closed-group co-sign)
- Signed beacons (ESP32 + Ed25519 + TOTP rotation)
- QR / NFC / BLE capture
- Multi-signal composition + ZKP
- Real-device validation against a real Android phone + home-agent on LAN
