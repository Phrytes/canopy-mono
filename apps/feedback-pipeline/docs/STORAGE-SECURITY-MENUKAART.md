# Storage & security posture — menukaart

**Security posture is a per-deployment POLICY, not a global default.** Requirements differ per
situation, so the substrate gives a *spectrum* of postures and each app/circle/deployment picks one.
Consistent with how feedback already works (`privacy.seal`, `privacy.verify`,
`aggregation.location`). **Encryption is one posture among several — not a forced default.**

Freedom **with guidance**: a small set of **coherent named postures**, each with a recommended
use-case — *choose a posture*, don't twiddle 12 booleans (avoids footguns). The **substrate provides
the primitives**; the posture is the policy bundle. *Mechanics (envelope, re-wrap, key distribution,
pseudonym/index, key custody, CSS reality): see `POD-ENCRYPTION-MODEL.md`.*

## Two axes
1. **Posture** — who can read the *content*.
2. **Granularity** — *per-resource envelope* (preserves Solid fetch / per-resource ACL / partial
   sync — **live apps need this**) vs *whole-blob* (all-or-nothing — **archive/backup** only).

## The postures

| Posture | Who can read content | Search / processing | Recommended for |
|---|---|---|---|
| **P0 — Trusted host, plaintext** | the host | full **server-side** index/search | a trusted local machine / fully-trusted managed host |
| **P1 — TEE / enclave** | only the attested enclave (host blind) | full search + LLM **in-enclave**, host-blind | hosted-but-private; needs rich server-side help |
| **P2 — Client-side E2E (sealed)** | only clients holding the key (server blind) | **local** index/search | **household** — client-side keys, no server trust |
| **P3 — Sealed at rest, opened for processing** | sealed; opened transiently by the key-holder | **no keyword search** — the **LLM works on opened data** | **feedback app** |
| **+ Encrypted (indexed) backups** | overlay on any posture (whole-blob OK) | — | durability/safety for P0/P1 |

## Decision heuristic
Two questions land you on a posture:
1. **Who do you NOT trust?** host → P1/P2/P3; any server → P2; no-one but yourself → P2; you trust
   a box you control → P0.
2. **What search/processing do you need?** server-side rich → P0/P1; local → P2; LLM-only → P3; none → any.

**Per-situation defaults:** household → **P2**; feedback → **P3**; "I have a trusted box" → **P0 +
encrypted backups**; "hosted but private" → **P1**.

## Search under each posture (the crux of encryption-vs-indexability)
- **Lookup vs search:** lookup-by-id is *always* efficient — the (cleartext, pseudonymous) path *is*
  the route, like an IPFS CID; encryption doesn't touch it. **Search-by-keyword** is what encryption
  affects. The pod already has IPFS-style lookup; search is the separate hard problem.
- **P0 (host reads):** server-side full-text index (the host holds keys + reads content). The
  tradeoff is fundamental: when the *client* holds the keys, server-side content search is no longer
  possible — you can search metadata/paths, not content.
- **P1 (enclave):** full search/index/LLM **inside the attested enclave**, host-blind —
  server-assisted search where the **server cannot read the content** (vs. host-reads-plaintext, or
  client-only local search).
- **P2 (client-E2E):** **local sealed index** (search runs on the client). Optional **SSE** (server matches blind
  `PRF(keyword)` tokens → encrypted ids, sublinear) — at the cost of access-pattern leakage + only
  indexed queries.
- **P3 (sealed + opened):** no keyword search at all — the **LLM works on opened data** (feedback);
  pseudonyms/index irrelevant.
- **Semantic (any of P1/P2):** a **vector DB** (local for P2, in-enclave for P1) — meaning-search,
  not exact words.
- **Bottom line:** encryption forbids *server-side-plaintext* search, **not efficient search per se** —
  search just migrates to an index that lives somewhere you trust (local / SSE / in-enclave). O(log N)
  search survives *if you keep an index*; without one it's an O(N) scan.

## Coherence (not a free knob-buffet)
Postures are **bundles**; some combos contradict (P2 + server-side search is impossible). Document the
*valid* combinations + each one's implied search-capability. The **granularity axis** is orthogonal but
constrained: **live → per-resource; backup/archive → whole-blob**.

## The substrate primitives (one set powers every posture)
Build these in `@canopy/pod-client` (rule-of-two met: feedback + household). The posture is *which* you
turn on:
- **`sealing/` module** — envelope encryption (per-resource CEK + recipient/group-key wrap), lifted +
  generalized from `project-seal`. **Opt-in** (Q2 re-scoped: the primitive, *not* a forced default).
- **`SealedPodClient` wrapper** — transparent seal-on-write / open-on-read over `PodClient`.
- **`sharing/` + re-wrap/rotation** — `grant` re-wraps the CEK (or wraps the group key once); `revoke`
  rotates; the control-agent (key-holder) drives it.
- **Versioned key resources on the pod** (`/.keys/group-vN.json`) — key distribution; offline-safe
  (reconnect → read → unwrap with local private key).
- **Sealed index** — pseudonym-decode + query + RAG; shardable (decrypt only the shard you need).
- **In-enclave hooks** (P1) — search / RAG / LLM inside the attested TEE, host-blind.
- **Encrypted backups** — whole-blob overlay on any posture.

So: the substrate is one composable primitive set; **the posture is a documented policy choice**, with
opinionated per-situation defaults, never a forced global default.
