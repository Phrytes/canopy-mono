# Pod at-rest encryption model (content vs structure, substrate, layered index, shared key)

Answers + design decisions from the 2026-06-10 questions. Reference for the household shared-pod
build. Companion to `SECURITY-MODEL.md` (the feedback trust model) and
`HOUSEHOLD-LLM-CIRCLE-JOURNEYS.md` (the shared-pod circle).

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

## The coherent household model
**Content sealed with a shared group key** + **structure cleartext (opaque ids)** + a **sealed
index layer** for query/RAG + the **control-agent owning key+ACL** on join/leave — all behind a
**`@canopy/pod-client` `sealing` substrate**. Substrate-lift + shared-key = the directly-actionable
household pieces.
