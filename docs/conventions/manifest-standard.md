# Manifest standard — what a conformant app manifest must satisfy

CLAUDE.md invariant #4: **the manifest is the source of truth for surfaces.** An app declares its operations
and surfaces once in `apps/<app>/manifest.js`; the pure projectors (`renderChat` · `renderSlash` · `renderGate`
· `renderWeb` · `renderMobile`) turn that one declaration into every interface. For that to hold, every app
manifest has to meet a shared standard — otherwise a projector needs a per-app escape hatch and the "one
contract" property quietly erodes.

This page is that standard in prose. It is enforced, not aspirational: `manifestConformance(manifest)` in
`@onderling/app-manifest` returns `{ ok, issues, warnings }` for a single manifest, and the fitness test
`packages/app-manifest/test/manifestConformance.test.js` runs it against every discovered app manifest and
fails CI on drift. Issues carry a **code** (not a free string) so tooling and tests can assert on them.

> A manifest is conformant when `manifestConformance(m).ok === true`.

The standard encodes only rules that are already TRUE of every app manifest (tasks-v0, stoop, household,
calendar, folio, canopy-chat). It is green on `master` and goes red on a real regression. Rules the codebase
does not universally hold to are deliberately **not** conformance failures — see "What is not a failure" below.

## The rules

### 1. Structural validity — `invalid-structure`

`validateManifest(m).ok` must be true: `app` is a non-empty string, `itemTypes` / `operations` are well-shaped,
every enum-valued field (param kinds, setting kinds, reply shapes, runtime, …) is a known value, there are no
duplicate operation or view ids, and every `nouns` key is one of `itemTypes`. This is the backbone — the shape
every projector assumes. One conformance issue is raised per underlying validator error, carrying its path.

### 2. Atom discipline — `verb-not-atom`

Every `op.verb` must be a known SDK atom (or a registered alias) **or** be declared in `manifest.domainVerbs`;
and a `domainVerbs` entry must not itself be an atom. This is the drift guard against a new noun-specific verb
sneaking into an op without either mapping to an atom (`add` / `list` / `complete` / `claim` / …) or being
named explicitly as domain-specific (folio `sync`, household `register`, stoop `report`). It is the packaged
form of the existing atom-discipline guard (B · Layer 1).

### 3. Noun-declaration discipline — `nouns-required` / `nouns-vacuous`

A manifest that has any **noun-bearing atom op** — an atom verb that names an item-type noun via
`appliesTo.type` or a `type`-enum param — **must** declare a `nouns` block (`nouns-required` otherwise). That
makes the app's member-facing `(verb × noun)` capability surface the author's explicit, written-down choice
rather than an implicit set the gate derives — the drift that let a broad `appliesTo` silently mint
capabilities on internal item types.

The inverse also holds: a manifest with **no** noun-bearing atom op must **not** declare a `nouns` block
(`nouns-vacuous` otherwise). This is the canopy-chat exemption made into a rule. canopy-chat is the
shell/unifier manifest — every op is an app-level command (`help` / `settings` / `newthread` / …) that names no
item noun, so there is nothing to curate. An empty `nouns:{}` would be worse than nothing: it flips the manifest
to declared-authoritative, and a future `chat-thread` / `chat-message` op's capability would be silently
dropped. So the rule is "noun-bearing ops ⇒ must declare", not "every manifest must declare".

### 4. Projector totality — `projector-error`

Each of the five surface projectors — `renderChat`, `renderSlash`, `renderGate`, `renderWeb`, `renderMobile` —
must turn the manifest into its surface without throwing. This is the literal reading of invariant #4: a
manifest that any projector chokes on is not, in fact, a single source of truth for every surface. One issue is
raised per failing projector, tagged with the surface key.

## What is not a conformance failure

The registry (`@onderling/item-types`) is the source of truth for nouns, but app-local (non-registry) item types
are permitted (F-SP1-a): household's `shopping` / `errand`, tasks-v0's `circle` / `schedule-slot`, and so on.
Requiring every declared noun to be registry-canonical would fail four of the six current apps, so that rule
(`validateManifest`'s opt-in `strictNouns`) is **not** part of the standard. Registry-noncanonical nouns are
instead surfaced as non-blocking `warnings` (code `noncanonical-itemtype`) on the conformance result — a
convergence signal for tooling and docs, never something that flips `ok`.

Likewise, the Q16 `strict` skillId cross-check (every `view.dataSource.skillId` resolving to a declared op or
`externalSkills` entry) is not required: some apps legitimately reference skills that live outside their
manifest.

**Coverage gaps are not conformance failures either.** An op that declares a chat surface but no slash command
is a legitimate coverage gap, tracked by the surface-coverage snapshot (`docs/surface-coverage.md` in
canopy-chat), not a conformance violation. Conformance asks "does every declared surface project?"; coverage
asks "which surfaces are declared?". They are separate checks.

## Using it

```js
import { manifestConformance } from '@onderling/app-manifest';

const { ok, issues, warnings } = manifestConformance(myManifest);
// ok      → boolean (reflects issues only)
// issues  → [{ code, message, path?, surface? }]  — codes: invalid-structure |
//           verb-not-atom | nouns-required | nouns-vacuous | projector-error
// warnings→ [{ code: 'noncanonical-itemtype', path, message }]  — non-blocking
```

The cross-app fitness test discovers app manifests by scanning `apps/`, so a **new** app with a `manifest.js`
is held to this standard automatically — you cannot add a non-conformant app silently.
