# Stoop pod layout (Phase 20, 2026-05-06; updated Phase 33, 2026-05-06)

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
├── settings/
│   ├── shared.json           ← user-portable settings (Phase 33, V2.5)
│   └── devices/
│       └── <deviceId>.json   ← per-install settings (Phase 33, V2.5)
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

### Shared vs. per-device settings (Phase 33, V2.5 — cross-app convention)

> **Cross-app rule.**  Every agent-SDK app SHOULD use this layout
> when its settings include both user-portable preferences and
> device-specific knobs.  Apps that only have user-portable
> settings keep just `shared.json`.
>
> **Full convention with the cross-app shared-defaults rule:**
> [`../conventions/cross-app-settings.md`](../conventions/cross-app-settings.md).

The user has a single Solid pod but multiple installs (phone +
laptop + …).  Some preferences are about *the user* (broadcastable,
default share-location flag, holiday-mode signal) — those follow
them across every device.  Others are about *the install* (poll
cadence, mobile online-window, global hop-relay decision) — those
must NOT travel via the pod, because a phone shouldn't inherit a
desktop's 2-second poll, and a laptop shouldn't inherit a phone's
battery-saving window.

Stoop encodes this with a two-blob layout:

```
<pod>/<app>/settings/shared.json              user-portable
<pod>/<app>/settings/devices/<deviceId>.json  per-install
```

- `shared.json` is one blob.  Every device of the user reads + writes
  it; last-write-wins on conflict (acceptable for low-frequency
  preference changes).
- `devices/<deviceId>.json` is one blob *per install*.  `<deviceId>`
  is a UUIDv4 generated on first run of the install and persisted in
  the agent's vault under `agent-device-id` (see
  `core.AgentIdentity.deviceId`, V2.5 Phase 33.1).  The blob is
  read + written ONLY by that install — other installs see it but
  never overwrite it.

#### Field-set partition

Each app's `loadSettings({dataSource, deviceId})` resolves the
merged view by reading both blobs.  Each app's `saveSettings` /
`updateSettings` route patches by field name:

| Stoop field | Scope | Why |
|---|---|---|
| `pollIntervalMs` | device | Per-machine UI cadence. |
| `onlineWindow` | device | Mobile-only battery-aware schedule. |
| `allowHopThrough` | device | Hardware decision to relay for others. |
| `broadcastable` | shared | User policy: accept inbound auto-skill-match? |
| `defaultShareLocation` | shared | User preference for new-contact defaults. |

Apps that fork this pattern: define your own per-field partition in
`<app>/src/lib/Settings.js`.  The partition is a runtime contract —
add a new field to the right set in the same change that introduces
it; never let "new" fields default to "shared" silently when they
should be device-scoped.

#### ACPs

`shared.json` follows the user's standard "owner-only" policy.
`devices/<deviceId>.json` files are also owner-only — multi-device
sync is implicit (the same user owns all installs); the deviceId
namespacing prevents *cross-install* overwrites, not *cross-user*
reads.

#### Migration from a flat `settings.json`

Stoop's V2 stored everything in `<pod>/stoop/settings.json`.  V2.5
Phase 33.3 migrates lazily on first load: read the legacy blob,
partition by field, write the new layout, delete the legacy blob,
mark `mem://stoop/settings/.migrated-from-v2`.  Idempotent.  Other
apps adopting this pattern after a flat settings.json predecessor
should follow the same shape.

#### Why a UUIDv4 for `deviceId`?

- Recognisable in logs and pod paths.
- Doesn't expose hardware identifiers.
- Per-install: `restoreFromMnemonic` onto a fresh device produces
  the same `stableId` (so contacts find you) but a fresh `deviceId`
  (so device-specific blobs don't collide).
- Survives `Agent.rotateIdentity()`: same install, same deviceId.

## Tracking

This doc is the V1.5 baseline; the V2.5 Phase 33 update added the
shared/device split.  ACP wording, container naming, and pod-side
sync cadence are tracked in
`Project Files/Stoop/coding-plan-v1-2026-05-05.md` §Phase 20.
The settings split (Phase 33) is tracked in
`Project Files/Stoop/coding-plan-v2-2026-05-07.md`.
Substrate-level changes (e.g. promoting `OidcSession` into
`@canopy/oidc-session`, or extracting the settings-split helper
into `@canopy/online-cadence`) are tracked in
`Project Files/Substrates/substrate-candidates.md`.
