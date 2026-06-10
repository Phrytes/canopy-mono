# Pod at-rest encryption model (content vs structure, substrate, layered index, shared key)

Answers + design decisions from the 2026-06-10 questions. The **mechanics** layer; the **decision**
layer (which posture per situation) is **`STORAGE-SECURITY-MENUKAART.md`** — *encryption is one
posture among several, not a forced default.* Companion to `SECURITY-MODEL.md` (the feedback trust
model) and `HOUSEHOLD-LLM-CIRCLE-JOURNEYS.md` (the shared-pod circle).

## What's sealed today — CONTENT only (verified)
- `pod/project-seal.js` `seal(plaintext, recipients)` AES-256-GCM-encrypts the **value**; CEK
  wrapped to each recipient via ephemeral X25519 → HKDF. `css-central-pod.js`: *"TEXT is sealed —
  the id stays cleartext so it remains the resource path."*
- **Sealed:** resource bodies. **Cleartext (host sees):** container tree, resource **ids/paths**,
  sizes, timestamps, **ACLs**, counts, the `sig`/`pubKey` in the body.
- This is **largely unavoidable** — Solid/CSS needs paths + ACLs in cleartext to serve + enforce
  access. Mitigation: **opaque ids** (ULIDs/pseudonyms, not meaningful names) so structure leaks
  "N records for pseudonym X", not what/who. Full structural encryption breaks the container model,
  ACL enforcement, and interop — not worth it.

## (Q2) Lift at-rest sealing to a SUBSTRATE
Today it's app-local (`feedback-pipeline/pod/project-seal.js` + `crypto-config.js`; household has
its own `groupKeyId`). The household circle makes it **≥2 consumers → rule-of-two met**. Move it to
a **`sealing/` module in `@canopy/pod-client`** (which already has `sharing/`): transparent
**seal-on-write / open-on-read**, key custody via `@canopy/vault`. Extract + generalize
`project-seal` (single-recipient → multi-recipient / group-key). ~Medium effort; needed for the
household shared pod, so a good first task.

## (Q3) Keep the pod's indexability — a layered/sealed index
- **Already preserved:** structure is cleartext, so **list + navigate works without decrypting**;
  you decrypt only the content you fetch.
- **Next level (the "layered" idea):** a small **sealed INDEX resource** per container holding
  queryable metadata (ids, type, ts, tags, short tokens/summary). Client fetches + decrypts **that
  one blob** (cheap) → queries in memory → fetches + decrypts **only matching content**. Richer
  query than cleartext paths, no full-content decrypt, and the rich metadata stays **sealed from
  the host** (only the client decrypts the index).
- Keep the index **minimal** (it's the bigger leak surface if the client is compromised).
- It's *"client decrypts the index to query"* — **not** query-while-encrypted (SSE/homomorphic is
  far heavier, overkill). The **vector DB / RAG** is the sophisticated form: embeddings = the
  searchable index layer; content fetched on hit.

## (Q4) Shared pod → shared encryption (a group key)
A shared household pod needs a **shared group key** (= the existing `HouseholdConfig.groupKeyId`):
- **Join:** group key **sealed to the new member's public key** (distributed). `project-seal`
  already wraps a key to N recipients — the primitive exists.
- **Leave:** revoke ACL **and rotate the group key** (forward secrecy — the departed member can't
  read *future* content; they keep already-downloaded ciphertext).
- The **household control-agent owns both** — ACL grant/revoke **and** group-key distribution/
  rotation — applied together on membership events (see `HOUSEHOLD-LLM-CIRCLE-JOURNEYS.md`).
- Choice: a **shared group key** (encrypt with it; distribute sealed-per-member; rotate on leave) is
  cleaner than per-resource multi-recipient (re-wrapping every resource to N members each change).

## Re-wrapping, key distribution, and pseudonym decoding (mechanics)

**Envelope:** each resource = `content-under-CEK` + `CEK wrapped once per recipient` (`{rid, wrappedCEK}`).

**Granting access to EXISTING content = an active re-wrap** (not a pure ACL flip): a current
key-holder (the grantor, or the **control-agent**) fetches the envelope → unwraps the CEK with their
private key → wraps it to the new recipient's public key → writes it back. So a current recipient
must act → **the control-agent holds the group key** and does grants/rotations, so it works without
a human online.
- **Group-key shortcut (household):** don't re-wrap every resource — the group key is wrapped
  per-member in one key resource; grant = **one** wrap (group key → new member). O(1), not O(resources).

**Offline clients learn new keys by reading the POD — the pod is the key-distribution channel.**
The wrapped keys live on the pod: a **versioned key resource** (e.g. `/.keys/group-v3.json`) holds
the group key **wrapped to each current member**. Offline client reconnects → reads the current key
resource → unwraps with its **local private key** → done. No out-of-band push; no new code (envelope
format is stable — only the key material changes).
- **Rotation = a new version** wrapped to the new member set; content records which key version
  sealed it; clients fetch the versions they need. A revoked member isn't in `v3` → can't read new
  content (keeps cached `v2`). Forward-private, not retroactive.

**Pseudonym decoding = the sealed index.** Opaque resource ids (host sees `01HXY…`) are decoded by
the **sealed index**, which maps pseudonym → meaning (+ holds the queryable metadata). Decrypt the
index → decode pseudonyms **and** query in one step. The index does triple duty: query +
pseudonym-decode + RAG. The sealing layer owns it (update-on-write, sealed, sharded).

**So a grant touches keys (re-wrap) + ACL + index — all on the pod, done by the agent; offline
clients just re-read.** The `sealing` substrate must therefore: write versioned key resources to the
pod; support the control-agent as key-holder for grant/rotate; and own the sealed index.

## Key custody, granularity, and what CSS actually does (clarifications)

**Who holds the key (P3 / sealed-at-rest):** NOT the pod host. The **pod server (CSS) holds only
ciphertext + no key** — it can't decrypt. The **writer holds only the public key** (host-blind
seal). The **opener (private key)** is the data **controller** (Phase 1 — opens transiently in its
own RAM) or an **enclave** (Phase 2 — key released only into the attested TEE; even the controller's
host can't read). P3 separates the **dumb ciphertext pod-host** from the **processor that holds the
key + opens briefly** — usually different machines. That's why feedback can run on any (untrusted)
CSS host.

**Granularity is a second axis on every posture — per-resource vs whole-blob:**
- **Per-resource envelope + cleartext-pseudonym structure + sealed index** — preserves Solid
  semantics (fetch one resource, per-resource ACL, partial sync). **Live apps (P2 + P3) want this.**
- **Whole-container/pod encryption (one opaque blob)** — hides structure maximally but loses the
  structured store (no per-resource serve/ACL; all-or-nothing read). Suits **archive/backup/vault**,
  not live apps. (So the "encrypted backups" overlay can be a single blob even when the live pod is
  enveloped.)
- Rule: **live → per-resource envelope; backup/archive → whole-blob OK.**

**What a CSS server actually does:** the default **file backend** stores each resource as a **file
on disk** (containers = dirs); it **reads/writes per request** (a web/file server), it does NOT hold
the whole pod in RAM. Transient RAM holds only what it's serving — for sealed resources that's
**ciphertext only** (host has no key). The **in-memory** backend (everything in RAM) is test-only.
**CSS stores resources as plaintext on disk by default** (ACL-protected, not encrypted at rest) — so
**at-rest encryption is OUR sealing layer** (seal before PUT), not a CSS feature. CSS never needs the
plaintext to serve bytes + enforce ACL on cleartext paths.

## The coherent household model
**Content sealed with a shared group key** + **structure cleartext (opaque ids)** + a **sealed
index layer** for query/RAG + the **control-agent owning key+ACL** on join/leave — all behind a
**`@canopy/pod-client` `sealing` substrate**. Substrate-lift + shared-key = the directly-actionable
household pieces.
