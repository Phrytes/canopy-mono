# Stoop pod layout (Phase 20, 2026-05-06)

How a Stoop bundle lays its data out under a Solid pod when
`bundle.cache.attachInner(<SolidPodSource>)` is wired.  All paths
are relative to the user's `pim:storage` (the pod root).

## Top-level container

```
<pod-root>/stoop/
├── members/                  ← per-group MemberMap entries
│   └── <gid>.json
├── items/                    ← every Item.kind: ask | offer | lend | report | …
│   └── <ulid>.json
├── threads/                  ← peer chat (one file per threadId)
│   └── <thread-id>.json
├── reveals/                  ← per-group reveal state for this user
│   └── <gid>.json
└── groups/                   ← group membership + governance
    └── <gid>/
        ├── rules.md          ← human-readable governance
        └── config.json       ← pubKey roster, role, joinedAt
```

The `CachingDataSource` keys map directly: every item posted via
`postRequest` becomes `mem://neighborhood/<ulid>` locally and
`<pod-root>/stoop/items/<ulid>.json` remotely once a pod is
attached.

## ACPs (access policies)

| Resource | Default ACP |
|---|---|
| `stoop/members/<gid>.json` | Group members can read; only the user can write. |
| `stoop/items/<ulid>.json` | Group members can read; only the author can write/delete. |
| `stoop/threads/<thread-id>.json` | Only the two participants can read/write. |
| `stoop/reveals/<gid>.json` | Owner-only. |
| `stoop/groups/<gid>/rules.md` | Group members can read; admins can write. |
| `stoop/groups/<gid>/config.json` | Group members can read; admins can write. |

ACP enforcement is the pod's job; Stoop trusts the pod to reject
unauthorised reads.  Stoop's local mute / report layer still
applies on top of pod ACLs.

## Why store anything locally

Two reasons:

1. **Local-only mode is the floor.**  Stoop must work without a
   pod.  The local cache is therefore the source of truth for the
   running session; the pod is a write-through replica.
2. **Offline tolerance.**  When the pod is unreachable the
   `CachingDataSource` queues writes and replays them when
   reachable again — the user keeps posting, the network
   asynchronously catches up.

## Migration: local → pod

When a user signs in with `startPodSignIn` →
`completePodSignIn`, the `CachingDataSource.attachInner(podSource)`
call atomically:

1. Sets the pod source as the inner DataSource.
2. Flushes any queued writes the user produced offline (the items
   they posted before signing in are uploaded).
3. Starts honouring the cache's pull-from-inner cadence so future
   external updates land in the cache.

There is no separate "import" step — the cache is the staging
area that becomes a pod replica on attach.

## Pod-side multi-device

Two devices signing in to the same pod see the same data.  The
`CachingDataSource` per device maintains its own local copy;
both write through to the pod, and both pull from the pod.
Conflicts are resolved by the pod's per-resource `ETag`
preconditions (the SDK's `If-Match` story), not by Stoop.

## Tracking

This doc is the V1.5 baseline.  ACP wording, container naming, and
pod-side sync cadence are tracked in
`Project Files/Stoop/coding-plan-v1-2026-05-05.md` §Phase 20.
Substrate-level changes (e.g. promoting `OidcSession` into
`@canopy/oidc-session`) are tracked in
`Project Files/Substrates/substrate-candidates.md`.
