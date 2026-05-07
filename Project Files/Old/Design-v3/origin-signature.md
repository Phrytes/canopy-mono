# Origin signature verification — design

**Status:** proposal. Input for Group Z in `EXTRACTION-PLAN.md` / `CODING-PLAN.md`.
**Supersedes:** the unsigned `_origin` field shipped in 2026-04-20's origin-attribution work.

---

## 1. Problem

When a message travels through a bridge (via the `relay-forward` skill), the
receiver sees two identities:

- `envelope._from` — the *immediate* sender, authoritatively signed by
  SecurityLayer's `_sig` on the envelope.
- `_origin` — a payload field the bridge copies from the original caller,
  currently **unverified**. A hostile bridge can claim any `_origin` value.

The attribute `ctx.originFrom` today reflects this *unverified claim*. As
long as nothing behaves on that attribution — it's only a display label —
that's fine. The moment anything keys on it (reputation, rate limits,
ACLs, capability-token lookup, group membership, UI "message from X"),
it becomes spoofable.

Group Z adds a cryptographic signature over the invocation itself, so a
receiver can verify that the claimed `_origin` really authored the
(target, skill, parts, timestamp) the bridge delivered.

---

## 2. The claim

The origin signs a canonical body describing the *intent* of the
invocation, not the envelope-level wrapper:

```json
{
  "v":      1,
  "target": "<pubkey we're sending to>",
  "skill":  "<skill id>",
  "parts":  [ /* Part[] exactly as passed to invokeWithHop */ ],
  "ts":     1716450000000
}
```

The signed value is `canonicalize(body)` (reusing `core/Envelope.js::canonicalize`).
The signature is Ed25519 over those bytes, base64url-encoded.

Three new fields travel with the RQ payload:

- `_origin`    — pubkey of the signer (already present today, just unverified).
- `_originSig` — base64url Ed25519 signature described above.
- `_originTs`  — the timestamp that was in the signed body; the receiver
                 needs it out-of-band to reconstruct `canonicalize(body)`.

**Parts are signed verbatim.** `relay-forward` passes the original parts
through without re-wrapping, so the receiver sees exactly what the origin
signed. If the bridge tampers with `parts`, the reconstructed `canonicalize`
output won't match and the signature verification fails.

**No pre-hashing.** Ed25519 already internally hashes its input with
SHA-512; pre-hashing `parts` would add a dependency for no security
benefit. Signed-body size is bounded by the application payload but
signatures remain 64 bytes regardless.

**Version byte `v: 1`.** Lets us evolve the protocol. Receivers reject
unknown versions.

---

## 3. Relationship to existing signatures

| Signature        | Who signs   | Over what                      | What it proves |
|------------------|-------------|--------------------------------|-----------------|
| `envelope._sig`  | Immediate sender (often the relay) | The encrypted envelope        | "This particular envelope came from this pubkey." |
| `_token` (capability) | Skill owner who issued a permission | `{ issuer, subject, skill, constraints, expiresAt }` | "The owner of this skill pre-authorised `subject` to call it." |
| **`_originSig`** (new) | Original caller             | `{ v, target, skill, parts, ts }` | **"The owner of `_origin` authored this specific invocation."** |

They are complementary, not redundant:
- `envelope._sig` authenticates the *hop*, not the origin.
- `_token` is about permission, not authorship.
- `_originSig` is about authorship, and only meaningful when the message
  has travelled through at least one relay.

---

## 4. Signature → attribution flow

```
invokeWithHop(target, skill, parts)
  │
  ├─ pick a bridge (oracle or probe-retry)
  │
  ├─ SIGN: sig = identity.sign(canonicalize({v:1, target, skill, parts, ts}))
  │
  └─ invoke bridge's relay-forward skill with DataPart({
       targetPubKey, skill, payload: parts, timeout,
       originSig: sig, originTs: ts,
     })

relay-forward (on bridge)
  │
  ├─ extract originSig, originTs from the DataPart
  │
  └─ agent.invoke(target, skill, parts, {
       timeout, origin: from, originSig, originTs,
     })
       // originSig is passed through without modification — the bridge
       // can't resign because it doesn't have the origin's private key,
       // and re-signing would lose the original attribution anyway.

callSkill (on bridge, for the inner invoke)
  │
  └─ include _origin, _originSig, _originTs in the RQ payload to target.

handleTaskRequest (on target)
  │
  ├─ extract _origin, _originSig, _originTs from the payload
  │
  ├─ if all three present:
  │     body = { v:1, target: agent.pubKey, skill: skillId, parts, ts: _originTs }
  │     ok   = AgentIdentity.verify(canonicalize(body), _originSig, _origin)
  │     AND  |Date.now() - _originTs| ≤ ORIGIN_SIG_WINDOW_MS
  │
  ├─ on verified:
  │     ctx.originFrom = _origin        // cryptographically verified
  │     ctx.originVerified = true
  │
  └─ on missing / invalid / stale:
        ctx.originFrom = envelope._from // safe fallback — the relay
        ctx.originVerified = false
        if (_origin present) emit 'security-warning', { reason, envelope }
```

`ctx.originVerified` (new) tells app code whether to trust `ctx.originFrom`
for security-relevant decisions. Backward-compat apps that only read
`ctx.originFrom` get a safe fallback (the relay pubkey) when the sig is
bad — **not** the attacker-claimed origin.

---

## 5. Verification checks (in order, fail fast)

1. `_origin` is a non-empty string.
2. `_originSig` is a non-empty string.
3. `_originTs` is a finite number.
4. `|Date.now() - _originTs| ≤ ORIGIN_SIG_WINDOW_MS` (default 10 min,
   matching SecurityLayer's replay window).
5. Reconstruct `body = { v: 1, target: <our pubkey>, skill: skillId, parts, ts: _originTs }`.
6. `AgentIdentity.verify(canonicalize(body), _originSig, _origin)` returns `true`.

Any failure → emit `security-warning` with `{ reason, envelope }` and fall
back to `envelope._from` for attribution. **Continue executing the skill.**
The choice here is deliberate: Z is about improving attribution, not
gating delivery. Skill-level policy (group-visible, capability tokens)
runs against the *verified* origin when available, against `envelope._from`
otherwise — so a missing sig can't elevate a bridge's privileges, only
lose the caller's.

---

## 6. Replay defence

`_originTs` pinned inside the signed body, plus the ±10 min window check,
prevents a relay from re-using a captured `(parts, sig)` pair hours or
days later. Within the 10-minute window, duplicate delivery via different
envelopes *is* possible; if an app needs exact-once semantics at the
origin-sig layer, an app-level nonce in `parts` is the right layer —
that's a general deduplication question, not a Z-specific concern.

The envelope layer already has its own `_id` dedup cache with a 10-minute
TTL; it catches exact-envelope replays, which is the most likely attack
vector anyway.

---

## 7. Failure modes & threats

| Threat                                  | Mitigation                                     |
|-----------------------------------------|------------------------------------------------|
| Relay lies about `_origin`              | Signature verify fails → fallback to `_from`   |
| Relay tampers with `parts`              | Signed body includes `parts`; canonical form mismatches; verify fails |
| Replay of old captured (parts, sig)     | `_originTs` is signed; window check rejects stale pairs |
| Forged origin (pubkey-switch)           | Ed25519 verify against the claimed `_origin` pubkey |
| Missing sig on a legitimately-routed message (e.g. pre-Z client) | Safe fallback; `security-warning` emitted; attribution degrades to relay pubkey |
| Origin's clock off by > 10 min          | Window check fails → fallback. Same as SecurityLayer replay behaviour. |
| Multi-hop traversal                     | Each bridge preserves sig + ts + origin unchanged; final hop reconstructs body with its own pubkey as `target`. Sigs survive arbitrary hop counts. |
| Origin-key rotation                     | `_origin` is the pubkey at the time of signing; receiver verifies against that exact pubkey. Rotation → old sigs fail naturally. |
| DoS via many invalid sigs               | Verify is cheap (Ed25519 ~0.1 ms); plus the SecurityLayer already admits only hello'd peers. |

---

## 8. API summary

Everything opt-in at the high level; automatic at the low level when
`invokeWithHop` routes through a bridge.

```js
// Signing happens automatically in invokeWithHop when a bridge is used.
// Callers don't need to touch anything.
await agent.invokeWithHop(carol, 'receive-message', [TextPart('hi')]);

// Low-level: sign an origin claim directly (rare — tests / custom routing).
import { signOrigin, verifyOrigin } from '@canopy/core';
const sig = signOrigin(agent.identity, {
  target: carol.pubKey,
  skill:  'receive-message',
  parts:  [TextPart('hi')],
  ts:     Date.now(),
});

const res = verifyOrigin(
  { body: { v: 1, target, skill, parts, ts }, sig, origin },
  { expectedPubKey: 'alice-pubkey', now: Date.now(), windowMs: 600_000 },
);
// res → { ok: true } | { ok: false, reason: string }
```

**AgentConfig overrides** (optional):

```yaml
originSignature:
  windowMs:        600000   # replay window (default 10 min)
  strictFallback:  true     # always fall back to envelope._from
                            # on verify fail; reject delivery on `false`
                            # (not the default — reserved for strict apps)
```

Skill handler receives a new boolean field:

```js
agent.register('receive-message', async ({
  parts,
  from,            // envelope._from (unchanged)
  originFrom,      // verified origin pubkey, OR safe fallback to `from`
  originVerified,  // NEW — true only when the Ed25519 verify passed
  relayedBy,       // envelope._from when originVerified + via a relay
}) => { /* … */ });
```

---

## 9. What this design deliberately does *not* cover

- **Strict rejection of unsigned relays.** The default is graceful
  degradation (attribution falls back to relay pubkey). Apps that want
  to *reject* messages without a valid origin sig can do so in their
  skill handler by checking `ctx.originVerified`.
- **Cross-signing multiple intermediate hops.** Only the original
  caller signs. Intermediate bridges carry the sig verbatim. If we
  later want to prove "Bob chose to forward this message" as well as
  "Alice authored it," each hop would need its own sig — out of scope.
- **Persistent sig storage.** Verified sigs aren't cached across
  restarts. Each message is verified fresh.
- **Revocation.** There's no "this origin pubkey is compromised" list.
  Apps hold that trust decision locally (SecurityLayer.unregisterPeer
  + `agent.forget(pubkey)` together already remove future trust).

---

## 10. Z1 decisions (resolved)

Three open issues blocked Z2 implementation. Decided 2026-04-22.

### Z1-a · What do we sign? → `{ v, target, skill, parts, ts }` directly.

No pre-hashing of `parts`. Ed25519 handles arbitrary-length input via
its internal SHA-512 pass. `parts` survive `relay-forward` verbatim, so
canonical reconstruction at the target works without extra protocol
complexity.

### Z1-b · Should the sig cover the timestamp? → Yes.

`ts` is included in the signed body so a relay can't re-use a captured
`(parts, sig)` pair indefinitely. Combined with a ±10 min window check
at verification time, this gives replay resistance equivalent to the
SecurityLayer envelope layer.

### Z1-c · Share canonicalisation with CapabilityToken? → Reuse `canonicalize()`, nothing else.

Both sit on `core/Envelope.js::canonicalize`. Bodies are unrelated
shapes; no higher-level helper would add value. Consistent with T1-d
and with CapabilityToken's existing pattern.

---

## 11. Future work (deferred)

- **Strict-reject mode.** An agent could opt in to "drop any relayed
  message with missing/invalid origin sig" at the dispatch layer,
  before the skill handler runs. Useful for high-sensitivity apps.
  Probably a one-line `AgentConfig.originSignature.strict = true`.
- **Per-hop chain signatures.** Each hop in a multi-bridge route
  attaches its own sig, so the full hop path is provable. Matters
  only if relay-hop accountability becomes a product feature.
- **Rotation & revocation.** Proper pubkey-rotation story for origins
  — what happens when Alice changes keys, and how do stale sigs age
  out? Today: trust decisions live in SecurityLayer; verify-fail is
  silent-ish (warning event, but message still delivers).
