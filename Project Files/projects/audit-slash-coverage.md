# AUDIT — slash-command coverage across the monorepo

**Date:** 2026-05-20
**Branch:** `feat/app-manifest`
**Status:** **deferred decision-doc** — *not* a decision yet.  Records
today's inventory, frames the options, and surfaces what's still owed
per app.  Becomes the canonical decision-doc the moment ≥2 apps adopt
slash and we have a real collision to resolve.

> Owner-locked discipline: this audit presents options + trade-offs,
> not picks.  The "Recommendation" section below is *my* suggested
> default; the owner is the only one who can ratify it.

---

## 1. Purpose & status

### Why this doc exists

The memory note `project-slash-command-coverage` (2026-05-20) captured
that slash-command coverage across the monorepo is uneven: household
has a full set, tasks-v0 explicitly opted into LLM-only ("chat-only"),
and stoop / folio / the three mobile apps have no chat surface today.
The note observes:

> The manifest-host's `compose().commandMenu` + `collisions[]` only
> work when apps actually declare slash commands.  Today the host's
> collision-detection is exercising "household has /add, tasks
> doesn't" which is trivial — the interesting case is "≥2 apps both
> have /add" and we have zero scenarios producing it.

This audit is the next step the memo recommended: a short cross-cutting
write-up that names the options and the still-owed per-app calls, so
when a second app adopts slash the policy choice can be made
deliberately rather than ad-hoc.

### Status in the SP-* slice plan

The memo proposes either an SP-12 dedicated slice or folding into
SP-7 (folio manifest) / SP-8 (stoop manifest).  No slice is open yet;
this doc is the artifact those slices would build on.

### Relationship to the manifest-host README

`packages/manifest-host/README.md` § *Potential conflicts the host
leaves to the consumer* lists the same four options at a high level.
This audit deepens that list with per-policy pros/cons and the
how-it-works mechanics, *and* adds the per-app inventory + still-owed
questions the README doesn't carry.

---

## 2. Today's inventory

Per-app slash declarations as of 2026-05-20.  "Slash declared?" means
**a `surfaces.slash` entry on at least one op in the app's manifest**;
ad-hoc bot parsers outside the manifest are also recorded.

| App / package        | Manifest file?           | Slash declared? | Count | Source-of-truth location                              | Notes                                                  |
| -------------------- | ------------------------ | --------------- | ----- | ----------------------------------------------------- | ------------------------------------------------------ |
| **household**        | `apps/household/manifest.js` | Yes         | 9     | lines 59 / 78 / 96 / 116 / 134 / 153 / 171 / 186 / 222 | Full set: `/add /list /done /remove /help /task /tasks /claim /register`.  SP-1 byte-equiv with `regexCommands.js`. |
| **tasks-v0**         | `apps/tasks-v0/manifest.js`  | **No**      | 0     | header comment lines 20–24 says it explicitly         | "`surfaces.slash` is intentionally absent — tasks-v0 has no current slash consumer (it is a browser web UI)."  SP-3 V0 LLM-only. |
| **tasks-mobile**     | none yet                  | n/a         | —     | —                                                     | No manifest yet; consumes tasks-v0's manifest in SP-6.  No slash parser in `apps/tasks-mobile/src/`. |
| **folio**            | none yet                  | n/a         | —     | —                                                     | No manifest yet (SP-7).  No slash parser; no chat surface code in `apps/folio/src/`. |
| **folio-mobile**     | none yet                  | n/a         | —     | —                                                     | No manifest yet.  Grepped src/: only "slash" references are URL-trim helpers (`podRootHelpers.js`, `notesList.js`, `SignInScreen.js`).  No chat. |
| **stoop**            | none yet                  | n/a         | —     | —                                                     | No manifest yet (SP-8).  `apps/stoop/src/chat/wireChat.js` is a 44-line shim around `@canopy/chat-p2p`; **zero slash parsing**.  Chat UI at `apps/stoop/web/chat.html` (203 lines) — visual chat client, no slash grammar. |
| **stoop-mobile**     | none yet                  | n/a         | —     | —                                                     | No manifest yet.  No slash parser.                     |
| **circles** subst.   | substrate (not an app)    | n/a         | —     | —                                                     | But `/circle add member` etc. is the canonical example of "would fit naturally" if circles ever surfaced one. |

### Search methodology (how the inventory was gathered)

For each app:

- Grepped `apps/<app>/manifest.js` for `command:\s*['"]/[a-zA-Z]+` to
  count declared `surfaces.slash.command` strings.
- Grepped `apps/<app>/src/` (excluding `node_modules/`) for
  `slash|parseCommand|regexCommands` and inspected hits to filter out
  URL-helper noise.
- Confirmed missing manifests with
  `find apps/<app> -maxdepth 3 -name manifest.js -not -path '*/node_modules/*'`.

### Bottom line

**One app declares slash (household, 9 commands).**  Six apps do not.
**Zero collisions exist today.**  Tasks-v0 is the only app that has
explicitly *opted out* of slash; the rest haven't been asked.

---

## 3. The collision problem

### Today (zero collisions)

`packages/manifest-host/src/ManifestHost.js` § `composeMounts()`:

```js
const commandIndex = new Map();    // command → [appIds]
for (const [appId, m] of mounts) {
  for (const entry of rendered.commandMenu) {
    commandMenu.push({ command: entry.command, description: entry.description, appId });
    const arr = commandIndex.get(entry.command) ?? [];
    arr.push(appId);
    commandIndex.set(entry.command, arr);
  }
}
const collisions = [];
for (const [command, appIds] of commandIndex) {
  if (appIds.length > 1) collisions.push({ command, appIds });
}
```

`compose()` returns `collisions: []` because only household ever maps a
command name to a single appId.  The `commandMenu` array contains
household's 9 entries plus possibly other apps' 0 entries; the merged
view is trivially conflict-free.

### The moment a second app adopts `/add`

Suppose folio's eventual manifest declares `/add` (perfectly natural —
"add a note").  Now mounting both household + folio yields:

```js
collisions: [{ command: '/add', appIds: ['household', 'folio'] }]
```

The consumer (chat agent, UI shell, TG bot dispatcher) receives this
data and **has to pick a winner per invocation**.  No host-side policy
is applied.  The consumer is forced to choose:

- ignore `collisions[]` and silently let mount-insertion-order win
  (what the dispatcher does today by default if it just iterates
  `commandMenu`);
- or implement an explicit policy.

Without an agreed cross-host policy, two different chat agents
(Telegram vs in-app chat vs web command-palette) may resolve `/add`
differently — same input, different result.  That's the user-visible
fragmentation the memo warns about.

### Sub-shape: per-item button collisions

A *different but related* shape, called out in the README's conflicts
section: when ≥2 apps both surface `inlineKeyboardFor(item)` buttons
for the same item type (e.g. both `tasks` and `household` show a Done
button on `task` items), V0 emits in mount-insertion order.  This
audit focuses on slash; the button-ordering decision is its own and is
deferred there too.

---

## 4. Policy options

Four named options, mirroring the manifest-host README's list.  Each
is expanded with mechanics, pros, cons, and a "when it fits" note.

### Option A — `first-mount-wins`

**Mechanics.**  Consumer iterates `commandMenu` and uses the first
`{command, appId, …}` whose `command === input.command`.  Subsequent
entries with the same command are silently ignored.  Equivalent to
"mount order is the precedence list."

**Pros.**

- Trivial implementation — no consumer logic beyond a `Map` lookup.
- Zero user-visible UI surface (no prefix, no disambiguation prompt).
- Predictable in a host that owns its mount order (e.g. a TG bot that
  always mounts household before tasks).

**Cons.**

- Mount order becomes semantically loaded.  Add a new app and reorder
  the call site → user-visible behaviour change.
- "Silent loss" is hostile in dev mode — the second app's `/add` is
  unreachable with no error message.
- Doesn't address per-circle preferences.  If user A wants
  household's `/add` and user B wants folio's `/add`, both stuck with
  whatever the host decided.

**When it fits.**  Single-tenant chat agents where the operator
controls mount order and the second app's slash is genuinely
secondary.  Probably not the project default.

### Option B — `prefix-all-on-collision`

**Mechanics.**  When `compose().collisions[]` is non-empty for command
`X`, consumer rewrites the menu: `/X` becomes `/<appId>/X` for *every*
app that registered it.  Apps with non-colliding commands keep their
bare names (`/help` stays `/help` if only household has it).

**Pros.**

- No silent loss — every command remains reachable.
- Self-documenting in the UI — `/folio/add` vs `/household/add` makes
  the namespacing visible.
- Mount order doesn't matter.
- Works the same across hosts (TG, web, etc.).

**Cons.**

- Cosmetic noise — `/add` is much nicer than `/household/add`.
- Asymmetric over time: as soon as a second app collides, *both* of
  yesterday's bare names get rewritten.  Existing muscle memory
  breaks.
- Doesn't help users discover "which app *did* I mean?" — pushes that
  back on the user.

**When it fits.**  Power-user chat surfaces (e.g. dev console, ops
agent) where explicitness beats brevity.  Also the safest default
when the policy must work uniformly across many hosts without
host-specific tuning.

### Option C — `LLM-disambiguate`

**Mechanics.**  Consumer detects collisions at parse time and, instead
of dispatching directly, hands the message to the LLM along with both
candidate ops.  LLM picks based on intent + context.  Bare `/add foo`
becomes "user typed `/add foo`; this matches household.addItem
(grocery item) and folio.addNote (markdown note); pick the best fit."

**Pros.**

- Best UX when the user's intent is clear from context — no
  cognitive overhead, no prefix typing.
- Naturally handles "user typed in the wrong circle" cases.
- Composes with the LLM's existing tool-use loop — no new dispatch
  path.

**Cons.**

- Loses the slash-channel's main virtue: deterministic, latency-free,
  free-of-LLM-cost dispatch.  Every collision now pays an LLM round-
  trip.
- Probabilistic — same input can route differently between sessions.
- Needs an LLM in the loop, which not every host has (TG bot without
  LLM, web command-palette).
- LLM picks can mislead in ambiguous cases (`/add milk` — household
  shopping item or folio note?).

**When it fits.**  LLM-mediated chat agents where the slash surface is
secondary anyway (the LLM-only flow is the primary one, slash is a
shortcut).  Bad fit for pure-slash hosts.

### Option D — `per-host config`

**Mechanics.**  Each host has a config file / option that explicitly
maps colliding commands to winners: `{ '/add': 'household' }`.  The
host's `compose()` consumer reads this and resolves accordingly;
unconfigured collisions either fall back to one of A–C or hard-error
at compose time.

**Pros.**

- Owner-explicit — no surprise behaviour.  Audit-friendly.
- Different hosts can pick differently (a household-focussed TG bot
  routes `/add` to household; a notes-focussed one routes to folio).
- Composes with any fallback strategy for unmapped collisions.

**Cons.**

- Config drift — adding an app means updating every host's collision
  config.
- Hard-error mode is brittle in dev (mount a new manifest, host
  refuses to boot until config updated).
- Doesn't help the *user* who doesn't know which host has which
  config.

**When it fits.**  Production hosts where the operator wants
predictable, audit-logged routing.  Combines well with one of A–C as
the fallback for unmapped collisions.

---

## 5. Recommendation (mine, not owner's)

**Proposed default:** **Option B — `prefix-all-on-collision`**, with
Option D layered on top for hosts that want explicit overrides.

### Rationale

1. **No silent loss** is non-negotiable for a multi-app substrate.
   Option A loses commands silently; Option C requires an LLM in the
   loop the host may not have.
2. **Mount-order independence** matches the rest of the host's
   design.  `compose()` already emits everything namespaced by
   `appId.opId` for tool-calls; treating slash collisions the same
   way is consistent.
3. **Self-documenting failure mode**: when a user sees `/folio/add` in
   the menu next to `/household/add`, the explanation is right there.
   Compare to Option A where the user just sees one and wonders why
   the other isn't there.
4. **Composes with Option D** when a host wants explicit overrides —
   D's config table is the override, B is the fallback for unmapped
   collisions.  Belt + braces.

### What this would mean in practice

- Default behaviour: bare commands while unique, prefixed when ≥2
  apps register.  Visible in the menu the user sees.
- Hosts that want a smoother UX can layer Option D (operator-chosen
  winners) without changing the host code.
- LLM-mediated hosts can still take a *third* path: when they detect a
  collision, defer to the LLM (Option C as opt-in), with the prefixed
  form as the fallback if LLM access is offline.

### What this is not

- **Not** a claim that prefix-all is the best UX in all cases.
  Option C is arguably better for pure-chat hosts with a strong LLM.
- **Not** a one-policy-fits-all mandate.  The strongest reason to
  pick B as the *default* is that hosts that want something else can
  layer over it; the inverse (default to A or C and bolt on B) is
  harder because A loses information and C requires infrastructure.
- **Not** ratified.  The owner picks.

---

## 6. Per-app decisions still owed

For each app that doesn't declare slash today, the open question is:
**does this app want slash, and if so, what grammar?**  These are
*questions*, not proposals.

### tasks-v0 — already answered (no)

Tasks-v0's manifest header explicitly opts out: *"tasks-v0 has no
current slash consumer (it is a browser web UI). … LLM tool-calls; a
slash grammar can land later if a chat host adopts tasks."*  This is
SP-3 V0's explicit call.  Revisit only if a tasks-v0 chat surface
appears.

### tasks-mobile — open

- Tasks-mobile consumes tasks-v0's manifest (SP-6 contract).  If
  tasks-v0 stays slash-less, tasks-mobile naturally has no slash
  either.
- Open Q: does tasks-mobile ever surface a chat / command-palette
  UI?  If yes, it should sit on top of tasks-v0's manifest — at which
  point the tasks-v0 "no slash" call should be revisited.

### folio — open

- Folio is "personal markdown notes" — the natural slash verbs are
  `/add`, `/list`, `/done`, `/remove`, all of which collide with
  household.
- Open Q: does folio want a slash surface at all?  If yes, what's its
  vocabulary?  Sharing household's `/add` verb means the policy
  question above becomes live the moment SP-7 ships.
- Open Q: alternative — folio uses a folio-specific lexicon
  (`/note`, `/find`, `/archive`) that avoids the collision entirely.
  Lower convergence, less user fragmentation, but loses the natural
  fluency of `/add`.

### folio-mobile — open

- Same shape as tasks-mobile: consumes folio's eventual manifest.
- Open Q: chat surface or no?  Likely no in V0 (folio-mobile is a
  pure document viewer / editor today), but worth recording the call
  explicitly.

### stoop — open

- Stoop is "neighbourhood offers / posts" — natural slash verbs are
  more app-specific (`/offer`, `/seek`, `/respond`).  Collision risk
  with household is lower; with folio possibly zero.
- Open Q: does the stoop chat surface (web/chat.html) want slash, or
  is it pure free-text + LLM?  The current `wireChat.js` shim is
  free-text only.
- Open Q: stoop has its own grammar logic (the user mentioned
  approval keywords).  If slash lands, does it inherit that vocabulary
  or replace it?

### stoop-mobile — open

- Same as folio-mobile: consumes stoop's eventual manifest.  No chat
  surface in stoop-mobile today.

### Cross-cutting open questions

- **Shared vocabulary or per-app?**  The memo asks: "if multiple apps
  add slash, do they share a grammar vocabulary (e.g. all use `/add
  <text>`) or each go their own way?"  Shared maximises convergence
  but maximises collisions; per-app minimises collisions but
  fragments the UX.
- **Mobile parity.**  `feedback-platform-parity` is project-bar:
  web ≡ mobile for every app.  Slash needs to work on both surfaces.
  RN slash UI is non-trivial (no command-palette by default).  Even
  if web has slash, mobile may need a different surface (FAB +
  picker?  bottom-sheet?  custom keyboard?) that's functionally
  equivalent.  Out of scope for this audit; in scope for SP-6 / SP-7
  / SP-8.

---

## 7. Implementation pointer

Where the chosen policy would land in `@canopy/manifest-host`:

**File:** `packages/manifest-host/src/ManifestHost.js`
**Function:** `composeMounts(mounts)` (line ~114)
**Existing output:** the `collisions[]` array (line ~154–157) computed
from `commandIndex` (`Map<command, appIds[]>`).

A resolution policy would slot in **between** the existing collision
detection and the `commandMenu` return, OR as a post-processing pass
on the returned `commandMenu`.  The simplest shape is the latter:
keep `composeMounts()` policy-free (returns *raw* `commandMenu` +
`collisions`), and add an opt-in helper for consumers, e.g.:

```js
// new file: packages/manifest-host/src/resolveCollisions.js
export function resolveCollisions(composed, policy = 'prefix-all') {
  if (policy === 'prefix-all') {
    const colliding = new Set(composed.collisions.map(c => c.command));
    return {
      ...composed,
      commandMenu: composed.commandMenu.map(e =>
        colliding.has(e.command)
          ? { ...e, command: `/${e.appId}${e.command}` }
          : e),
    };
  }
  if (policy === 'first-mount-wins') {
    const seen = new Set();
    return {
      ...composed,
      commandMenu: composed.commandMenu.filter(e => {
        if (seen.has(e.command)) return false;
        seen.add(e.command);
        return e;
      }),
    };
  }
  // 'per-host': accept a Map<command, appId> override; fall through.
  // 'LLM-disambiguate': out of host's scope — consumer-side.
  return composed;
}
```

This keeps the host *policy-detection* layer (today) intact and adds
the *policy-resolution* layer as an opt-in helper.  Consumers that
want raw data (the test suite, the chat agent's audit log) keep
calling `compose()`; consumers that want a final-form menu call
`resolveCollisions(compose(), policy)`.

Note: the V0 layering — "host detects, consumer resolves" — is
explicit in the README ("**No collision resolution.** The host detects
collisions; picking a winner is a consumer decision").  Whether the
policy lives *in* the host package or in a separate
`@canopy/manifest-collision-policies` package is its own call; the
function signature above works either way.

---

## 8. References

- Memo: `~/.claude/projects/<…>/memory/project-slash-command-coverage.md`
  (2026-05-20, the "no project-wide plan yet" recording).
- Host README: `packages/manifest-host/README.md` § *Potential
  conflicts the host leaves to the consumer*.
- Host code: `packages/manifest-host/src/ManifestHost.js`
  § `composeMounts()`.
- Household manifest: `apps/household/manifest.js` (9 `surfaces.slash`
  declarations).
- Tasks-v0 manifest: `apps/tasks-v0/manifest.js` (header comment lines
  20–24 explicitly opts out).
- Platform parity bar: memory `feedback-platform-parity`.
- Manifest convergence proposal:
  `VOORSTEL-uniforme-representatie.md` (manifest = web/mobile/chat
  cure).
