# Storage-mapping migration — design sketch (2026-05-14)

> Resolves substrates-v2 coding plan §"Open questions" #4:
> "Storage-mapping migration. When a user upgrades from one-pod to
> two-pod, rewrite map shape + lifecycle. Pin during 52.5."
>
> **Status:** design sketch only. **Implementation deferred to V2**
> when a real consumer surfaces.

## TL;DR (locked 2026-05-14)

**Changing the storage mapping is JUST about future storage
actions.** The substrate rewrites the config; future writes route
via the new mapping; future reads resolve via the new mapping. **The
substrate does NOT migrate existing data.** Moving / re-uploading
the user's existing resources, updating outbound references, and
coordinating with other apps are **the user's responsibility**
(potentially aided by external tooling, but not by this substrate).

This narrows the scope dramatically. The substrate ships ONE primitive
— `pod-routing.setStorageMapping(newMap)` — that's an atomic config
rewrite. Apps using pod-routing pick up the new mapping at next
read; in-process pod-routing instances refresh via a config-change
event (push or poll).

What the user has to do separately:
- **Move their existing data** (read from old paths, write to new
  paths via pod-client). The user can script this with the existing
  pod-client `read` / `write` / `list` / `delete` primitives.
- **Update outbound references** they previously published (cap-
  tokens, ACP grants, item links). Substrate can't do this — it
  doesn't own consumer state.
- **Tell other apps + peers** (out-of-band, or via a one-shot
  notify-envelope broadcast they trigger themselves).

What the user gets from the substrate:
- A clean, atomic config rewrite. After the rewrite, every future
  read / write that goes through pod-routing uses the new mapping.
- An event (`config-changed`) per pod-routing instance so apps can
  re-resolve dynamically.
- That's it.

## Why the narrower scope is the right call

The original framing imagined the substrate would coordinate the
whole migration: data movement, reference updates, in-flight
write handling, ACP replay, rollback. That's a 14-day V2 epic and
a lot of moving parts.

But the substrate **doesn't have natural authority** to do most of
that. It doesn't know:
- Which resources the user still wants to keep vs delete
- Which references are stale (e.g., expired cap-tokens) vs live
- Which peers care about the migration vs aren't talking to this
  user anymore
- Whether the migration is provider-switch vs path-restructure vs
  both at once

All those are user-knowledge. The user knows what they want; they
have the pod-client primitives to do it; the substrate's job is
to make the config rewrite atomic and observable. Out-of-scope is
the right answer to "should the substrate coordinate the migration."

## What the substrate ships

### `pod-routing.setStorageMapping(newMap, opts?)`

```js
const podRouting = createPodRouting({ ... });

await podRouting.setStorageMapping(
  {
    'items':  '<pod-B>/sharing/items/',
    'photos': '<pod-B>/sharing/photos/',
    // type/domain-keyed, app-agnostic (storage-layout.md, AMENDED 2026-05-17)
  },
  {
    reason: 'switched-provider',   // free-text, persisted in config history
  },
);
```

- Writes the new mapping to the config resource via CAS retry
  (uses `agent-registry/concurrency.js` style `withCAS`).
- Atomic from the consumer's perspective: either the new mapping
  is visible, or the old one. No half-state.
- Emits a `config-changed` event on the `podRouting` instance so
  in-process consumers can refresh.
- Returns `{ previous, current }` so apps can show the user what
  changed.

### `podRouting.on('config-changed', handler)`

Apps subscribe to know when the config changed (e.g., admin
made a change on another device). The substrate's internal cache
expires when this fires; subsequent `uriFor(storageFunction)`
calls reflect the new mapping.

Cross-device propagation (admin on phone, peer on laptop) uses the
existing pod-routing refresh cadence (TTL-based; default 30s — see
Q#8 entry in open-questions). Apps that need immediate propagation
can listen for an envelope-level signal — but again, that's the
user's choice, not substrate-mandated.

### Config history (optional)

The config resource keeps the LAST K mappings in a `history` array
so an audit log is available. K=10 default. Apps + the future
Hub-web-console (P5 Hub track) can show "you changed your
storage-mapping on YYYY-MM-DD; here's what it was before."

```json
{
  "version":     2,
  "activeMap":   { ... current mapping ... },
  "history":     [
    { "map": {...prior...}, "changedAt": "2026-05-14T10:00Z", "reason": "..." },
    ...
  ]
}
```

## What the user does (outside the substrate)

A typical "I want to move my pod" workflow looks like:

1. **Decide what's moving.** User looks at their current
   storage-mapping (Folio settings panel; future Hub-web-console).
2. **Set up the new destination.** New pod provisioned via
   `pod-onboarding`; templates applied.
3. **Copy data.** User-scripted or done via a future "migration
   helper" tool that uses pod-client primitives. The substrate
   doesn't bless any particular tool; documentation points at
   pod-client.
4. **Update outbound references.** Re-issue cap-tokens / ACP
   grants for the new paths. Phase 52.16 primitives handle this
   per-resource.
5. **Flip the config.** `podRouting.setStorageMapping(newMap)`.
   From this point, future writes go to the new pod.
6. **Verify.** User confirms the apps work as expected on the new
   mapping. Old paths still resolvable via direct URI if the old
   pod is still alive (substrate has nothing to do with that).
7. **(Optional) Tear down the old data** if the user is done with
   it. Substrate doesn't touch.
8. **(Optional) Tell peers.** User can trigger a one-shot
   `notify-envelope.publish({type:'migration-announcement', payload: {old, new}})`
   to known peers. Receivers' apps decide what to do with it.

The substrate covers step 5. Everything else is user / app land.

## Open questions this leaves explicit

- **Should there be a user-facing "migration helper" tool that
  scripts steps 1–4 + 7?** Probably yes, eventually. Lives in
  Folio's CLI initially (it has the user's pod-client + the
  identity); not a substrate.
- **How do peers learn about the migration?** Not the substrate's
  problem. Apps that care broadcast their own `migration-announcement`
  envelopes when the user finalises. Apps that don't care, don't.
- **What if the user wants partial migration** (move photos, leave
  items)? Just write a partial new mapping. The substrate doesn't
  enforce all-or-nothing.

## V2 phase shape (if/when scheduled)

| Phase | Scope | Estimate |
|---|---|---|
| 52.M1 — `podRouting.setStorageMapping()` + `config-changed` event + history array | substrate primitive | ≈1 day |
| 52.M2 — pod-routing tests for CAS rewrite, event firing, history accumulation | substrate tests | ≈0.5 day |
| 52.M3 — Folio settings panel: "Move my storage" UX wrapping setStorageMapping | app-side | ≈1 day |
| 52.M4 — folio CLI helper: `folio migrate-storage --from X --to Y` (scripts read/write copy) | app-side; uses pod-client primitives | ≈1.5 days |

**Total ≈4 days V2 work.** Substantially smaller than the original
14-day estimate because the substrate doesn't try to do data
migration.

## Pointers

- `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
  §"Open questions" #4 (resolved by this doc)
- `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
  §4.3 — pod-routing substrate
- `packages/pod-routing/src/configResource.js` — current config shape
- `packages/agent-registry/src/concurrency.js` — `withCAS` pattern
  reused for the config rewrite
- TODO-GENERAL.md "🟡 MEDIUM — Default pod issuer flexibility" —
  adjacent concern (pod-provider switching); the migration helper
  in 52.M4 supports the use case there
