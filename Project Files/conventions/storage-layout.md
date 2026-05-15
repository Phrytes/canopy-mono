# Convention: storage layout for `@canopy` pods

> **Status:** P1 deliverable (per transition doc §V.5). Documents the
> canonical pod-resource layout that `@canopy/pod-onboarding`
> provisions and that `@canopy/pod-routing` consumes. Discovery
> happens via the WebID profile; the layout below is what
> third-party Solid-aware tools will find at the documented paths.
>
> **Locked 2026-05-14.**

## Discovery

A user's WebID profile (e.g.
`https://alice.solidcommunity.net/profile/card#me`) carries pointer
predicates that resolve to the user's `@canopy` pod-resource
URIs. After `pod-onboarding.provisionDefault()` ships, the profile
contains (at least):

| Predicate | Object | Meaning |
|---|---|---|
| `solid:storage` (already standard) | `<pod>/` | Pod root |
| `dec:storage-mapping-uri` | `<pod>/private/storage-mapping` | Storage-mapping config resource |
| `dec:agent-registry-uri` | `<pod>/private/agent-registry` | Agent-registry config resource |

`dec:` is `https://w3id.org/canopy/vocab#`.

These are written by `pod-onboarding.provisionDefault()` →
`patchWebidProfile({pointers, predicates})`. The exact predicate
URIs and the JSON-LD shape live in
`packages/pod-onboarding/src/webidPointers.js`.

**Third-party tool flow:**
1. Resolve the user's WebID.
2. Read the profile document.
3. Look up `dec:storage-mapping-uri` → fetch that resource → parse
   the JSON-LD storage-mapping config.

## Canonical sub-container layout

Each `@canopy` pod is provisioned with the following top-level
containers. Apps MUST use these names; third-party tools can
expect them.

```
<pod>/
├── private/             — owner-only ACP; no public access
│   ├── identity-vault       — encrypted vault blob (mnemonic-locked)
│   ├── storage-mapping      — storage-mapping config (this doc)
│   ├── agent-registry       — agent-registry resource
│   └── notes/               — Folio's notes container (example)
├── sharing/             — default-deny ACP; per-resource overrides
│   ├── public/              — world-readable, owner-write ACP
│   │   └── profile.ttl          — WebID profile shortcut
│   ├── stoop/               — Stoop's items (example)
│   └── with-<webid>/        — Folio auto-share folders (Phase 52.16)
└── inbox/               — public-write (LDP inbox convention)
```

**ACP defaults** (per `pod-onboarding/src/acpTemplates.js`):
- `/private/` — agent-locked. Only the owning agent reads/writes.
- `/sharing/` — default-deny per-resource. ACPs added explicitly
  when a resource is shared (Phase 52.16 `client.sharing.*`).
- `/sharing/public/` — world-readable, owner-write. Apps writing
  here are explicitly publishing.

## Storage-mapping config

Resource at `<pod>/private/storage-mapping`. JSON-LD shape; mapping
table is keyed by **storage-function name** (a stable identifier
that apps know to look up) and valued by **destination URI**.

```json
{
  "@context":    { "dec": "https://w3id.org/canopy/vocab#" },
  "version":     1,
  "activeMap": {
    "stoop/items":     "<pod>/sharing/stoop/items/",
    "stoop/photos":    "<pod>/sharing/stoop/photos/",
    "folio/notes":     "<pod>/private/notes/",
    "tasks/ledger":    "<pod>/private/tasks/"
  }
}
```

Storage-function names are app-namespaced (`<app>/<function>`).
Apps register their function names when bootstrapping; users edit
the mapping via app settings or (eventually) the Hub-web-console.

Future-rewrite design: see
[`../Substrates/storage-migration-design-2026-05-14.md`](../Substrates/storage-migration-design-2026-05-14.md).

## Agent-registry resource

Resource at `<pod>/private/agent-registry`. JSON-LD list of the
user's agents (one entry per device / app installation). Used by
`@canopy/agent-registry` (Phase 52.10) for cross-device identity
lookups + by `@canopy/identity-resolver` (Phase 52.11) for
WebID↔pubKey resolution.

The list is owner-only by ACP; agents auto-register on first run
via `agent-registry.register(...)` with `withCAS` retry on etag
conflict (the user might be installing two apps simultaneously
on two devices).

## Pseudo-pod variants

For **no-pod users**, the same resources live in the local
pseudo-pod under `pseudo-pod://<deviceId>/private/...`. The
`configResourceUri({deviceId, anchorPodUri})` helper in
`packages/pod-routing/src/configResource.js` picks the right
location.

Apps that consume `pod-routing` don't need to branch — the
substrate handles it.

## Pinned decisions

- **One-pod default.** Most users have one pod that holds
  everything. Two-pod (private + household) is a deliberate
  user choice via the storage-mapping editor (future Hub-web-
  console, P5).
- **`with-<webid>/` auto-share folders** live under `/sharing/`,
  named with URL-encoded WebIDs. Phase 52.16 maintains them as
  ACP grants on supported pods; cap-token fallback otherwise.
- **`/inbox/` is open-write.** Conventional Solid LDP inbox; any
  agent can append. Use for notifications that DON'T need ACP
  per-resource configuration.

## Constraints + non-goals

- **No deep restructuring after V1.** Reorganising paths (e.g.,
  `/sharing/stoop/` → `/apps/stoop/`) is a storage-mapping
  migration concern; see migration-design doc. The substrate's
  job is not to make path layouts negotiable per-installation.
- **No automatic vocabulary translation across apps.** Apps that
  want to read each other's containers must understand the
  format (or use canonical item-types — see
  `packages/item-types/README.md`).
- **No path-versioning** ("v2" suffix on container names). The
  storage-mapping config IS the version layer; apps that bump
  their layout edit the mapping, not the path.

## Pointers

- `packages/pod-onboarding/src/provisionDefault.js` — pod-side
  provisioning + WebID-profile patch
- `packages/pod-onboarding/src/initialResources.js` — initial
  config + agent-registry shapes
- `packages/pod-onboarding/src/webidPointers.js` — predicate URIs
- `packages/pod-onboarding/src/acpTemplates.js` — default ACPs
- `packages/pod-routing/src/configResource.js` — config-resource
  read/write
- `packages/agent-registry/` — agent-registry CRUD
- `packages/item-types/` — canonical type taxonomy (separate
  concern; this doc is about pod layout, not item shapes)
- Substrates-v2 functional design §4.2, §4.3 — pod-onboarding
  and pod-routing substrate intent
