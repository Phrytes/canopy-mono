# Shared OIDC vault (pseudo-pod-replicated) — design sketch (2026-05-14)

> Resolves transition-doc §V.4 risk: "Multiple OIDC sessions per
> WebID during Hub-free interim (pod-having users only). Three
> apps each running their own OIDC flow means three refresh
> tokens, three session-expiry races." Plus the related cross-
> device OIDC continuity gap.
>
> **Status:** design sketch only. **Implementation deferred V1.5
> / V2.** Substrate primitives exist (pseudo-pod ring, mnemonic-
> derived keys); the work is wiring them together.

## TL;DR

OIDC tokens (refresh token + issuer + client identifiers) live in
**a pseudo-pod-replicated encrypted vault**, decrypted by a key
derived from the user's existing mnemonic. Two consequences:

1. **All apps on one device share one token-set.** Stoop + Folio +
   Tasks all read the same vault → one refresh serves all → no
   rate-limit thrashing. Solves transition §V.4 risk.
2. **All of a user's devices share the token-set via the ring.**
   Sign-in on the laptop → phone gets the session via the pseudo-
   pod replication ring → no re-prompt on the phone. Cross-device
   OIDC continuity.

**Key reuse:** the user's existing mnemonic is the encryption key
source (or rather, a key derived from it). No new phrase to
remember. The mnemonic already grants access to everything else
(keypair, vault, group memberships); using it for OIDC continuity
doesn't expand the trust surface.

## Why this fits naturally

- Pseudo-pod ring already replicates resources across the user's
  own devices (substrate Phase 52.2 / V0).
- Mnemonic-derived key material is already wired (`Bootstrap.fromMnemonic`
  → keypair seed; we'd derive a separate vault-encryption key
  alongside, via the same KDF).
- `@canopy/oidc-session` + `@canopy/oidc-session-rn` are
  the existing substrates that need to consume the shared vault
  instead of their per-app stores.

## Sub-problem decomposition

### A. Encrypted vault primitive

A vault that:
- Stores `{webid → {refreshToken, issuer, clientId?, clientSecret?, expiresAt}}` maps.
- Encrypted via a key derived from the mnemonic (separate from the
  keypair seed; use a KDF subkey, e.g. HKDF with info='oidc-vault-v1').
- Persisted as a pseudo-pod resource at
  `pseudo-pod://<deviceId>/private/oidc-vault.bin` (encrypted bytes).
- Read+decrypt on substrate start; write+encrypt on token refresh.

### B. Replication

The pseudo-pod ring already syncs this resource between the user's
own devices. No new replication code; reuse Phase 52.14's `_v`
version-counter so concurrent writes on two devices converge.

The Phase 52.14 `stale-peer` event surfaces if a stale token-set
arrives from a device that's been offline — the substrate prefers
the local copy with the higher `_v`, which is the correct
behaviour (newer refresh tokens superseding older ones).

### C. Per-app shared consumption

`@canopy/oidc-session{,-rn}` substrates accept an optional
`sharedVault` opt at construction:

```js
const auth = createSolidAuthNode({
  vault,           // existing per-app vault (back-compat)
  sharedVault,     // NEW: cross-app encrypted vault (preferred when present)
  clientName: 'Stoop',
});
```

When `sharedVault` is supplied:
- Refresh-token reads / writes go through the shared vault.
- Other state (`clientId`, `clientSecret`, `issuer`) also lives in
  the shared vault keyed by webid.
- The per-app `vault` is unused for OIDC (apps may still use it
  for non-OIDC purposes).

Apps can be migrated independently — `sharedVault` is opt-in. An
app that doesn't pass it keeps its existing per-app behaviour.

### D. New-device restore path

When a user restores from mnemonic on a fresh device:

1. Mnemonic reconstitutes the keypair (existing path).
2. Mnemonic also derives the vault-encryption key (new).
3. The pseudo-pod replication ring eventually syncs the encrypted
   vault from the user's other online devices.
4. The substrate decrypts the vault → finds the refresh tokens →
   logged in to all the user's WebIDs without re-prompting.

This neatly solves the "lost-phone restore" gap from §V.4 (risk
#1 we just discussed) **for OIDC sessions specifically**. Vault-
blob recovery for keypair material remains a separate concern
(closed-beta acceptance is "retry when pod returns").

### E. Concurrency

Two devices may both refresh near-simultaneously. The pseudo-pod
ring's `_v` version-counter handles this:
- Each refresh emits a `_v+1` write to the shared vault.
- The two writes converge via Phase 52.14's 3-way compare.
- The "winning" device's tokens become the canonical set.
- The "losing" device gets a `stale-peer` event with the local
  copy; substrate retries the refresh on next access (or accepts
  the peer's newer token).

This is the same Lamport-ish convergence Q-D shipped; no new
substrate work needed beyond reusing it.

## What this does NOT do

- **Doesn't help OIDC sign-in itself** — first-time sign-in still
  goes through the OIDC redirect dance on each device. The
  shared vault makes the SECOND device's experience zero-friction.
- **Doesn't address rate limits on the IDP side** for the
  initial flow (the IDP still sees the OIDC redirect once per
  device the first time).
- **Doesn't replace the Hub.** When the Hub ships (P4), it can
  consume the same vault primitive. The Hub adds:
  user-facing-recovery UI, audit log, etc. The shared vault is a
  pre-Hub primitive that doesn't go away.

## V1.5 / V2 phase shape

| Phase | Scope | Estimate |
|---|---|---|
| 52.O1 — encrypted vault primitive | KDF subkey derivation; encrypt/decrypt; round-trip tests | ≈1.5 days |
| 52.O2 — pseudo-pod-backed persistence | resource at `pseudo-pod://<deviceId>/private/oidc-vault.bin`; replicate via ring | ≈1 day |
| 52.O3 — `@canopy/oidc-session{,-rn}` integration | `sharedVault` opt; consume in place of per-app vault | ≈1 day |
| 52.O4 — per-app adoption (Folio, Stoop, Tasks) | opt-in `sharedVault` wiring in each app's bundle | ≈0.5 day per app = 1.5 days |
| 52.O5 — tests + integration scenarios | round-trip; new-device restore; concurrent refresh; per-app migration | ≈1 day |

**Total ≈6 days V1.5 work.** Substrate-heavy (52.O1–O3); app-side
adoption (52.O4) is mechanical.

## Trigger conditions

Implement when ONE of:
1. Real users hit OIDC rate-limit thrashing (closed-beta or wider).
2. A user explicitly asks for "sign in once, all apps work."
3. The Hub-track P4 starts and wants to consume this primitive
   anyway (then implementation aligns with Hub timing).

Until then, the design stays a sketch.

## Pointers

- Transition doc §V.4 — risk this resolves
- `packages/oidc-session/src/SolidVault.js` — existing per-app vault
- `packages/oidc-session-rn/src/OidcSessionRN.js` — RN equivalent
- `packages/core/src/identity/Bootstrap.js` — mnemonic→seed KDF
- `packages/pseudo-pod/` — replication ring (Phase 52.2)
- `packages/pseudo-pod/src/PseudoPod.js` — `_v` version-counter
  (Phase 52.14) — used by E for refresh-convergence
