# canopy-chat — security roadmap (2026-05-23)

> Captures the v0.7.P3d/f baseline + an honest plan for the
> remaining high-value security work the user requested
> (#1 PFS, #2 signed WebID claim, #3 passphrase vault, #5 mute,
> #6 capability tokens, #7 identity-resolver, #8 signed activity
> log, #10 group encryption).
>
> CRITICAL META-FINDING: many of these primitives are ALREADY
> shipped as substrates but aren't auto-composed into new apps.
> Section 4 proposes a "safety-by-default" composition pattern so
> future apps don't have to re-wire each safety measure.

## 1. Substrate inventory (what's already shipped)

### Already shipped — currently wired in canopy-chat

| Substrate | Location | Wired? |
|---|---|---|
| `SecurityLayer` (nacl.box + Ed25519) | `packages/core/src/security/SecurityLayer.js` | ✅ v0.7.P3d |
| `AgentIdentity.rotate` + `KeyRotation.broadcast` | `packages/core/src/identity/` | ✅ `/rotate-identity` (v0.7.P3d) |
| HI auto-introduce | `packages/core/src/security/SecurityLayer.js` | ✅ v0.7.P3d |
| `Agent.security` auto-attached | `packages/core/src/Agent.js:106` | ✅ default |
| `VaultLocalStorage` (persistent identity) | `packages/vault/src/VaultLocalStorage.js` | ✅ v0.7.P3a |

### Already shipped — NOT wired in canopy-chat yet

| Substrate | Location | Plan item |
|---|---|---|
| `CapabilityToken` (signed scoped grants) | `packages/core/src/permissions/CapabilityToken.js` | #6 |
| `PodCapabilityToken` (signed scoped pod grants) | `packages/core/src/permissions/PodCapabilityToken.js` | #6 |
| `GroupManager` (Ed25519 group proofs + roles) | `packages/core/src/permissions/GroupManager.js` | #10 |
| `PolicyEngine` + `Roles` | `packages/core/src/permissions/` | #6 |
| `helloGates` (pre-shared-secret / predicate gates) | `packages/core/src/security/helloGates.js` | #5 |
| `chat-p2p` `muted` Set | `packages/chat-p2p/src/wireChat.js:93` | #5 |
| `identity-resolver` (MemberMap + Reveals) | `packages/identity-resolver/src/` | #7 |
| `webid-discovery` (predicates + WebIdCache) | `packages/webid-discovery/src/` | #2 |
| `WEBID_PREDICATES.auditLogUri` (canonical) | `packages/webid-discovery/src/predicates.js` | #8 |
| Stoop's `sealedForward` (hop-routing blindness) | `apps/stoop/src/` | (deferred — mixnet) |

### NOT yet shipped as substrates

| Feature | Status |
|---|---|
| Double-ratchet / PFS | Mentioned in Stoop's threat model as "V2 still required" |
| VaultIndexedDB passphrase wrap | Vault exists; no built-in passphrase encryption-at-rest |
| Signed WebID claim convention | predicates exist; no `<claim> <sig>` convention yet |
| WebAuthn / passkey vault unlock | Browser API ready; substrate doesn't compose it |

## 2. Per-item slice plan

### Item #1 — Perfect Forward Secrecy (Double Ratchet)

**Substrate status**: NOT shipped. Stoop's threat model flags it as
"V2 still required".

**Plan**: new substrate `@canopy/perfect-forward-secrecy` (or
extend SecurityLayer):

- Signal-protocol's Double Ratchet (root key + sending/receiving
  chain keys).
- Each envelope rotates the per-direction chain key.
- Periodic DH ratchet rotates the root key (every N envelopes OR
  on response).
- Long-lived identity keys sign the DH-handshake exchange (X3DH
  pattern); ephemerals do the actual encryption.

**Wiring point**: `SecurityLayer` gets a `usePerForwardSecrecy: true`
option. Existing code paths continue to work for legacy peers (the
ratchet establishes during HI exchange; falls back to current
nacl.box if peer doesn't support).

**Effort**: 2-3 sessions. Battle-tested implementations exist
(libsignal-protocol-javascript, npm:libsignal) — could compose
rather than reimplement.

**Tests needed**: round-trip with ratchet; key-compromise scenario
(prior messages still secure); cross-version (PFS-enabled to
legacy peer).

### Item #2 — Signed WebID claim (NKN-addr authentication)

**Substrate status**: webid-discovery + predicates exist; no
signing convention yet.

**Plan**:

1. Publish to `<pod>/canopy/identity/identity.ttl`:
   ```
   <#me> canopy:nknAddr "app.aef..." ;
         canopy:nknAddrSig "<base64-Ed25519-sig-over-(webid+nknAddr+issuedAt)>" ;
         canopy:nknAddrIssuedAt "1715800000000" .
   ```
2. New substrate function: `signNknClaim(identity, webid, nknAddr) → {sig, issuedAt}`
3. `discoverPeerNknAddr` (P3d) becomes `discoverPeerVerifiedNknAddr`:
   verifies the signature against the WebID's pubKey (from their
   profile or pre-known) BEFORE returning the addr.

**Wiring point**: extends `podStorage.js` + `webid-discovery`.
Becomes default: `publishNknAddr` always signs.

**Effort**: 1 session. Existing patterns make this small.

**Threat addressed**: "Pod-WAC attacker writes a fake nknAddr to
trick peers into talking to a MITM." With sig, peer verifies the
addr is signed by the WebID's identity → only the legit user can
publish.

### Item #3 — Passphrase-protected vault

**Substrate status**: `VaultIndexedDB` exists but NO built-in
passphrase wrap.

**Plan**:

1. Extend `VaultIndexedDB` with optional `passphrase` constructor opt.
2. On `set(key, value)`: PBKDF2-derive a key from passphrase →
   AES-GCM wrap the value → store ciphertext + IV.
3. On `get(key)`: read ciphertext+IV → AES-GCM unwrap → return.
4. Passphrase entered via UI prompt on first sign-in; cached in
   memory for session lifetime; never persisted.

**Wiring point**:
- `makeBrowserVault(prefix)` (P3a) gains a passphrase opt.
- If user has set a passphrase: prompt on every page load.
- If not: stays as today (localStorage plaintext, with a warning).

**Migration**: existing users with plaintext vaults keep working.
A `/secure-vault` command upgrades them (asks for passphrase,
re-wraps all keys, verifies, deletes plaintext).

**Effort**: 1 session. WebCrypto API does the heavy lifting.

**Threat addressed**: "Attacker with file-system access to the
browser profile dumps keys." With AES-wrap, attacker also needs
the passphrase.

### Item #5 — Mute / block list

**Substrate status**: `chat-p2p`'s `wireChat` already accepts a
`muted: Set<string>`. Just need to wire it.

**Plan**:

1. canopy-chat composes `wireChat` (currently doesn't — we use raw
   `Transport.sendOneWay` instead).
2. New persistent state: `mutedPeers: Set<nknAddr>` in
   IndexedDB.
3. `/block <addr-or-webid>` adds to set; `/unblock` removes.
4. On incoming envelope: drop if `from ∈ mutedPeers` (substrate
   already handles this).
5. Show muted peer count in `/security-status`.

**Wiring point**: replace direct transport usage with `wireChat`
substrate; pass `muted: mutedPeers` + persistor.

**Effort**: ~half session.

**Threat addressed**: "Peer harassment / spam."

### Item #6 — Capability tokens (fine-grained permissions)

**Substrate status**: `CapabilityToken` + `PodCapabilityToken`
shipped. `A2AAuth` has the verification flow.

**Plan**:

1. canopy-chat issues `CapabilityToken` for each per-app
   permission a peer requests.
2. Token shape (from existing substrate):
   ```js
   { id, issuer, subject, skill, scopes, issuedAt, expiresAt, sig }
   ```
3. `/grant <peer> <skill>` — issue a token (e.g., "Anne can post
   calendar invites to me but NOT see my files").
4. `/revoke <peer> <skill>` — invalidate.
5. Receiver presents token on each NKN envelope; `A2AAuth.verify`
   gates the dispatch.

**Wiring point**: 
- New skill (`canopy.tokens`) issuing tokens.
- `Agent` middleware checks tokens before dispatching skills.
- Tokens stored in IDB + auto-expire.

**Effort**: 1.5 sessions. Substrate is there; composition needs
care.

**Threat addressed**: All-or-nothing peer access. With caps:
explicit per-skill grants.

### Item #7 — `identity-resolver` composition

**Substrate status**: shipped (`MemberMap`, `Reveals`,
`PersonGraph`, `Resolver.resolve`).

**Plan**:

1. canopy-chat composes `MemberMap` per peer relationship.
2. New persistent state: each known peer gets a `Member` entry
   with handle, real name, external ids.
3. Reveal handshake: by default, peer shows as their handle
   ("anne"); on `/reveal <peer>`, both sides exchange real-name
   info; UI updates.
4. `/contacts` lists known peers with handle + reveal state.
5. Threads/messages render via `Resolver.resolve(viewer, target)`
   → shows handle by default, real name post-reveal.

**Wiring point**: 
- Compose `MemberMap` from chat-side IDB state.
- Replace raw NKN addresses in UI with `Resolver.resolve()`'s
  output everywhere.
- New `/reveal <peer>` command dispatches reveal handshake (via
  chat-p2p subtype 'reveal-request' / 'reveal-accept' which the
  substrate already defines).

**Effort**: 1.5 sessions.

**Threat addressed**: Persistent peer identification by external
observers (using handles obfuscates real names from logs).

### Item #8 — Signed activity log (auditable, off-device backup)

**Substrate status**: `WEBID_PREDICATES.auditLogUri` already
exists; `Stoop` has audit-log patterns.

**Plan**:

1. Every dispatch produces an audit entry:
   ```js
   { ts, actor, skill, args (redacted), result-summary, prev-hash, sig }
   ```
2. Append-only log; each entry hashes the previous → tamper-evident.
3. Signed by user's identity (Ed25519).
4. Periodically synced to `<pod>/canopy/audit-log/<date>.ttl`
   (using existing `PodWriter`).
5. `/audit-log [--since=date]` shows recent entries.
6. `/verify-log` walks the hash chain + verifies signatures.

**Wiring point**: 
- Extend EventLog (already has retention + persistence) with
  signing + hash-chaining + pod-sync.
- Could be a new substrate `@canopy/audit-log` derived from
  EventLog.

**Effort**: 1.5 sessions.

**Threat addressed**: "I can't prove what I or my agent did".
Auditable; tamper-evident; off-device backup means even device
loss doesn't lose history.

### Item #10 — Group encryption (`GroupManager`)

**Substrate status**: `GroupManager` shipped (Ed25519-signed group
proofs with roles).

**Plan**:

1. canopy-chat composes `GroupManager` for closed groups.
2. `/create-group <name>` — issue group; you're admin.
3. `/invite-to-group <peer> <group>` — issue `GroupProof` for peer.
4. Calendar invites within a group are encrypted to the group's
   ephemeral key (rotating per slot); non-members can't decrypt
   even if they intercept.
5. Group composition is itself a chat-p2p envelope subtype
   ('group-proof' / 'group-membership-update').

**Wiring point**:
- canopy-chat manages group memberships via `GroupManager`.
- Calendar `/addappt --group=family` encrypts the invite to
  group members.
- `chat-p2p` envelope shape extended with `groupId?` field.

**Effort**: 2 sessions. Group sealed-routing isn't trivial;
existing `sealedForward` from stoop gives a head-start.

**Threat addressed**: "Group context leaks if any member is
compromised or invites become public."

## 3. Suggested order

Smallest-effort-biggest-impact first:

| Order | Item | Effort | Why first |
|---|---|---|---|
| 1 | **#5** mute/block | ~½ session | Substrate ready; immediate harassment protection |
| 2 | **#2** signed WebID claim | 1 session | Prevents pod-WAC trick; tiny code; trust marker |
| 3 | **#3** passphrase vault | 1 session | Big trust improvement for at-rest threat |
| 4 | **#7** identity-resolver | 1.5 sessions | Replaces raw NKN addresses with handles; major UX + privacy |
| 5 | **#6** capability tokens | 1.5 sessions | Per-skill access; demoable for trust stories |
| 6 | **#8** signed activity log | 1.5 sessions | Auditable behaviour; pod-backed |
| 7 | **#10** group encryption | 2 sessions | Bigger surface; warrants its own design pass |
| 8 | **#1** Double-Ratchet (PFS) | 2-3 sessions | Hardest; deferred until others land |

**Total ~10-12 sessions for the full pass.** Realistic incremental
delivery; each slice is independently demoable + commitable.

## 4. Safety-by-default composition pattern

> The user's META-CONCERN: "many safety measurements have already
> been built in from the start; I'm a bit surprised they don't come
> for free for any follow-up implementation."

**Honest answer**: the substrates are ergonomic for INDIVIDUAL use,
but there's no SINGLE FACTORY that wires the safe defaults
together for a new app. Each app re-wires:
- Identity persistence (P3a wired manually for canopy-chat)
- SecurityLayer on the transport (P3d wired manually)
- HI auto-introduce on first send (P3d added manually)
- Passphrase vault (item #3 — will need manual wiring per app)
- Capability tokens (item #6 — will need manual wiring per app)

**Proposal**: new substrate `@canopy/secure-agent`:

```js
import { createSecureAgent } from '@canopy/secure-agent';

const { agent, peer } = await createSecureAgent({
  identityVaultPrefix: 'myapp-id:',
  passphrase:          await promptForPassphrase(),   // optional
  nknLib:              window.nkn,                      // optional
  capabilityIssuer:    true,                            // can issue caps
  muteListVaultKey:    'myapp-muted',
  webidClaim: {
    sign:              true,
    publishOnSignIn:   true,
  },
  groupManager:        true,
});
```

Returns an Agent + NKN-bound peer transport, with:
- Identity persisted (passphrase-wrapped if supplied)
- SecurityLayer wired
- HI auto-introduce
- Mute list loaded from vault
- Capability-token verifier on incoming envelopes
- Signed WebID claim publisher hook
- (optional) PFS Double Ratchet

Each safety measure becomes A CHECKBOX, not a manual wire-up.

**Effort to ship `secure-agent`**: ~1 session. Done after item #1
(so the factory can include PFS as an option).

**Convention addition**: amend
`Project Files/conventions/architectural-layering.md` to require
new apps using cross-peer transport to ALWAYS use `secure-agent`
(or explicitly opt out via documentation, like a `// SECURITY:
opted out because ...` comment that's grep-able for audit).

## 5. Migration impact

| Item | canopy-chat | canopy-chat-mobile (M.5) | Future new app |
|---|---|---|---|
| #1 PFS | wire in `secure-agent` | inherits | inherits |
| #2 signed claim | extend P3d's publish/lookup | inherits | inherits |
| #3 passphrase vault | UI prompt slice | inherits via RN-friendly variant | inherits |
| #5 mute | swap raw transport for `wireChat` | inherits | inherits |
| #6 capability tokens | new skill module | inherits | inherits |
| #7 identity-resolver | new contacts state | inherits | inherits |
| #8 audit log | extend EventLog | inherits | inherits |
| #10 groups | new GroupManager composition | inherits | inherits |
| `secure-agent` factory | adopt it (~1 hour migration) | use from day one | use from day one |

`canopy-chat-mobile` is the natural place to prove the
`secure-agent` factory pattern: it's a NEW consumer; if it uses
`secure-agent` from the start, all safety properties come for free.

## 6. Recommended next session start

1. Item #5 (mute/block) — half session, immediately demoable
2. Item #2 (signed WebID claim) — small, completes the trust
   loop on the WebID↔NKN bridge we just shipped (v0.7.P3d)
3. Then either: keep going down the list, OR pivot to
   `secure-agent` factory + apply it as a refactor

The refactor option (`secure-agent` first) means subsequent items
slot into a clean factory call. The straight-line option keeps
shipping value visibly. Either is valid; the user's call.

## 7. References

- `Project Files/Stoop/privacy-and-safety-2026-05-05.md` — existing
  threat model for closed-beta Stoop (much applies here)
- `Project Files/conventions/architectural-layering.md` — substrate
  composition rules
- `packages/core/src/security/SecurityLayer.js` — header docstring
  has the cleanest summary of the wire protocol
- `packages/core/src/permissions/PodCapabilityToken.js` — header
  docstring has the scope-syntax design
- `packages/identity-resolver/README.md` — when-to-use-which guide
- `packages/webid-discovery/src/predicates.js` — canonical predicate
  IRIs

---

**Authored** 2026-05-23 by Claude during the v0.7.P3d (security pass)
verification.  Edited / extended as items land.
