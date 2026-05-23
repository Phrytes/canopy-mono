# `@canopy/secure-agent`

> **Layer: substrate.** Safety-by-default agent factory.

One composition point that wires the safe defaults for any app
building cross-peer features.  Apps that compose this inherit
ALL the safety properties below as a checkbox — without re-wiring
per app.

## Why

Before this substrate, every new app re-wired:
- identity persistence
- `SecurityLayer` on the transport
- HI auto-introduce on first send
- (eventual) mute list, capability tokens, etc.

That's how safety bugs slip through (a single missed
`transport.useSecurityLayer(...)` and your envelopes go plaintext).
This factory makes those wirings the default.

## Quick start

```js
import { createSecureAgent } from '@canopy/secure-agent';

const sa = await createSecureAgent({
  identityVaultPrefix: 'myapp-id:',
  nknLib:              window.nkn,        // optional, for cross-peer
  onPeerMessage:       ({ from, payload }) => console.log(from, payload),
});

// In-process agent (e.g. for skill dispatch)
sa.agent.register('hello', async () => /* ... */);

// Cross-peer (when nknLib supplied)
const { address } = await sa.peer.connect();
console.log('my NKN address:', address);

await sa.peer.sendTo('app.peer.hex', {
  type: 'p2p-chat',
  subtype: 'chat-message',
  body: 'hello',
});

// Identity rotation
const { newPubKey } = await sa.rotateIdentity();

// Diagnostic
console.log(sa.securityStatus());

// Cleanup
await sa.shutdown();
```

### S1 — mute / block + helloGate

```js
const sa = await createSecureAgent({
  muteListVaultKey: 'myapp-mute',          // persists across reloads
  helloGate:        'shared-secret-xyz',   // or fn(env)=>bool, or { token }
  nknLib:           window.nkn,
});

await sa.mute.add('app.spammer.abc');      // drops their HI + envelopes + sends
sa.mute.has('app.spammer.abc');            // → true
sa.mute.list();                            // → ['app.spammer.abc']
await sa.mute.remove('app.spammer.abc');
```

### S3 — passphrase + passkey

```js
// Bare passphrase: vault is AES-GCM encrypted in IndexedDB
const sa = await createSecureAgent({
  passphrase:       'hunter2-correct-horse-battery-staple',
  identityVaultPrefix: 'myapp-vault',
});

// Passkey → derived secret → use as passphrase
import { unlockWithPasskey, registerPasskey } from '@canopy/secure-agent';

// First-time: register the credential
const { credentialId } = await registerPasskey({
  rpId:     window.location.hostname,
  userName: 'alice',
});
localStorage.setItem('myapp-cred-id', credentialId);

// Subsequent loads: prompt for fingerprint / Windows Hello / etc.
const secret = await unlockWithPasskey({
  rpId:         window.location.hostname,
  prfSalt:      'myapp/v1',                        // identical → identical secret
  credentialId: localStorage.getItem('myapp-cred-id'),
});
const sa2 = await createSecureAgent({ passphrase: secret });

// Or use the factory-bound helpers:
const sa3 = await createSecureAgent({
  webAuthnUnlock: { rpId: 'app.example', prfSalt: 'myapp/v1' },
});
const cred = await sa3.passkey.register();
const sec  = await sa3.passkey.unlock();
```

### S5 — caps + roles + trust

```js
const sa = await createSecureAgent({
  trustRegistry:    true,
  capabilityIssuer: { defaultExpiresIn: 24 * 3600_000 },     // 24h
  policyEngine:     true,
});

// TrustRegistry — per-peer trust state, vault-backed
await sa.trust.setTier('pk-alice', 'trusted');
await sa.trust.getTier('pk-alice');                          // → 'trusted'
await sa.trust.addGroup('pk-alice', 'crew-1');

// CapabilityToken — grant Alice the right to invoke our 'echo' skill
const token = await sa.caps.issue({
  subject: 'pk-alice',
  skill:   'echo',
  expiresIn: 3_600_000,
});
sa.caps.verify(token);                                       // → true

// Roles — constants + rank helpers
import { roleRank } from '@canopy/secure-agent';
roleRank(sa.ROLES.ADMIN) > roleRank(sa.ROLES.MEMBER);        // → true

// PolicyEngine — composed automatically when both are wired
sa.policy;   // PolicyEngine instance — use for skill-call gating
```

### S4 — identity-resolver + alias-aware mute

```js
import { MemberMap } from '@canopy/identity-resolver';

const memberMap = new MemberMap({
  initial: [
    { webid: 'https://alice.example/#me', pubKey: 'pk-alice', stableId: 'sid-alice' },
    { webid: 'https://bob.example/#me',   pubKey: 'pk-bob',   stableId: 'sid-bob'   },
  ],
});

const sa = await createSecureAgent({
  identityResolver: memberMap,
  nknLib:           window.nkn,
});

// Mute by webid — every device, every address, every key rotation
await sa.mute.add('https://alice.example/#me');

// Or by stableId — works across pod migrations + webid changes
await sa.mute.add('sid-alice');

// Resolver passthroughs
await sa.resolver.resolveByAddr('app.alice.123');     // → member object
await sa.resolver.resolveByPubKey('pk-alice');
await sa.resolver.aliasesFor('app.alice.123');        // → [addr, pubKey, webid, stableId]
```

### S2 — signed WebID claim

```js
const sa = await createSecureAgent({
  webidClaim: { webid: 'https://alice.example/profile/card#me' },
});

// Sign — pubKey + ts + exp added automatically
const claim = sa.claim.sign({ nknAddr: sa.peer.address });
// → { v:1, webid, pubKey, nknAddr, ts, exp, sig }

// Verify (e.g. after fetching from a peer's pod)
const v = sa.claim.verify(receivedClaim);
if (!v.ok) throw new Error(`claim invalid: ${v.reason}`);

// Pod-side storage
await podWriter.put('canopy/identity/claim.json', sa.claim.serialize(claim));
```

## What's wired today (S0 + S1 + S2 + S3 + S4 + S5)

S0 — foundation:
- ✅ Persistent identity (`VaultLocalStorage` in browser, `VaultMemory` elsewhere)
- ✅ Agent with auto-`SecurityLayer` (signed + nacl.box encrypted envelopes)
- ✅ Optional `NknTransport` wired with `useSecurityLayer`
- ✅ Auto-HI on first send (recipient registers our pubKey)
- ✅ Bilateral HI on receive (we register their pubKey too)
- ✅ `rotateIdentity` wrapper (7-day grace + `KeyRotation.broadcast`)
- ✅ `securityStatus()` diagnostic

S1 — mute / block + helloGate:
- ✅ `muteListVaultKey` opt → persistent `sa.mute.{add,remove,has,list,clear,size}`
- ✅ Drop inbound envelopes from muted peers (before `onPeerMessage`)
- ✅ Refuse outbound `peer.sendTo` to muted peers (throws)
- ✅ `helloGate` opt: fn / PSK string / `{ token }` — composed AND mute base gate

S2 — signed WebID claim:
- ✅ `sa.claim.sign({ webid?, nknAddr?, ttlMs? })` — Ed25519-signed binding
- ✅ `sa.claim.verify(claim)` — returns `{ ok, body | reason }`; checks sig + exp + ts skew
- ✅ `sa.claim.{serialize,parse}` — JSON for pod-side storage
- ✅ `webidClaim: { webid }` factory opt binds default WebID

S5 — capabilities + roles + trust:
- ✅ `trustRegistry: true | { vault }` factory opt → `sa.trust` (TrustRegistry instance)
- ✅ `capabilityIssuer: true | { defaultExpiresIn }` → `sa.caps.{issue,verify}`
- ✅ `policyEngine: true | { groupManager, isRevoked, actorResolver }` → `sa.policy`
- ✅ `sa.ROLES` + module re-export of Roles primitives

S4 — identity-resolver + alias-aware mute:
- ✅ `identityResolver: memberMap` (or `{ memberMap }`) factory opt
- ✅ `sa.resolver.{resolveByAddr,resolveByPubKey,resolveByWebid,resolveByStableId,aliasesFor}`
- ✅ Mute now matches across the FULL alias set — `mute.add(webid)` blocks the peer
  on every device, every address, after every key rotation

S3 — passphrase vault + WebAuthn passkey:
- ✅ `passphrase: 'string'` factory opt → vault picker promotes to `VaultIndexedDB`
  (PBKDF2 + AES-GCM, browser/IndexedDB)
- ✅ `webAuthnUnlock: true | { rpId, prfSalt, ... }` factory opt → exposes
  `sa.passkey.{register,unlock}`
- ✅ Standalone `registerPasskey` / `unlockWithPasskey` use the CTAP2 PRF
  (hmac-secret) extension to derive a deterministic 32-byte secret from a
  passkey — feed that into `passphrase` for a passkey-protected vault
- ✅ Clear error codes (`PASSKEY_NO_WEBAUTHN`, `PASSKEY_PRF_UNAVAILABLE`,
  `PASSKEY_REGISTRATION_REJECTED`, `PASSKEY_UNLOCK_REJECTED`) for fallbacks

## What's reserved (future S slices)

Each opt is RESERVED in the factory signature today.  Setting it
emits a `[secure-agent] opt "X" is RESERVED for a future slice`
warning + preserves the value on `.pendingOpts.X` until the slice
lands.  No app-code change needed when each slice activates.

| Opt | S slice | Item |
|---|---|---|
| `auditLog` | S6 | A.6 signed activity log |
| `groupManager` | S7 | A.7 GroupManager closed groups |
| `a2aTls` | S7 | A+.4 future A2A protocol |
| `rateLimit` | S7 | A+.8 DoS protection |
| `usePerfectFwdSec` | S8 | A.1 Double-Ratchet PFS |

See `Project Files/canopy-chat/security-roadmap-2026-05-23.md`
for the full plan + per-slice scope + tests + threat-addressed.

## Convention

After the factory + at least one S slice lands, the architecture
convention (`Project Files/conventions/architectural-layering.md`)
will be amended:

> **Security-by-default for cross-peer apps.**  New apps composing
> a real network transport (NKN, WebRTC, relay) MUST use this
> factory.  Per-property opt-outs require a grep-able
> `// SECURITY: opted out — <reason>` comment co-located with the
> manual wiring so the decision is auditable.

## Composition pattern (vs apps' in-process topologies)

`@canopy/secure-agent` builds ONE agent + ONE optional cross-peer
transport — clean, single-purpose.

Apps that need multi-agent in-process topology (e.g. canopy-chat's
`hostAgent` + `chatAgent` on the same `InternalBus`) build that
topology themselves AND compose `secure-agent` for the cross-peer
agent.  No conflict — the factory's agent is a SEPARATE agent on
its own InternalBus.

## Testing

```bash
pnpm --filter @canopy/secure-agent test
```

70/71 passing (1 skipped pending integration test infrastructure
for sig-validated envelopes; the bilateral HI auto-handshake's
wiring is in place + verified in canopy-chat's two-tab demo).

## Where this came from

Lifted patterns from:
- `apps/canopy-chat/src/web/realAgent.js` (v0.7.P3a — identity
  persistence + restoreOrGenerate) — promoted to `vault.js`
- `apps/canopy-chat/src/web/realAgent.js` (v0.7.P3d — SecurityLayer
  wiring + auto-HI + rotation) — promoted to `createSecureAgent.js`
- `apps/canopy-chat/manifest.js` (v0.7.P3d — `/rotate-identity` and
  `/security-status` commands) — corresponding factory methods
  `sa.rotateIdentity()` and `sa.securityStatus()`

See git history for the per-file lift.
