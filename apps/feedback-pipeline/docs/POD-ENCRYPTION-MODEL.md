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

## The coherent household model
**Content sealed with a shared group key** + **structure cleartext (opaque ids)** + a **sealed
index layer** for query/RAG + the **control-agent owning key+ACL** on join/leave — all behind a
**`@canopy/pod-client` `sealing` substrate**. Substrate-lift + shared-key = the directly-actionable
household pieces.
