# @onderling/recipe-loader

**B #64 — loader + validator for authored remote recipes.**

A *recipe* is a third-party `{capabilities, settings, surfaces, freedoms}` bundle
that configures a circle — which capabilities are enabled, the settings defaults,
the surface layout, and the admin freedom template — **authored off-app, hosted as
a file, and run locally**. This package is the **loader**: fetch (injected), parse,
validate, trust-gate, normalise. It does *not* apply the recipe to a live circle
(that seam is deferred — see below).

> Not to be confused with basis's **in-circle** `kringRecipe*` broadcast
> (live member-to-member config sync). #64 is a **remote/authored** recipe from an
> external source.

## API

```js
import { loadRecipe } from '@onderling/recipe-loader';

const res = await loadRecipe(source, { fetch, verify });
// success →  { recipe, warnings: string[] }
// failure →  { error: { code, message, issues? } }
```

- **`source`** — an object (used directly), a JSON string (parsed), or a
  `http(s)://` / `file://` URL (fetched via the injected `fetch`; there is no
  ambient network — a URL with no `fetch` fails `no-fetch`).
- **`fetch(url)`** — injected fetcher; returns a string or a Response-like
  `{ text() | json() }`. Injected so the loader is testable offline.
- **`verify(recipe, rawSource) → boolean`** — the **trust seam**. Deny-by-default:
  when supplied it must return truthy or the load is denied. When omitted, the
  recipe loads with a `warnings: ['unverified']` advisory. Real signature crypto is
  out of scope for this slice — it plugs in behind this contract.

## Recipe schema — and which existing validator each field reuses

| field          | shape                                                   | validated by (reused) |
|----------------|---------------------------------------------------------|-----------------------|
| `capabilities` | `{ <noun>: { atoms: [<atom>…] } }`                       | `@onderling/app-manifest` `isRegistryType` (nouns, vs the `@onderling/item-types` registry) + `isAtom`/`canonicalAtom` (atoms) — the same discipline `validateManifest` applies to `manifest.nouns` |
| `freedoms`     | `{ "<app> <atom> <noun>": { enabled?, freedom?, consequence?, privacyFloor? } }` | atom+noun as above; entry against exported `FREEDOM_LEVELS` / `OPT_OUT_CONSEQUENCES` (the `freedom.js` shape) |
| `settings`     | `{ "<app>.<key>": value }`                              | **structural only** (key shape + JSON-serialisable value) — per-value schema lives in each app's `manifest.settings`; that check is part of the deferred apply seam |
| `surfaces`     | `{ features?: { <feature>: bool }, view? }`             | **structural only** — the authoritative `CIRCLE_FEATURES` / view enum live in basis `circlePolicy.js`, which this package must not depend up on; enum-matching is part of the deferred apply seam |

Forward-additive (house style): unknown *top-level* fields are tolerated with an
`unknown-field` warning; unknown/malformed *values* (non-registry noun, non-atom
verb, out-of-enum freedom) are hard, coded issues (`error.issues[]`).

## Deferred seam — apply-wiring

Turning a loaded recipe into an **active circle policy** (merge onto
`DEFAULT_CIRCLE_POLICY`, schema-check settings against installed manifests,
enum-check surfaces) lives in **basis** — it needs the feature/view enums and
the installed manifest set. This package stops at a validated, normalised,
trust-tagged bundle ready to hand to that applier.

## Layer & dependencies

Substrate. Depends on `@onderling/app-manifest` (validation primitives) — no app
dependency (invariant #5). Loader/validator is pure and Node/web-portable.
