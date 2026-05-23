# canopy-chat — security roadmap (2026-05-23, rev. 2)

> Per user direction 2026-05-23: **B first** (secure-agent factory),
> **then A** (the per-item slices, including ones the first
> roadmap missed).  Revision 2 expands the substrate inventory
> after the second audit pass + adds explicit slot-into-factory
> tags so every item lands cleanly into the factory's API.

## Phase order

```
B   →   A.1   →   A.2   →   A.3   →   …   →   A.N
factory     items in sequence, each landing into the factory's API
```

After each A slice, the factory gains a new opt-flag that any new
app composing the factory gets for free.

---

## PART B — `@canopy/secure-agent` factory

### B.0 — What this substrate is for

A single composition point that wraps the safe-by-default wiring of:

- persistent identity (with optional passphrase + WebAuthn unlock)
- `Agent` + `SecurityLayer` (signed + encrypted envelopes)
- `NknTransport` with `useSecurityLayer` + auto-HI
- chat-p2p `wireChat` with `muted` set
- `CapabilityToken` issuance + verification via `TokenRegistry`
- `identity-resolver` (handle-first display)
- signed activity log → pod
- `GroupManager`
- (later) Double-Ratchet PFS

Each apps composes ONE thing — `createSecureAgent({ ...flags })` —
and inherits every safety property the substrate offers at the
flag's default.

### B.1 — Public API (initial scope — minimal slot for A items)

```js
import { createSecureAgent } from '@canopy/secure-agent';

const sa = await createSecureAgent({
  // Identity ─────────────────────────────────────
  vault,                  // optional pre-made Vault; else VaultLocalStorage
  identityVaultPrefix,    // default 'sa-id:'
  // [A.3] passphrase     // future: passphrase-wrap vault
  // [A.X] webAuthnUnlock // future: passkey-based vault unlock

  // Cross-peer transport ─────────────────────────
  nknLib,                 // window.nkn / RN nkn-sdk (optional)

  // Safety defaults (all ON when applicable) ─────
  // [A.1] muteListVaultKey   // chat-p2p muted Set persistence
  // [A.2] webidClaim         // { sign:true, publishOnSignIn:true }
  // [A.4] identityResolver   // MemberMap + Reveals composition
  // [A.5] capabilityIssuer   // CapabilityToken + TokenRegistry
  // [A.6] auditLog           // signed activity log → pod
  // [A.7] groupManager       // GroupManager for closed groups
  // [A.8] usePerfectFwdSec   // future Double-Ratchet

  // Hooks ────────────────────────────────────────
  onPeerMessage,          // ({from, payload}) => void
  podWriter,              // for webid-claim publish + audit-log sync

  // Diagnostics ──────────────────────────────────
  warnOnInsecure: true,   // console.warn when a safety prop is off
});

// Returned shape (initial B scope) ───────────────
sa.agent                  // @canopy/core.Agent (in-process)
sa.identity               // { pubKey, stableId, vault }
sa.peer.connect()         // → Promise<{address, status}>
sa.peer.sendTo(addr, env) // sends; auto-HI on first contact
sa.peer.status            // 'idle' | 'connecting' | 'connected' | 'error'
sa.peer.address           // NKN address (after connect)
sa.rotateIdentity(opts)   // wraps Agent.rotateIdentity + broadcast
sa.securityStatus()       // diagnostic (initially: identity + peer status)
sa.shutdown()             // close transport, unsubscribe, persist state
```

After each A slice, the factory return-shape gains additional methods
(`sa.mute(addr)`, `sa.issueCap(...)`, `sa.resolve(webid)` etc.) and
internal opt flags switch from placeholder-no-ops to actual wiring.

### B.2 — Initial B implementation scope (what lands in the FIRST slice)

| Wired | Notes |
|---|---|
| ✅ `VaultLocalStorage` / `VaultMemory` selector | borrowed from canopy-chat `makeBrowserVault` (v0.7.P3a) |
| ✅ `restoreOrGenerate(vault)` for `AgentIdentity` | borrowed from canopy-chat |
| ✅ `Agent` with `SecurityLayer` (already default) | core's default |
| ✅ `NknTransport.useSecurityLayer(agent.security)` | from v0.7.P3d |
| ✅ Auto-HI on first send | from v0.7.P3d |
| ✅ `rotateIdentity` wrapper | from v0.7.P3d |
| ✅ `securityStatus()` diagnostic | from v0.7.P3d |
| ⚠️ All other safety flags = stubbed | future slices fill in |

### B.3 — Tests

- `createSecureAgent()` with no opts → in-process Agent only
- `createSecureAgent({ nknLib: fakeNkn })` → peer transport wired
- Identity persists across two factory invocations (same vault prefix)
- `sa.rotateIdentity()` produces new pubKey + grace period
- Auto-HI: first `sendTo` to new addr → HI then payload
- `warnOnInsecure:true` logs when flags are off

### B.4 — Effort

~1 session for the foundation.  Each A slice adds ~10-30 lines to
the factory.

### B.5 — Refactor canopy-chat to use it (after foundation lands)

Separate slice.  Replace canopy-chat's hand-wired
`createRealHouseholdAgent`'s peer transport + identity setup with
`createSecureAgent`.  In-process hostAgent + chatAgent for skills
remain unchanged.

---

## PART A — items in execution order

Order tuned for: substrate-already-there first; ergonomic-payoff
visible early; foundational pieces before deeper ones.

### A.1 — `#5` Mute / block list

**Substrate status**: SHIPPED — `chat-p2p`'s `wireChat` accepts a
`muted: Set<string>`.

**Slot into factory**: `muteListVaultKey` opt.  Factory loads from
vault on boot, persists on every mutation.

**API additions**:
```js
sa.mute(addr)        // returns Promise (persist + apply)
sa.unmute(addr)
sa.isMuted(addr)
sa.mutedPeers()      // → Array<string>
```

**Wiring point**: factory subscribes to peer-transport receive +
drops envelopes from `mutedPeers`.  No app-level code needed.

**canopy-chat surface**: new `/mute <peer>` + `/unmute <peer>` +
`/mute-list` builtins.

**Effort**: ½ session.  **Threat**: harassment, spam.

---

### A.2 — `#2` Signed WebID claim

**Substrate status**: `webid-discovery` predicates SHIPPED.  No
signing convention yet.

**New convention** (decided in this slice):
```turtle
@prefix canopy: <https://canopy.dev/ns#>.
<#me> canopy:nknAddr     "app.aef..." ;
      canopy:nknAddrSig  "<base64 Ed25519 sig over webid|nknAddr|issuedAt>" ;
      canopy:nknAddrIssuedAt "1715800000000" .
```

**Slot into factory**: `webidClaim: { sign:true, publishOnSignIn:true }`.

**API additions**:
```js
sa.signClaim(payload)             // returns {sig, issuedAt}
sa.verifyPeerClaim(webid, claim)  // → { ok, webid, addr, signer }
sa.publishWebidClaim(podWriter)   // re-publish (after /rotate-identity)
```

**Wiring point**: factory verifies on `discoverPeerNknAddr`; if
verification fails → returns null (forces user to re-confirm or
peer to re-publish).  Optional `strictMode` rejects unsigned
claims entirely.

**Effort**: 1 session.  **Threat**: pod-WAC attacker writes a fake
addr → MITM the peer's connection.

---

### A.3 — `#3` Passphrase-protected vault

**Substrate status**: `VaultIndexedDB` exists but no built-in
passphrase wrap.

**New substrate function** added to `@canopy/vault`:
`createPassphrasedVault({inner: vault, passphrase})` — wraps each
`set/get` with AES-GCM (key derived via PBKDF2 from the passphrase).

**Slot into factory**: `passphrase` opt.
- If passed: wraps inner vault.
- If not: warns via `warnOnInsecure` (configurable).

**API additions**:
```js
sa.setPassphrase(pp)        // upgrades existing vault to wrapped
sa.requirePassphrase(pp)    // verifies, used on app boot
sa.clearPassphrase()        // memory only; doesn't unwrap on disk
```

**Wiring point**: vault constructor.

**Effort**: 1 session.  **Threat**: file-system access to browser
profile exfiltrates keys.

---

### A.4 — `#7` Identity-resolver (MemberMap + Reveals)

**Substrate status**: SHIPPED.  `MemberMap`, `Reveals`,
`Resolver.resolve`, `PersonGraph`.

**Slot into factory**: `identityResolver: true`.  Factory composes
`MemberMap` from per-peer state in the vault.

**API additions**:
```js
sa.addContact({webid, handle, displayName?, nknAddr?})
sa.resolveDisplay(targetWebid, viewer=self) // → display string
sa.contacts()                                // → MemberMap snapshot
sa.requestReveal(peer)                       // sends reveal-request
sa.acceptReveal(peer)
```

**Wiring point**: 
- peer-transport receive handler routes 'reveal-request' /
  'reveal-accept' envelopes to MemberMap (substrate has this).
- canopy-chat UI replaces raw NKN addresses with resolveDisplay()
  everywhere (Main thread, /logs, /me).

**Effort**: 1.5 sessions.  **Threat**: persistent identification by
external observers; cognitive load (NKN addrs in UI).

---

### A.5 — `#6` Capability tokens (per-skill permissions)

**Substrate status**: SHIPPED.  `CapabilityToken`,
`PodCapabilityToken`, `TokenRegistry`, `PolicyEngine`,
`A2AAuth` (tiered auth).

**Slot into factory**: `capabilityIssuer: true`.  Factory wires a
`TokenRegistry` + composes `PolicyEngine` to gate every inbound
skill dispatch.

**API additions**:
```js
sa.issueCap({subject, skill, scopes, expiresIn}) // → {token, sig}
sa.revokeCap(tokenId)
sa.listCapsIssued()
sa.listCapsHeld()       // tokens others issued to us
sa.policyForSkill(skillId) // who can call this
```

**Wiring point**: factory pre-registers a default deny-all
`PolicyEngine` + allow-list per skill.  Apps add allowed skills
via `sa.allowSkillForSubject(...)`.

**canopy-chat surface**: `/grant <peer> <skill>`, `/revoke <peer>
<skill>`, `/caps`.

**Effort**: 1.5 sessions.  **Threat**: all-or-nothing access.

---

### A.6 — `#8` Signed activity log

**Substrate status**: `WEBID_PREDICATES.auditLogUri` (canonical
predicate IRI for the log's pod location).  Append-only hash-chain
+ sig logic NOT YET SHIPPED.

**New substrate (or extension of `@canopy/secure-agent`)**: append-
only signed log:
```js
{ ts, actor, action, args (redacted), prevHash, sig }
```

**Slot into factory**: `auditLog: { signEvery: true, podSyncEvery:
'1h' }`.

**API additions**:
```js
sa.audit(action, args)               // signed append
sa.auditQuery({since, action?})      // local query
sa.verifyAuditChain()                // walks hash chain + sigs
sa.syncAuditToPod(podWriter)
```

**Wiring point**: factory's `agent.on(skill-dispatch)` →
auto-`sa.audit`.

**Effort**: 1.5 sessions.  **Threat**: tamper / "I never did that"
denial; no off-device backup.

---

### A.7 — `#10` Group encryption (GroupManager)

**Substrate status**: SHIPPED.  `GroupManager`, `groupProofVerify`.

**Slot into factory**: `groupManager: true`.  Factory composes
GroupManager with the agent's identity (admin issuance) +
verification on incoming proofs.

**API additions**:
```js
sa.createGroup(name)                          // admin issues
sa.inviteToGroup(peer, groupId, role='member')
sa.leaveGroup(groupId)
sa.groups()                                    // memberships
sa.sendToGroup(groupId, payload)               // encrypted to all members
```

**Wiring point**: NKN envelope subtype 'group-msg' carries
`groupId`; receivers verify membership before decrypting.

**Effort**: 2 sessions.  **Threat**: group context leakage.

---

### A.8 — `#1` Double-Ratchet (Perfect Forward Secrecy)

**Substrate status**: NOT SHIPPED.  Stoop's privacy doc explicitly
flags this as "V2 still required".

**New substrate** `@canopy/forward-secrecy`: Signal Double Ratchet
(root key + per-direction chain keys; periodic DH ratchet on
response).

**Slot into factory**: `usePerfectFwdSec: true`.  When ON: HI
exchange establishes the X3DH bundle; subsequent envelopes use
ratcheted keys.  Falls back to nacl.box for peers without PFS.

**API additions**: none externally; SecurityLayer transparently
upgrades.

**Wiring point**: replaces SecurityLayer's static nacl.box with
the ratchet.

**Effort**: 2-3 sessions.  Could compose libsignal-protocol-
javascript or implement from spec.  **Threat**: retroactive key
compromise.

---

## PART A+ — items the previous draft MISSED

After a second-pass audit (this rev), these substrates exist but
weren't in the first plan:

### A+.1 — `helloGates` (gate incoming HI envelopes)

**Substrate status**: SHIPPED.  `packages/core/src/security/
helloGates.js` ships PSK gate + predicate-based gate.

**Slot into factory**: `helloGate: 'allow-all' | 'pre-shared-secret'
| (env) => boolean`.

**Use case**: spam HI flood from unknown peers wastes resources +
gives them our pubKey.  PSK gate requires a token (e.g.
out-of-band shared password).  Predicate gate lets apps embed
custom logic (e.g. only HI from peers whose webid is in our
contacts).

**Effort**: ½ session as a factory slice.  **Threat**: HI flooding,
unwanted attention.

### A+.2 — `PolicyEngine` + `Roles` (per-skill role-based access)

**Substrate status**: SHIPPED.

**Slot into factory**: bundled with A.5 capability tokens.
PolicyEngine is the executor; tokens are one input.  Roles add
semantic shortcuts (admin / member / guest).

**Note**: Caps + Roles are complementary.  Caps = ad-hoc grants;
Roles = bulk policies.  Factory exposes both.

### A+.3 — `TrustRegistry`

**Substrate status**: SHIPPED.

**Use case**: per-peer trust score (0-100).  Tracks observed
behaviour over time.  Inputs to policy decisions: "high-trust
peers get caps auto-granted; low-trust ones require manual
approval".

**Slot into factory**: `trustRegistry: true`.

**Effort**: 1 session.  Wires alongside A.5.

### A+.4 — `A2ATLSLayer`

**Substrate status**: SHIPPED.  TLS-style handshake for A2A
protocol envelopes (a separate layer from chat-p2p).

**Use case**: when canopy-chat eventually composes A2A (agent-to-
agent invocations beyond chat), this adds TLS-grade transport
security on top of NKN.

**Slot into factory**: `a2aTls: true`.  Optional — A2A isn't
canopy-chat's current scope.

### A+.5 — WebAuthn / passkey vault unlock

**Substrate status**: NOT SHIPPED.

**Slot into factory**: `webAuthnUnlock: true`.  Replaces passphrase
prompt with the OS's passkey UI.  Cleaner UX; hardware-backed key
material.

**Effort**: 1 session.  **Threat**: passphrase brute-force; user
forgets passphrase.

### A+.6 — Capability-Pod token (PodCapabilityToken)

**Substrate status**: SHIPPED.

**Use case**: caller grants peer pod-level access (e.g. "Anne can
read /shared-with-anne/").  Distinct from skill caps (A.5).

**Slot into factory**: bundled with A.5 caps as a second issuer
type.

### A+.7 — `migrateVaultToPod`

**Substrate status**: SHIPPED.

**Use case**: move local identity to pod-backed storage.  Cross-
device identity sync.

**Slot into factory**: as a one-off operation `sa.migrateToPod()`.

### A+.8 — Rate-limiting + replay-resistant tokens

**Substrate status**: replay protection in SecurityLayer (10-min
window + dedup); no rate-limiter on top.

**Slot into factory**: `rateLimit: {perPeer: 30/min, perSkill:
100/min}`.

**Effort**: ½ session.  **Threat**: DoS via envelope spam.

---

## CONSOLIDATED ORDER (B then A, with A+ items merged)

| # | Slice | Substrate | Effort | Notes |
|---|---|---|---|---|
| **B**     | secure-agent factory foundation | new + uses v0.7.P3a/d | 1 session | start point |
| **A.1**   | mute/block (`#5`) | shipped | ½ | factory flag + canopy-chat builtins |
| **A.1a**  | `helloGates` (A+.1) | shipped | ½ | bundled with A.1; HI gating |
| **A.2**   | signed WebID claim (`#2`) | new convention | 1 | closes v0.7.P3d trust loop |
| **A.3**   | passphrase vault (`#3`) | partial new | 1 | at-rest protection |
| **A.3a**  | WebAuthn vault unlock (A+.5) | new | 1 | hardware-backed UX |
| **A.4**   | identity-resolver (`#7`) | shipped | 1.5 | replaces NKN addrs in UI |
| **A.5**   | capability tokens (`#6`) + PodCapabilityToken (A+.6) | shipped | 1.5 | per-skill perms |
| **A.5a**  | PolicyEngine + Roles (A+.2) | shipped | (bundled) | bulk policies alongside caps |
| **A.5b**  | TrustRegistry (A+.3) | shipped | 1 | trust score feeds policy |
| **A.6**   | signed activity log (`#8`) | partial new | 1.5 | tamper-evident audit |
| **A.7**   | group encryption (`#10`) | shipped | 2 | GroupManager composition |
| **A.7a**  | A2ATLSLayer (A+.4) | shipped | 1 | optional; future A2A |
| **A.7b**  | rate-limiting (A+.8) | new | ½ | DoS protection |
| **A.7c**  | migrateVaultToPod (A+.7) | shipped | ½ | cross-device identity |
| **A.8**   | Double-Ratchet PFS (`#1`) | new | 2-3 | hardest; last |

**Total**: B (1) + A.1-A.8 + A+ (~16-19 sessions).  Visible
demoable improvement after each slice.

### Suggested batches for committing

| Batch | Includes | Tag | Status |
|---|---|---|---|
| Batch 1 | B (foundation) | v0.7.S0 | ✅ DONE 2026-05-22 |
| Batch 2 | A.1 + A.1a (mute + helloGates) | v0.7.S1 | ✅ DONE 2026-05-23 |
| Batch 3 | A.2 (signed claim) | v0.7.S2 | ✅ DONE 2026-05-23 |
| Batch 4 | A.3 + A.3a (passphrase + WebAuthn) | v0.7.S3 | ✅ DONE 2026-05-23 |
| Batch 5 | A.4 (identity-resolver) | v0.7.S4 | ✅ DONE 2026-05-23 |
| Batch 6 | A.5 + A.5a + A.5b (caps + roles + trust + PolicyEngine) | v0.7.S5 | ✅ DONE 2026-05-23 |
| Batch 7 | A.6 (audit log) | v0.7.S6 | ✅ DONE 2026-05-23 |
| Batch 8 | A.7 + A.7a + A.7b + A.7c (groups + a2a-tls + rate-limit + migrate) | v0.7.S7 | ✅ DONE 2026-05-23 |
| Batch 9 | A.8 (PFS) | v0.7.S8 | pending |

---

## CONVENTION addition (after B lands)

Amend `Project Files/conventions/architectural-layering.md`:

> **Security-by-default for cross-peer apps**.  New apps that compose
> a real network transport (NKN, WebRTC, relay) MUST use
> `@canopy/secure-agent`'s factory.  Opting out per-property
> requires a grep-able `// SECURITY: opted out — <reason>` comment
> co-located with the manual wiring so the decision is auditable.
>
> Default flags are tuned to be safe; explicit opt-outs surface in
> code review.

---

## ALSO worth tracking (not in scope for this roadmap; surface here)

These came up in the audit but are deliberately out-of-scope for
the security pass:

- **Notification spam** — receiver-side notification rate-limit per
  peer.  Could be a chat-p2p concern.
- **Pod-side ACP correctness** — Stoop's threat-model says "the
  classic Solid footgun"; needs app-level checks.
- **Onion routing / mixnet** — NKN already does some hop-routing;
  layering an explicit mixnet is significant work.
- **Quantum-resistant primitives** — NaCl isn't PQ-safe; substrate
  swap needed when quantum threat materialises.
- **Group sealed-routing** — Stoop's `sealedForward` ships
  hop-routing blindness for closed groups; not yet a substrate.

---

**Authored** 2026-05-23.  **Revision 2** adds B-first plan + A+
items (helloGates, PolicyEngine, TrustRegistry, A2ATLSLayer,
WebAuthn, PodCapabilityToken, migrateVaultToPod, rate-limit).
