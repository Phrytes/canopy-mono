# Identity-pod schema

**Status:** v0 spec draft, 2026-04-28.  Output of phase-0 design
question A1 from
[`topology-implementation.md`](./topology-implementation.md).

This document is the spec for the resources, vocabulary, and
encryption envelope used to store identity-bearing state in a
user's Solid pod.  Implementation lives in
`packages/core/src/identity/IdentityPodStore.js` (when
phase 1 ships).

**Reading order:** [linkage](#linkage-from-the-webid-profile) →
[layout](#container-layout) → [resource schemas](#resource-schemas)
→ [encryption](#encryption-protocol) → [manifest](#manifest)
→ [open questions](#open-questions).

---

## Premises

1. The user has a Solid WebID (e.g. `https://alice.example/profile/card#me`).
2. The user's pod is reachable at the WebID's pod root (Solid
   convention).
3. The user holds a **bootstrap secret** locally (vault) — a
   256-bit secret encoded as a 24-word BIP-39 seed phrase per
   the existing `packages/core/src/identity/Mnemonic.js`.  All
   pod-stored identity resources are encrypted at rest with
   keys derived from the bootstrap secret.
4. The pod host is treated as **honest-but-curious**: it will
   not tamper undetectably, but it can read whatever is plaintext
   on disk and observe metadata (file names, sizes, timestamps).
   Therefore: file *contents* are encrypted, file *paths and
   names* are visible.

---

## Linkage from the WebID profile

The user's existing WebID profile gains exactly one triple
linking to the custom container.  This is non-destructive — any
existing profile content stays.

```turtle
@prefix dw: <https://canopy.org/ns#> .

<#me>
  dw:identityRoot </canopy/> .
```

The container path (`/canopy/`) is conventional but
configurable — the manifest holds the canonical pointer.

---

## Container layout

```
/canopy/
  manifest.ttl                            ← plaintext, signed.  Index + version + hash chain.
  devices/
    device-<pubkey-fingerprint>.enc       ← one per authorized device
  grants/
    issued/
      grant-<token-id>.enc                ← capability tokens this user issued
    held/
      grant-<token-id>.enc                ← capability tokens this user holds
  contacts/
    contact-<pubkey-fingerprint>.enc      ← known peers + friendly names
  app-permissions/
    app-<app-id>.enc                      ← per-app authorization records
  auth-log/
    YYYY-MM.enc                           ← append-only audit log, monthly files
  recovery-hints.enc                      ← user-side reminders about backup locations
```

Conventions:

- `<pubkey-fingerprint>` = first 16 hex chars of SHA-256 over
  the ed25519 pubkey.  Stable; collision-free at this scale.
- `<token-id>` = the existing CapabilityToken's `tokenId`
  field.
- `.enc` extension marks an encrypted resource (XSalsa20-Poly1305
  envelope, see [encryption](#encryption-protocol)).
- `.ttl` extension marks a plaintext Turtle resource (only
  `manifest.ttl`).
- The auth-log uses **monthly files** to keep individual files
  small and to make compaction cheap (drop log files older
  than retention).

---

## Vocabulary

Namespace: `https://canopy.org/ns#` — **placeholder**.  Final
URL depends on the project's eventual canonical domain (open
question, tracked in topology-implementation.md).  Use prefix
`dw:` throughout.

### Classes

| Class | Used by |
|---|---|
| `dw:Device` | one per authorized device |
| `dw:CapabilityGrantIssued` | tokens this user issued to others |
| `dw:CapabilityGrantHeld` | tokens this user received from others |
| `dw:Contact` | known peer with friendly metadata |
| `dw:AppPermission` | a record of "I authorized app X for scope Y" |
| `dw:AuthEvent` | an append-only audit-log entry |
| `dw:RecoveryHint` | user-side reminder of where a backup lives |
| `dw:IdentityManifest` | the signed top-level index |

### Predicates (alphabetical)

| Predicate | Range | Meaning |
|---|---|---|
| `dw:actor` | URI | who performed an event (device URI) |
| `dw:appId` | string | stable app identifier |
| `dw:appName` | string | human-readable app name |
| `dw:appOrigin` | URI | optional source of the app (URL / store) |
| `dw:at` | xsd:dateTime | event timestamp |
| `dw:bootstrapKeyFingerprint` | string | ties device record to bootstrap secret |
| `dw:capabilities` | list<string> | device-level capabilities (`push`, `ble`, `mdns`, …) |
| `dw:contentHash` | string | SHA-256 over the container's encrypted resources, prefixed `sha256:`. See [algorithm](#dwcontenthash-algorithm). |
| `dw:event` | string | event type (see [auth-log events](#auth-event-types)) |
| `dw:expiresAt` | xsd:dateTime | when the grant / permission stops being valid |
| `dw:firstSeen` | xsd:dateTime | when this contact was first observed |
| `dw:grantedAt` | xsd:dateTime | when the permission was granted |
| `dw:groups` | list<string> | group ids this contact belongs to |
| `dw:hint` | string | user-provided memory aid for a recovery method |
| `dw:identifier` | string | external identifier for a backup (e.g. Dropbox folder name) |
| `dw:identityRoot` | URI | container holding identity resources (in WebID profile) |
| `dw:issuedAt` | xsd:dateTime | when the grant was issued |
| `dw:issuedBy` | URI | issuer WebID or pubkey |
| `dw:issuedTo` | URI | recipient WebID or pubkey |
| `dw:label` | string | human-readable label (device name, contact name, …) |
| `dw:lastSeen` | xsd:dateTime | last observation of a device |
| `dw:lastInteraction` | xsd:dateTime | last interaction with a contact |
| `dw:lastUpdated` | xsd:dateTime | when the manifest was last regenerated |
| `dw:lastVerifiedAt` | xsd:dateTime | last time a recovery method was checked |
| `dw:method` | string | recovery method (`bip39-seed-paper`, `cloud-backup-dropbox`, …) |
| `dw:metadata` | object | event-specific extras (free-form) |
| `dw:notes` | string | user-provided notes on a contact |
| `dw:pairedAt` | xsd:dateTime | when a device was first authorized |
| `dw:platformHint` | string | informational: `ios`, `android`, `web`, `server` |
| `dw:pubkey` | string | base58-encoded ed25519 pubkey |
| `dw:reason` | string | human-readable rationale (issuance, revocation) |
| `dw:retired` | xsd:boolean | true if the device is no longer authorized |
| `dw:retiredAt` | xsd:dateTime | when retirement happened |
| `dw:revokedAt` | xsd:dateTime | when a grant or permission was revoked |
| `dw:rootDevicePubkey` | string | the manifest signer's pubkey |
| `dw:schemaVersion` | string | semver of the schema (currently `0.1.0`) |
| `dw:scope` | list<string> | permission scopes granted (e.g. `pod.read:/notes/`) |
| `dw:setupAt` | xsd:dateTime | when a recovery method was set up |
| `dw:signature` | string | ed25519 signature (base64) over a canonical form |
| `dw:target` | URI \| string | what an event affected |
| `dw:tokenId` | string | unique identifier for a capability token |
| `dw:tokenJson` | string | full signed CapabilityToken (JSON) for verification |
| `dw:trustTier` | xsd:integer | 0..3, matching `TrustRegistry` tiers |
| `dw:webid` | URI | a peer's WebID (when known) |

---

## Resource schemas

Each is shown in **Turtle** as it appears *after decryption*.
On-disk it's wrapped in the encryption envelope (see
[encryption](#encryption-protocol)).

### Device

`/canopy/devices/device-<fingerprint>.enc`

```turtle
@prefix dw:  <https://canopy.org/ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#device>
  a dw:Device ;
  dw:pubkey            "ed25519:base58:7uG9..." ;
  dw:label             "the author's Pixel 8" ;
  dw:pairedAt          "2026-04-28T10:00:00Z"^^xsd:dateTime ;
  dw:lastSeen          "2026-04-28T11:30:00Z"^^xsd:dateTime ;
  dw:retired           false ;
  dw:platformHint      "android" ;
  dw:capabilities      ( "push" "ble" "mdns" ) ;
  dw:bootstrapKeyFingerprint "9f3a2c1b4e..." .
```

When retired:
```turtle
<#device>
  dw:retired   true ;
  dw:retiredAt "2026-05-01T08:00:00Z"^^xsd:dateTime .
```

Retired devices are **not deleted** — they remain in the
container as part of the audit history, just with `retired =
true`.

### CapabilityGrantIssued

`/canopy/grants/issued/grant-<tokenId>.enc`

```turtle
<#grant>
  a dw:CapabilityGrantIssued ;
  dw:tokenId    "tok-3f8a9c..." ;
  dw:issuedBy   <https://alice.example/profile/card#me> ;
  dw:issuedTo   <https://bob.example/profile/card#me> ;
  dw:scope      ( "archive.read" "archive.search" ) ;
  dw:issuedAt   "2026-04-28T10:15:00Z"^^xsd:dateTime ;
  dw:expiresAt  "2026-05-28T00:00:00Z"^^xsd:dateTime ;
  dw:reason     "Bob asked to search my garden archive" ;
  dw:tokenJson  "{...full signed CapabilityToken...}" .
```

If revoked, add:
```turtle
<#grant>
  dw:revokedAt "2026-04-30T14:00:00Z"^^xsd:dateTime .
```

`dw:tokenJson` carries the full existing `CapabilityToken` JSON
so verification doesn't require re-signing — just verify
against the held copy.

### CapabilityGrantHeld

`/canopy/grants/held/grant-<tokenId>.enc`

Same shape as Issued, but `dw:issuedBy` is the *other party*
and `dw:issuedTo` is the user.

### Contact

`/canopy/contacts/contact-<fingerprint>.enc`

```turtle
<#contact>
  a dw:Contact ;
  dw:pubkey          "ed25519:base58:..." ;
  dw:label           "Bob the gardener" ;
  dw:webid           <https://bob.example/profile/card#me> ;
  dw:trustTier       2 ;
  dw:groups          ( "group:my-block" "group:gardening-club" ) ;
  dw:firstSeen       "2026-03-01T12:00:00Z"^^xsd:dateTime ;
  dw:lastInteraction "2026-04-25T18:42:00Z"^^xsd:dateTime ;
  dw:notes           "Has a 3D printer; willing to help fix things." .
```

`dw:webid` is optional — many contacts will be pubkey-only
(e.g. mesh peers without a WebID).

### AppPermission

`/canopy/app-permissions/app-<appId>.enc`

```turtle
<#authorization>
  a dw:AppPermission ;
  dw:appId      "obsidian-pod-sync" ;
  dw:appName    "Obsidian (with pod-sync plugin)" ;
  dw:appOrigin  <https://github.com/example/obsidian-pod-sync> ;
  dw:scopes     ( "pod.read:/notes/" "pod.write:/notes/" ) ;
  dw:grantedAt  "2026-04-28T11:00:00Z"^^xsd:dateTime ;
  dw:expiresAt  "2027-04-28T11:00:00Z"^^xsd:dateTime ;
  dw:tokenId    "tok-app-obsidian-..." .
```

The `dw:tokenId` ties this record to a corresponding
`CapabilityGrantIssued` resource — the actual signed token an
app presents.  This record is the user-facing index.

### AuthEvent (auth-log)

`/canopy/auth-log/YYYY-MM.enc` is a **JSON-LD Lines** file
(one event per line), append-only.  Decrypted form:

```jsonld
{"@context": "https://canopy.org/ns", "@type": "dw:AuthEvent", "dw:event": "device-paired", "dw:actor": "/canopy/devices/device-9f3a2c1b.enc", "dw:target": "ed25519:base58:7uG9...", "dw:at": "2026-04-28T10:00:00Z", "dw:signature": "..."}
{"@context": "https://canopy.org/ns", "@type": "dw:AuthEvent", "dw:event": "grant-issued", "dw:actor": "/canopy/devices/device-9f3a2c1b.enc", "dw:target": "tok-3f8a9c...", "dw:at": "2026-04-28T10:15:00Z", "dw:signature": "...", "dw:metadata": {"issuedTo": "https://bob.example/profile/card#me", "scope": ["archive.read"]}}
```

#### Auth-event types

Minimum set for v0.1:

| Event | When |
|---|---|
| `device-paired` | New device added |
| `device-retired` | Device retired |
| `grant-issued` | Capability token issued to a peer |
| `grant-revoked` | Issued token revoked |
| `grant-held-stored` | Token received from a peer and stored |
| `grant-held-discarded` | Stored token deliberately discarded |
| `app-authorized` | App granted access |
| `app-revoked` | App access revoked |
| `key-rotated` | Root key rotation completed (links to `KeyRotation` proof) |
| `recovery-method-added` | New recovery hint registered |
| `recovery-method-removed` | Recovery hint removed |
| `pod-migrated` | Identity moved between pods |

Apps and the agent must use **exactly** these strings; new event
types require a schema-version bump.

Every event is signed by the device that emitted it
(`dw:signature` over the canonical JSON form excluding the
signature field).  Tamper detection: replay through the chain
+ verify each signature against `devices/`.

**Concurrency note.**  Append happens via read-modify-write
with conflict retry (per `pod-client-api.md` §append).  Two
devices appending simultaneously could in principle lose an
entry under high contention, but identity-changing events are
rare (a device pairing per month, a grant per week).  Monthly
files give natural partitioning + the retry loop covers the
common case.  Revisit if real-usage metrics show contention.

### RecoveryHint

`/canopy/recovery-hints.enc`

```turtle
<#hint-seed>
  a dw:RecoveryHint ;
  dw:method          "bip39-seed-paper" ;
  dw:hint            "In the lockbox at home, top-left envelope" ;
  dw:setupAt         "2026-04-28T10:30:00Z"^^xsd:dateTime ;
  dw:lastVerifiedAt  "2026-04-28T10:30:00Z"^^xsd:dateTime .

<#hint-cloud>
  a dw:RecoveryHint ;
  dw:method      "cloud-backup-dropbox" ;
  dw:identifier  "canopy-backup" ;     # folder name in user's Dropbox
  dw:setupAt     "2026-04-28T10:35:00Z"^^xsd:dateTime .
```

This file is **user-facing memory aids**, not the actual
backup material.  The bootstrap secret never appears here.

---

## Manifest

`/canopy/manifest.ttl` is **plaintext, signed**.  It's the
index — the only resource a fresh client reads first.

```turtle
@prefix dw:  <https://canopy.org/ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#manifest>
  a dw:IdentityManifest ;
  dw:schemaVersion     "0.1.0" ;
  dw:lastUpdated       "2026-04-28T11:30:00Z"^^xsd:dateTime ;
  dw:rootDevicePubkey  "ed25519:base58:..." ;
  dw:contentHash       "sha256:..." ;
  dw:signature         "ed25519:base64:..." .
```

Why plaintext: a client opening the pod for the first time
needs to *find out* the schema version, the root device, and
the content hash before it can decrypt anything else.  Signing
+ content-hash protect against silent tampering.  Resource
*paths* are visible via LDP container listings anyway, so
hiding the manifest gains nothing.

### `dw:contentHash` algorithm

Deterministic.  Implementations MUST follow byte-for-byte; any
deviation is a spec bug to be reported and fixed.

1. **Enumerate inputs.**  Walk the `/canopy/` container
   recursively.  Include every file whose name ends in `.enc`.
   Exclude:
   - `manifest.ttl` itself (would create a circular hash).
   - Any `.acl` files (Solid access control is governed by
     the pod's ACL system, not by this hash).
   - LDP container "index" representations (we hash the
     contained resources, not the container's representation
     of them).
   - Empty containers (no resources contributed).
   - Any file not ending in `.enc`.

2. **Compute relative paths.**  For each enumerated file,
   compute its path relative to `/canopy/`.  Use forward
   slashes; no leading slash; no trailing slash.  Example:
   `https://alice.example/canopy/grants/issued/grant-tok-3f8a.enc`
   →  `grants/issued/grant-tok-3f8a.enc`.

3. **Sort.**  Sort the relative paths in **Unicode codepoint
   order** — raw bytewise comparison.  Do NOT use locale-aware
   collation (`localeCompare` in JavaScript is not allowed).
   `device-10.enc` sorts before `device-9.enc` (`'1' < '9'`).

4. **Hash each resource.**  For each path in sorted order,
   compute SHA-256 over the file's exact bytes as stored on
   the pod — the encryption envelope JSON, byte-for-byte.  Do
   not parse, do not normalize whitespace, do not decrypt.
   Each digest is 32 bytes.

5. **Concatenate.**  Concatenate all 32-byte digests in sorted
   order.  No separator, no length prefix.  Result is a byte
   string of length `32 × N` where `N` is the resource count.

6. **Final hash.**  Compute SHA-256 over the concatenation.
   Hex-encode the 32-byte digest using lowercase ASCII
   characters (`0-9`, `a-f`).  Prefix with `sha256:` for the
   `dw:contentHash` value.  Example:
   `"sha256:9a3c…"`.

Tampering with, replacing, or adding any `.enc` resource
changes the hash and fails verification.

### Verification (read-side)

To verify a pod hasn't been tampered with, a client:

1. Reads `manifest.ttl`; parses `dw:contentHash` and
   `dw:signature`.
2. Verifies `dw:signature` against `dw:rootDevicePubkey` using
   ed25519 over the canonical Turtle form of the manifest with
   the `dw:signature` triple removed.
3. Re-computes the hash via the algorithm above.
4. Asserts equality with the parsed `dw:contentHash`.

Mismatch = tamper detected (or implementation bug — the
algorithm is deterministic, so equal inputs produce equal
output).  Client behavior on detection:

- Refuse to apply pod state to the local cache.
- Surface a `'tamper-detected'` event with the offending
  manifest version + the locally-computed hash.
- User chooses: wipe + re-sync from a backup, or investigate.

Reference test vectors will be added to this doc once the
first implementation (Track A → Track B2) lands and can be
cross-checked from a second implementation.

---

## Encryption protocol

### Cipher

**XSalsa20-Poly1305** via `tweetnacl.secretbox`
(`tweetnacl` is already a dependency of `@canopy/core`).

Envelope on disk for `<resource>.enc`:

```json
{
  "v": 1,
  "alg": "xsalsa20poly1305",
  "salt": "<base64, per-resource>",
  "nonce": "<base64, 24 bytes>",
  "ct": "<base64, ciphertext+mac>"
}
```

### Key derivation

Per-resource key:
```
K_resource = HKDF-SHA256(
  ikm        = bootstrap_secret,
  salt       = <random per-resource salt, stored in envelope>,
  info       = "canopy-identity-v1:" + <relative-resource-path>,
  length     = 32 bytes
)
```

Why per-resource salt + path-as-info: avoids reusing the same
key across resources (so a leaked key compromises one
resource, not all); ties the key to the resource's location
(so moving a resource changes the encryption envelope).

### Plaintext format

The decrypted bytes are either:

- **Turtle** for the resource types listed above (Device,
  Contact, etc.).
- **JSON-LD Lines** for the auth-log files only.

The envelope's `alg` field allows future migration to a
different cipher without breaking older resources.

### Out of scope for v0

- Forward secrecy / per-message keys.  All resources stay
  decryptable as long as the bootstrap secret is known.  This
  is the right tradeoff for an identity store (you *want* to
  decrypt your own data forever).
- Searchable encryption.  Apps read whole resources.  Search
  happens on the device-side cache.

---

## Operations

A small set of operations the SDK provides.  Concrete API
lives in `IdentityPodStore.js` (phase 1).

| Operation | What it does |
|---|---|
| `init(webid, bootstrap)` | Create `/canopy/` if absent, write initial manifest, open or create devices/ etc. |
| `readResource(path)` | Fetch from pod, verify envelope, decrypt with derived key, parse Turtle/JSON-LD. |
| `writeResource(path, content)` | Serialize Turtle/JSON-LD, encrypt with derived key, PUT to pod, update manifest hash. |
| `appendAuthEvent(event)` | Append to current month's auth-log file (creating if absent). |
| `verifyManifest()` | Re-hash all resources, check signature against `rootDevicePubkey`. |
| `rotateRoot(oldKey, newKey)` | Re-sign manifest under new key (delegates to existing `KeyRotation.js`). |

All write operations also append a corresponding `AuthEvent`.

---

## Migration / versioning

`dw:schemaVersion` in the manifest gates compatibility.

- **Same major:** code MUST tolerate unknown predicates and
  classes (forward compatibility).
- **Different major:** code MUST refuse to write and SHOULD
  prompt the user to upgrade.

When the schema evolves:

1. Bump the major in the SDK.
2. Ship a migration routine (`migrate(fromVersion, toVersion)`)
   that re-writes resources in the new shape.
3. Run on first read after upgrade; bumps `schemaVersion` in
   manifest after success.

v0.1 is the first version.  No migrations required yet.

---

## Open questions

| Q | Notes |
|---|---|
| Vocabulary URL | `https://canopy.org/ns#` is a placeholder.  Final URL depends on project's eventual canonical name (currently being reconsidered). |
| Do contacts need pod-projection support? | If two users hold each other as contacts, do their records sync?  v0: no, contacts are user-local notes about peers.  v1: maybe symmetric. |
| Auth-log retention | Default keep all forever (small text + monthly files); allow user to compact older months by replacing the JSON-LD-Lines file with a summary blob. |
| Contact merge semantics across devices | Two devices add the same contact independently; how does sync resolve?  Probably last-write-wins on each predicate; clean enough for v0. |
| Vault ↔ pod sync direction during initial migration | A user with an existing local-only vault sets up a pod for the first time — vault contents push to pod; pod becomes canonical from that point on.  Ship as a one-shot migration utility. |
| What if multiple devices write the manifest concurrently? | Detect via `lastUpdated` timestamp + content hash; on conflict, last write wins but the loser re-reads + re-applies its changes.  Acceptable for the low-write rate of identity changes. |
| Pluralizing `dw:scope` as a list — should we use RDF lists or repeated triples? | RDF lists are more compact in Turtle but harder for naïve parsers; repeated triples are simpler.  Decide based on consumer ergonomics. |

---

## Pointers

- [`topology.md`](./topology.md) — the architectural map this
  schema supports.
- [`topology-implementation.md`](./topology-implementation.md)
  — the rollout plan; phase 1 implements this schema.
- `packages/core/src/identity/Mnemonic.js` — BIP-39 source for
  the bootstrap secret.
- `packages/core/src/identity/KeyRotation.js` — root-key
  rotation; integrates with `key-rotated` auth events.
- `packages/core/src/permissions/CapabilityToken.js` — the
  underlying token format referenced by `dw:tokenJson`.
- `packages/core/src/permissions/TrustRegistry.js` — trust
  tiers referenced in `dw:trustTier`.
