# Track K — Lightweight bundles for SDK consumers

| | |
|---|---|
| **Status** | plan-drafted |
| **Started** | — |
| **Last updated** | 2026-04-30 — initial plan |
| **Owner** | unassigned |
| **Blocked on** | nothing — investigation can begin any time |

**Goal:** make the SDK's published packages **bundle-friendly**, so a
consumer app (Folio mobile, future H apps) only ships the code it
actually uses — not the entire agent surface.

**Why now:** Folio mobile's first run shows a blank white screen for
30+ seconds because the dev-build bundle parses ~30k lines of
unrelated agent code before mounting React.  Folio doesn't need BLE,
mesh routing, A2A, skills, or WebRTC — but the current import graph
drags it all in.

---

## What the actual problem is

The user's intuition is right: **ES modules + Metro = no automatic
tree-shaking unless every link in the chain is marked
side-effect-free**.  Folio-mobile imports look like this:

```
folio-mobile/src/ServiceContext.js
  → @canopy-app/folio/rn/serviceFactory
      → @canopy/pod-client (PodClient, SolidOidcAuth)
          → @canopy/core (entire `src/index.js`)
              → src/transport/* (BLE / WiFi / Relay / Rendezvous / WebRTC)
              → src/protocol/* (Skills / A2A / Negotiation / Sessions)
              → src/security/* (Capabilities, sealed forwarding)
              → src/identity/* ✓ (Folio actually uses this)
              → src/storage/* ✓ (Folio actually uses this)
              → src/discovery/* (mDNS, peer discovery)
```

Folio uses **2 of ~8** subdirectories.  The other 6 are dead weight.

Metro can prune this if every package declares `"sideEffects": false`
in its package.json — then Metro knows it's safe to drop unused
exports.  None of `@canopy/*` declare this today.

---

## Three paths

### Option 1 — Tree-shake the existing packages (cheapest)

Add `"sideEffects": false` (or a precise sideEffects array) to:
- `packages/core/package.json`
- `packages/pod-client/package.json`
- `packages/react-native/package.json`
- `apps/folio/package.json`

Audit modules for actual side effects (top-level emitter wiring,
crypto state setup, etc.) and exempt only those.  Metro/webpack/
Rollup all respect the flag.

Then **swap `import { X } from '@canopy/core'` for deep imports**
in folio-mobile (`@canopy/core/src/identity/AgentIdentity.js`)
where possible — bypasses the barrel index entirely.

**Risk:** silent breakage if a side-effect-bearing module gets
pruned.  Need tests covering bundle sizes + functional smoke after
prune.

**Estimated bundle reduction:** 60–70% (educated guess; needs
measurement).

### Option 2 — New `@canopy/pod-lite` package (cleanest API surface)

Create a new package that re-exports ONLY what pod consumers need:

```
packages/pod-lite/
  src/
    index.js                   # re-exports below
  package.json                 # depends on core, pod-client; "sideEffects": false
```

Re-export surface:
- `Bootstrap`, `AgentIdentity`, `Vault*` interfaces
- `PodClient`, `PodCapabilityToken`, `SolidOidcAuth`, `CapabilityAuth`
- `IdentityPodStore` (if shared-vault sync is wanted on mobile later)

Folio + future pod-only H apps import `@canopy/pod-lite` instead
of `@canopy/core` + `@canopy/pod-client`.

**Pros:** clean API; explicit about what's included; new packages
can ship with `"sideEffects": false` from day one.
**Cons:** maintenance burden — need to keep re-exports in sync as
core grows.

### Option 3 — Code-split via dynamic imports (RN-side only)

Wrap heavy/optional features in `React.lazy()` or `await import(...)`
so they're only fetched when needed:

```js
// SignInScreen — light surface
// → tap "Sign in" → dynamic-import folioAuth + the auth modules
const folioAuth = await import('../auth/folioAuth.js');
```

Initial bundle stays tiny; auth loads on-demand.  Doesn't help with
the SDK's intrinsic weight — that's still in the secondary chunk —
but spreads the parse cost across user actions.

**Pros:** no SDK-side changes.
**Cons:** doesn't solve the root cause; UX-jarring spinners during
nav.

---

## Recommended sequence

1. **Measure first** (~half-day).  Use Metro's `--source-maps` flag
   to dump the bundle, then a tool like `react-native-bundle-visualizer`
   or `source-map-explorer` to see the actual size breakdown by
   module.  Decide on Option 1 or 2 with data, not guesswork.

2. **Try Option 1 first** (cheapest if it works).  Add
   `"sideEffects": false`, refactor folio-mobile's imports to
   bypass the core barrel, measure again.

3. **If Option 1 misses by >30%**, escalate to Option 2 (new
   `pod-lite` package).

4. **Drop Option 3 unless** measurement shows specific screens are
   particularly heavy and Option 1+2 don't cover it.

---

## Open questions

| # | Question | Lean |
|---|---|---|
| Q-K.1 | Is there a way to check bundle weight without rebuilding the dev client? | **Use `npx expo export --platform android`** — produces a production bundle without building the native app.  Diff against current. |
| Q-K.2 | How aggressive can the prune be without breaking @canopy/core's existing tests? | **Run the full 1236-test core suite after each prune step.**  CI's matrix workflow makes this cheap. |
| Q-K.3 | Should `apps/folio-mobile` use `@canopy/pod-lite` (Option 2) even if Option 1 covers most of the gap? | **TBD — depends on measurement.**  If Option 1 gets us under, say, 15 MB bundle, pod-lite isn't worth the maintenance cost. |
| Q-K.4 | Does this also help future H apps (H4 Tasks, H6 Import bridge)? | **Yes — they'll be pod-only consumers too.**  H4 + H6 should benefit from whichever path we pick. |

---

## Out of scope

- Splitting `@canopy/core` into multiple sub-packages (huge refactor; not worth it for the PoC).
- Replacing Metro with another bundler (esbuild, swc, etc.).
- Webpack-style code splitting beyond what Option 3 offers.
- Optimizing the JS code itself for execution speed (only bundle size matters here; parse + execute time follows naturally).

---

## Pointers

- [Metro tree-shaking docs](https://metrobundler.dev/docs/tree-shaking) — `experimentalImportSupport` flag + `sideEffects` recognition
- `apps/folio-mobile/metro.config.js` — already has explicit subpath aliases; will need to extend for deep imports
- `apps/folio/src/rn/serviceFactory.js` — the import-graph entry point that pulls in core/pod-client
