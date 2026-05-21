# Policies

Project-level rules.  These apply across the whole substrate-first
plan; individual layer sketches and app sketches reference them.

---

## Rule of two — consumer-spec gating

**Statement:** every substrate's API is shaped by **the two most
concrete consumer specs read side-by-side**, never by armchair design
in isolation.  A substrate's API is not locked until it can express
both consumers' needs cleanly on paper.

### Why

Substrate-first inverts the standard "build the first consumer, then
extract a library when the second consumer arrives" pattern.  The
classic failure mode of substrate-first is **API decisions made in
the absence of real-code feedback** — designs miss edge cases that
only show up when an app tries to use them.  The mitigation: rather
than waiting for real code, we use **detailed app design docs as
proxy consumers**.  The two-spec gate forces every substrate's
API decision to be checked against *two* concrete consumers, not
one.

### How to apply

When designing a substrate (Phase A — sketch — and Phase B —
implementation):

1. **Identify the two most concrete consumer specs.**  Each
   substrate sketch lists them at the top.  E.g. for `L1b (item-store)`:
   - Primary: H2 V2 spec (household items)
   - Secondary: H4 V0 spec (tasks)
2. **Read both specs side-by-side, in adjacent windows.**  Don't
   work from memory.
3. **Derive the API to express both.**  Every method, every field,
   every event needs to make sense for both consumers.  If one
   consumer needs something the other doesn't, that field is
   *optional* — never load-bearing.
4. **Check on paper before coding.**  Write the imagined consumer
   call sites for both apps in pseudocode, against the proposed API.
   If either reads awkwardly, the API isn't right yet.
5. **Lock the API only after both pass.**  Substrate ships its
   first version with both consumer call-paths designed.  Real
   apps come later, but substrate-first on a substrate-first plan
   means the API contract precedes the implementation.

### Worked example — `L1b (item-store)` 

H2 (household) wants:
- Add an item with `{type, text, addedBy, addedAt}`.
- Mark complete by id or fuzzy text match.
- List open items by type.
- Audit log of changes.

H4 (tasks) wants:
- Add an item with `{type, text, addedBy, addedAt, dependencies?, requiredSkills?, dueAt?, assignee?}`.
- Mark complete by id.
- Claim (compare-and-swap on `assignee`).
- List open items by type, by assignee, by skill.
- Reassign (coordinator-only, role-policy-gated).
- Audit log of changes.

The substrate's API has to express both.  Strategy:
- Item document = union of fields, all H4-extension fields optional.
- `add(item)` accepts both shapes; missing optional fields = absent.
- `markComplete(ref)` accepts id or fuzzy match (`{id}` or `{match: text}`).
- `claim(id)` is a compare-and-swap operation; H2 doesn't use it but the substrate still ships it.
- `list(filter)` accepts a generic filter shape that covers H2's "by type" and H4's "by type/by assignee/by skill".
- `audit` is a single primitive used by both.
- Role-policy gate is **pluggable** — H2 V0 has a single role, H4 has 5; substrate ships a no-op default and an injectable hook.

Both apps' use cases land on the same primitive without bending.
That's the substrate's API.

### When the rule fails

If one of the two consumers needs something genuinely incompatible
with the other (different merge semantics, different storage
shape), the substrate is wrong-grained.  Possible responses:

1. **Split the substrate.**  E.g. if H2's item-store wants LWW for
   everything and H4's wants compare-and-swap on one field, the
   primitive needs both — and they can coexist (per-field merge
   contracts).  If they truly can't coexist, two substrates.
2. **Defer the conflicting feature** to a later version.  Ship V0
   with what both consumers agree on; revisit the disagreement.
3. **Pull the feature into app-glue.**  The conflicting bit lives
   in each app's code, not in the substrate.

Flag the conflict in the substrate sketch's "Open questions"
section.  Don't paper over it.

---

## Versioning policy

### Per-substrate semver

Each substrate package gets independent semver:

- **Major bump** — breaking change to the public API.  Requires a
  CHANGELOG entry describing the break + migration path.  Apps
  consuming the substrate stay on the previous major until they
  migrate.
- **Minor bump** — additive change (new method, new optional
  parameter).  Backwards-compatible.
- **Patch bump** — bugfix; no API change.

Apps **pin known-good versions** in their `package.json`.  No app
auto-upgrades to a new substrate major; that's a deliberate choice
per app.

### Apps stay independently distributable

The end-state goal: **apps work, compile, and distribute
independently**.  An app extracted to its own repo with a
pinned-version dependency on each substrate it uses should
continue to work without the monorepo present.

Implications:
- Substrates do not import from `apps/`.  Ever.
- App-to-app dependencies are forbidden — apps reach each other
  via the shared pod, never via direct imports.
- A substrate may go unmaintained without breaking already-shipped
  apps; the apps stay on their pinned major.

### Cross-version mismatches

Different apps can depend on different majors of the same
substrate.  The relay or pod is the lingua franca; substrates
behave like libraries within an app, not like a shared service.

When two apps interoperate via the pod (the standard pattern
under "apps connect to the pod, not to each other"), they only
need agreement on the pod's data shape — not on substrate
versions.  This is why the pod schema is the cross-cutting
contract, not the substrate APIs.

---

## API-contract communication policy

### Public surface

Each substrate has an explicit public API surface — the methods,
classes, types, and events apps are expected to use.  Internal
helpers are not part of the contract; apps must not reach into
them.

Each substrate sketch declares its public surface in a "Public
API" section.  The actual package marks internals with a leading
underscore (`_internalHelper`) or keeps them out of the package's
`index.js` exports.

### Breaking changes

A breaking change is **anything that requires consumer code to
change** — renames, removed methods, changed parameter shape,
changed return type, changed event payload, changed default
behaviour.

When a substrate ships a breaking change:

1. **Major version bump.**
2. **CHANGELOG.md entry** with: what changed, why, and a copy-
   paste migration snippet.
3. **The deprecated form remains** for at least one major bump
   when feasible (a single major-bump cycle of overlap).
4. **A pull-request announcement** in whatever project channel is
   live.  Tag affected app maintainers.

### Non-breaking additions

Adding new methods, new optional parameters, new optional event
fields, new exported types — all minor bumps.  No CHANGELOG
required beyond the version bump itself.

### Communication shape

CHANGELOG entries follow this shape:

```
## [vX.Y.Z] — YYYY-MM-DD

### Breaking

- `methodName` renamed to `newMethodName`.
  Migration: replace `obj.methodName(x)` with `obj.newMethodName(x)`.
  Reason: the old name conflicted with the L1d agent-ui scaffold's method of the same name.

### Added

- `obj.newMethod(args)` — does X.

### Fixed

- bug Y was producing wrong results in case Z.
```

---

## When in doubt — defaults

- **Default to caution.**  Substrate APIs are hard to change once
  apps depend on them.  When unsure whether to ship a feature,
  defer it.
- **Default to small.**  An L1 substrate with too many features
  becomes its own ecosystem.  Split before bloating.
- **Default to honest.**  When two consumer specs disagree, surface
  the disagreement in the substrate sketch's "Open questions"
  section.  Don't paper over.
- **Default to consumer-driven.**  Don't add methods because they
  *could* be useful.  Add them because a real consumer's spec
  needs them.

---

## Substrate-candidate flagging — flag while writing, don't audit later (locked 2026-05-06)

> **When you write app-local code that you suspect a future second
> consumer would want, flag it inline as you write it.** This is
> the "second-consumer trigger" for rule-of-two — surfaced
> proactively by authors at write time, not retroactively by
> audits.

### Why this exists

Rule-of-two extraction works only if someone notices the *first*
consumer-shaped piece of code as it lands.  Discovering substrate
candidates by auditing every app every quarter is wasteful and
fragile — the audit easily misses the small, obvious-only-in-context
candidates.  Asking authors to flag candidates as they write keeps
the inventory honest at near-zero cost.

### How to apply

When you write something in `apps/` that:

1. could plausibly be reused by a sibling app,
2. and is non-trivial (non-glue, non-app-specific config),
3. and is currently the *first* implementation of that shape,

leave a one-line **substrate-candidate flag** at the top of the
file or section, in the JSDoc / module header:

```js
/**
 * (header text…)
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app needs <feature>, extract to `@canopy/<name>`.
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 */
```

Then add a one-line entry to
[`./substrate-candidates.md`](./substrate-candidates.md) so the
inventory stays scannable in one place.

### What is NOT a substrate candidate

- App-specific glue (UI strings, screen wiring, brand-specific UX).
- One-off scripts.
- Tiny helpers (a 3-line utility function — leave it inline).
- Anything that already has a substrate it should compose into;
  flag those as "extend X" instead, in the substrate's own README
  open-questions section.

### Reviewer's job

Code review checks for substrate-candidate flags in any change that
adds non-trivial app-local code.  Missing flags on plausible
candidates are review-blockable; spurious flags get downgraded to
"keep inline" with a one-line reason.

### When to actually extract

Still rule-of-two: when a *second* app reaches for the candidate.
Flagging early doesn't change extraction timing — it just makes
sure the candidate isn't forgotten in the meantime.

---

## What this policy doesn't cover

These are out-of-scope for `policies.md` but flagged so they're
not lost:

- **License** — TBD, project-level.
- **Code style** — see `Project Files/CLAUDE.md` (preserved
  unchanged).
- **Testing requirements per substrate** — folded into each layer
  sketch's "Public API" section.
- **CI / release automation** — TBD, infrastructure.
- **Brand-name change** — the `@canopy` namespace is a
  placeholder; rename happens before any public release.

---

## See also

- [`README.md`](./README.md) — methodology summary.
- [`architecture.md`](./architecture.md) — the layered model.
- Each substrate sketch's "Public API" + "Open questions" sections.
