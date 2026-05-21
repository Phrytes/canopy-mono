# H4 — design questions for review

Companion to [`./track-H-app-tasks.md`](./track-H-app-tasks.md).
This doc is a single-pass worksheet: read each question, write your
answer in the **Your answer:** block.  When all are answered I'll
fold the locks back into the main plan doc.

Same style as
[`./track-H-app-household-questions.md`](./track-H-app-household-questions.md)
— if the format is unfamiliar, look at the H2 worksheet first.

Each Q-H4 question has a **drafted answer** in the main plan doc;
this companion is where I lay out the alternatives + rationale, and
you confirm or revise.  Tell me if any abbreviations are unclear.

---

## Group 0 — Naming + scope sanity check

### Q-H4.0 — App name

**The choice:** the placeholder names from the main plan are **Klus**
(Dutch for "task / chore", evokes household maintenance), **Beurt**
("turn / one's go"), **Spar** (tongue-in-cheek "shared"), **Ledger**
(plain English).

**Constraints:**
- Should be unambiguous in mixed Dutch / English contexts (the user
  base is Dutch-first).
- Should not collide with H2's name (which is also TBD — currently
  Hearth / Stoel / Bord / Telex).
- Short enough to fit in URL slugs (`apps/klus-v0/`, `@canopy-app/klus-v0`).

**My lean:** **Klus** — it's the most evocative.  "Klus" implies
hands-on maintenance work, fits the "household + neighborhood" use
cases, and is a recognisable Dutch word that doesn't sound silly in
English.

**Your answer:**
> [Pick one or write-in:]
>   ( ) Klus
>   ( ) Beurt
>   ( ) Spar
>   ( ) Ledger
>   ( ) Other: ____________

---

## Group A — Pod shape + ledger

### Q-H4.1 — Where does the task ledger live?

**The choice:** how the task list is physically stored across
members.  Three options surfaced in the L2 design notes
(`projects/04-tasks-app/README.md` open question 1):

- **(a) Shared Solid pod.**  All members read/write the same pod with
  the same group key.  Works well for small high-trust groups
  (households).  Simple to reason about.  Trade-off: every read is a
  network hop to the pod; every claim race resolves at the pod's
  storage layer.
- **(b) CRDT replicated across all participating agents.**  Each
  member's agent holds a local replica; changes propagate via
  pubsub.  Robust under intermittent connections.  Costs: every agent
  carries the full state; merging logic gets complex when role
  permissions are entangled with merge.
- **(c) "Project-leader" agent owns canonical state; others sync.**
  Clear hierarchy, common in business / project-management contexts.
  Single point of failure if the leader is offline.

**The pass-2 refinement** in the L2 notes was cleaner than picking
one wholesale: **a per-field split within one ledger model.**  Some
fields go in a shared group-owned pod; some project from member
pods; the merge contract for projected fields is chosen per field.

**My lean (and the drafted answer in the main plan):**

- **V0: shared pod with per-field merge contracts.**  The shared pod
  holds open tasks + assignee + completion.  Member pods hold each
  member's `skills.json` + `posture.json` (read-only to others).
  Merge contracts:
  - LWW for task body fields (title, notes, dependencies, etc.).
  - **Compare-and-swap for `assignee`** — distinguishes claim races.
  - Append-only for audit log.
- **V1+:** generalise — CRDT model for medium-size intermittent
  groups; leader-agent for businesses.  V0 doesn't need to commit to
  these now, but the schema should be portable.

**Why I'm leaning this way:** household-scale (4–6 members, all on
home WiFi) doesn't justify CRDT's complexity, and there's no clear
"leader" in a household so (c) doesn't fit.  Per-field merge
contracts give us claim-race resolution without a distributed lock,
which is what makes (a) work for V0.

**Your answer:**
> [Pick one or comment:]
>   ( ) (V0) shared pod with per-field merge contracts (my lean)
>   ( ) (V0) shared pod, single LWW merge — simpler, accept that
>           claim races may double-assign briefly
>   ( ) (V0) CRDT from day 1
>   ( ) (V0) leader-agent from day 1
>   ( ) other / comment:

---

### Q-H4.6 — Privacy + role-based visibility

**The choice:** how tasks become visible (or invisible) to a
particular member, beyond plain "household member yes/no".

Picture: a household has 4 adults + 2 teenagers.  "Pay the
mortgage" should be visible to adults but not to teenagers.  "Take
out the trash" should be visible to everyone.  How does the schema
express this?

**Options:**

- (a) **Per-task `visibility` field** with three values:
  - `household` — visible to all members (default).
  - `role:<role-id>` — visible only to members with that role.
  - `private` — visible only to `addedBy` and `assignee`.
  
  Filtering happens on read by the policy engine.
  
- (b) **Per-task ACL list** — each task carries an explicit list of
  webids who can see it.  Maximum flexibility, but every task
  requires manual ACL setup and the merge story is harder.
- (c) **No filtering in V0.**  Every task is visible to every
  household member.  Privacy is a V1+ concern.  Simpler.

**My lean (drafted as Q-H4.6):** (a) — `visibility` field.  Three
values is enough for household-scale.  ACL lists (b) are V1+ when a
real use case demands per-task fine-grained permissions.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) per-task `visibility` field with `household | role:<id> | private`
>   ( ) (b) per-task ACL list (more flexible, more setup)
>   ( ) (c) no filtering in V0; everyone sees everything
>   ( ) other / comment:

---

## Group B — Roles

### Q-H4.7 — Role model

**The choice:** one of the deeper design questions the L2 notes
flagged (open question 7).  Two extremes:

- **(a) Minimal standard set.**  V0 ships exactly five roles:
  `admin`, `coordinator`, `member`, `observer`, `external-volunteer`.
  Each has a fixed permission table baked into the policy engine.
  Apps that want more roles wait for V1.
- **(b) Fully app-defined.**  V0 ships zero roles; every app
  declares its own role table.  Maximum flexibility; harder to
  reason about cross-app patterns; SDK can't ship sensible
  defaults.
- **(c) Hybrid: standard set + per-app extension.**  V0 ships the
  five standard roles AND a mechanism to add app-defined roles via
  pod config.  V0 = config-only (no UI for managing custom roles);
  V1 = UI.

**Why this matters:** Track D's role-aware groups need a
**permission table** to be useful.  Without one, the policy engine
has nothing to check against.  H4 is the forcing function for
landing this in the SDK.

**My lean (drafted as Q-H4.7):** (c) — standard set + per-app
extension via `customRoles` in `/tasks/config.json`.  The five
standard roles cover household + small-group cases out of the box;
the extension mechanism keeps the door open for businesses and
neighborhood-mixed-orgs without forcing V0 to design their schemas
now.

**Concrete shape of the standard role table:**

| Role | Add task | Claim | Complete (own) | Reassign | Cancel | Manage roles | See private |
|---|---|---|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `coordinator` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| `member` | ✓ | ✓ | ✓ | ✗ | own only | ✗ | own only |
| `observer` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `external-volunteer` | ✗ | tagged only | ✓ (own) | ✗ | ✗ | ✗ | ✗ |

This table is the thing that lands in `packages/core/src/permissions/`
as the default permission table.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) minimal standard set only; no per-app extension in V0
>   ( ) (b) fully app-defined; SDK ships zero default roles
>   ( ) (c) standard set + per-app extension via pod config (my lean)
>   ( ) the table above is fine / not fine; comment: ____________

---

### Q-H4-roles-secondary — App-defined roles in V0?

(Sub-question of Q-H4.7, but worth treating separately.)

If the answer to Q-H4.7 is (c), the next question is **how custom
roles are configured in V0**.

- (i) **Edit `/tasks/config.json` by hand.**  Custom-role config
  lives in the pod as a JSON object; you edit the file (via Folio,
  which can already write to a Solid pod) to add a custom role.
  V0 ships nothing else.
- (ii) **CLI command** to add/edit custom roles (`tasks-cli role
  add kitchen-crew --can-claim --can-complete`).  Slightly nicer
  UX; still no UI.
- (iii) **Web UI.**  Full-screen dialog "Manage custom roles".  V1
  territory.

**My lean:** (i) for V0.  The CLI (ii) is nice-to-have but adds
surface area.  (iii) is V1.

**Your answer:**
> ( ) (i) edit pod config by hand
> ( ) (ii) CLI command
> ( ) (iii) web UI in V0
> ( ) skip the question — let's defer (don't ship custom roles in V0)
> Comment:

---

## Group C — Claim + dispatch semantics

### Q-H4.2 — Claim semantics: distributed lock or optimistic?

**The flow:** Anne opens the tasks app and taps "I'll take it" on
"Vacuum the living room".  Simultaneously, the author taps "I'll take
it" on the same task from his app.  Two members tried to claim the
same task at almost the same instant.  Which one wins, and how does
the loser find out?

**Options:**

- (a) **Distributed lock via the relay.**  Before writing
  `assignee`, the agent acquires a lock on the task id from a
  shared coordination service.  Whoever gets the lock writes; the
  other gets denied.  Works well online; brittle on intermittent
  connections (lock holder vanishes → who breaks the lease?).
- (b) **Optimistic with compare-and-swap on `assignee`.**  No lock.
  Both agents write `assignee = me` only-if-currently-null.  The
  pod's compare-and-swap returns success to one and "field has been
  updated since you read it" to the other.  Loser re-reads the
  task, sees the author got it, tells Anne "the author beat you to it".
  Simpler.  Friendlier on intermittent connections.
- (c) **Optimistic without compare-and-swap.**  Both writes succeed;
  whoever's pod-write happens last "wins".  Inconsistency is
  resolved by an eventual reconciliation pass.  Worst UX —
  temporarily both members think they own the task.

**My lean (drafted as Q-H4.2):** (b) — optimistic + compare-and-swap.
Lock-free, simpler, and the merge contract handles the race
naturally.  This is one of the per-field merge contracts in Q-H4.1.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) distributed lock via relay
>   ( ) (b) optimistic with compare-and-swap (my lean)
>   ( ) (c) optimistic without (worst UX)
>   ( ) comment:

---

### Q-H4.3 — Push semantics: share with H5?

**Background:** when a task is added with `requiredSkills:
["paint"]`, every member-agent in the household receives a
notification (so the painter can see "there's a new paint job for
me").  Same primitive shows up in H5 (Neighborhood) where the
broadcast is "find someone who can do X" across a much larger
group.

**The choice:** is this one primitive (Track A's pubsub-of-skills,
shared by H4 + H5), or two separate ones?

- (a) **One primitive, shared.**  Track A ships
  `pubsub-of-skills`.  H4 and H5 both consume it.  Q-A.skill-pubsub
  flagged in the readiness analysis.
- (b) **Two separate primitives.**  H4 ships its own narrower
  "household-skill-broadcast" primitive; H5 ships its own broader
  "neighborhood-skill-broadcast" primitive.  More implementation
  surface.

**My lean (drafted as Q-H4.3):** (a) — one primitive, shared.  The
underlying mechanism (pod-change event + skill-set intersection +
posture check) is identical at any scale.

**Risk to flag:** if the household-scale and neighborhood-scale use
cases turn out to need different transport (e.g. relay vs. direct
peer-to-peer), one primitive may end up parameterised over
transport.  That's acceptable; same shape, different config.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) one shared primitive in Track A (my lean)
>   ( ) (b) two separate primitives
>   ( ) comment:

---

### Q-H4.4 — Human vs device agents: same identity model?

**Background:** Anne's 3D printer has its own agent (running on the
printer's local controller).  When a task `Print bracket` is added
with `requiredSkills: ["3d-print"]`, the printer's agent should be
able to claim and complete the task — same as a human.

**The choice:** is the device-agent's identity / claim mechanism
the same primitive as a human's, or different?

- (a) **Same primitive.**  Device-agent has its own webid + keypair
  (a "thing" identity, separate from any human).  Same skill +
  posture flag as a human.  When `posture[skill] = always`, the
  device auto-claims.  When `posture[skill] = negotiable`, it...
  prompts a human?  (Devices don't have UIs to prompt, so
  `negotiable` doesn't really apply — the device either auto-claims
  or doesn't.)
- (b) **Separate primitive.**  Devices use a different claim flow
  (e.g. "device subscriptions" — devices subscribe to skill-tags
  and get notified, but don't enter the same claim race as humans).

**My lean (drafted as Q-H4.4):** (a) — same primitive.  Posture
becomes binary for devices (`always | never`); humans get the
third value `negotiable` which prompts.  Same code path otherwise.

**Concrete: device-agent posture file:**

```jsonc
// /private/posture.json on the printer's pod
{
  "3d-print":   "always",      // auto-claim
  "telephone":  "never"        // never claim (devices can't make calls)
}
```

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) same primitive; posture is `always | never` for devices,
>           `always | negotiable | never` for humans (my lean)
>   ( ) (b) separate primitive (device subscriptions)
>   ( ) comment:

---

## Group D — Lifecycle

### Q-H4.5 — Task lifecycle depth

**The choice:** how rich the task state machine is in V0.

- (a) **V0 minimal.**  States: `open` / `claimed` / `complete` /
  `cancelled`.  Transitions: open→claimed (claim), claimed→complete
  (complete), open→cancelled (cancel by adder or coordinator),
  claimed→open (release by assignee or coordinator-reassign).  Done.
- (b) **V0 fuller.**  Add: `failed` (assignee couldn't do it),
  `partial` (multi-part task, some sub-tasks done), `paused`
  (assignee blocked, will resume).  More state machine, more UX
  affordances.
- (c) **V0 full.**  All of (b) plus retry-with-different-assignee,
  fork-into-subtasks-on-claim, etc.  Approaches H4 v1 territory.

**My lean (drafted as Q-H4.5):**

- **V0:** (a) minimal.  4 states + 4 transitions is enough to
  validate the role + claim + dispatch primitives.  Adding more
  states risks over-fitting before we've seen real usage.
- **V1+:** (b) — `failed`, `partial`, `paused` come in when real
  households tell us they need them.

**Reassign explicitly:** in V0 (a), reassign is **coordinator-only**
(role-gated).  An assignee who can't do their task `release`s it
(claimed→open); a coordinator can `reassign` directly
(claimed→claimed-by-someone-else).

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) V0 minimal — 4 states (my lean)
>   ( ) (b) V0 fuller — add `failed`, `partial`, `paused`
>   ( ) (c) V0 full
>   ( ) comment:

---

### Q-H4.8 — DAG cycle detection

**Background:** tasks have a `dependencies` field (`["T1", "T2"]`).
A user could add task `T3` with `dependencies: ["T1"]` while `T1`
already depends on `T3` — that's a cycle.  The DAG isn't a DAG
anymore, and the dependency-resolver loops forever (or, worse,
some tasks become un-completable because they wait on themselves).

**The choice:** when to detect cycles.

- (a) **At write time.**  Before writing the new dependency, the
  agent walks the existing graph and rejects the write if a cycle
  would form.  Friendly error: "Adding this dependency would
  create a cycle: T3 → T1 → T3."  Cheap if the graph is small
  (households).  More expensive at neighborhood-scale (1000s of
  tasks).
- (b) **At read time.**  Tolerate cycles in storage; the
  dependency-resolver detects them on read and either drops the
  cyclic edges or refuses to compute `status` for affected tasks.
  Simpler write path; nastier UX (the user adds a dependency, sees
  no error, then later notices the task is stuck in `waiting`).
- (c) **Don't detect.**  Trust the user not to create cycles.
  Unsafe; one bug or fat-finger and the ledger gets corrupt.

**My lean (drafted as Q-H4.8):** (a) — at write time.  The graph is
small at household-scale; cycle-walk is cheap; the write-time error
gives the user actionable feedback.  At neighborhood-scale this may
need optimisation, but that's V1+.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) at write time (my lean)
>   ( ) (b) at read time
>   ( ) (c) don't detect
>   ( ) comment:

---

### Q-H4.9 — Recurring tasks

**The choice:** does V0 support tasks that automatically re-create
themselves on a schedule (weekly chores, monthly bills)?

- (a) **Out of scope for V0.**  Recurring tasks are V1+.  V0 = one-shot only.  A household that wants weekly trash duty manually adds the task each week (or wires up a separate scheduler agent).
- (b) **In scope for V0.**  Add a `recurrence` field
  (`{ pattern: "weekly", weekday: "monday", time: "08:00" }`).  The
  scheduler agent creates a new task at each recurrence boundary;
  completing one closes only that instance, not the recurrence.
- (c) **Half-in-scope.**  V0 supports a `recurrence` field
  declaratively but doesn't ship the scheduler — the household sets
  up a cron / calendar agent separately.  The schema reserves the
  field; the runtime ignores it until V1.

**My lean (drafted as Q-H4.9):** (a) — out of scope for V0.
Recurring tasks add a scheduler-agent dependency (something has to
fire the recurrence) and a state-machine extension (the recurrence
has its own lifecycle separate from each instance).  V0's job is to
validate role + claim + dispatch on one-shot tasks; recurring is a
clean add-on once V0 ships.

**Risk to flag:** if the user community immediately asks for
recurring tasks (likely — chores are the canonical use case),
V0-without-recurring will feel incomplete.  Mitigation: clearly
document V0's scope; ship recurring as the first V1 feature.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) out of scope for V0 (my lean)
>   ( ) (b) in scope; ship the scheduler too
>   ( ) (c) reserve the field, don't run it yet
>   ( ) comment:

---

## Group E — Implementation-level

### Q-H4.10 — Audit-log retention

**Background:** every claim / complete / reassign / cancel is
written to `/tasks/audit/yyyy-mm.jsonl` so the household can see
"who did what when".  Same primitive H2 uses for LLM-call audit
(currently 30 days rolling per Q-H2-audit, but unconfirmed).

**The choice:** how long to keep the audit log.

- (a) **Forever.**  Storage is cheap; encrypted; small size (one
  line per action).  Useful for long-term trust.
- (b) **N days rolling** — purged on a schedule.  E.g. 1 year.
- (c) **Forever, with monthly archiving.**  Audit log lives at
  `/tasks/audit/yyyy-mm.jsonl`; old months stay there but don't
  clutter the live view.  Same pattern H2 uses for archived items.

**My lean:** (c) — same pattern as H2's task archive.  Monthly
files, never auto-purged.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) forever, no archiving
>   ( ) (b) N days rolling (specify N: ____)
>   ( ) (c) forever, monthly archiving (my lean)
>   ( ) comment:

---

### Q-H4.11 — Device-agent onboarding

**Background:** Anne wants to add her 3D printer's agent to the
household.  How does she do it?

The flow has three parts:

1. The printer's agent comes up with its own keypair.
2. Anne (or the printer's UI) presents the printer's webid to the
   household, asking for membership.
3. A household admin approves.  The printer is now a member.

**The choice:** what's the V0 UX surface for parts 2 + 3?

- (a) **CLI flow.**  The printer's agent prints a one-time pairing
  code at startup (e.g. on its status display or in its log).  Anne
  goes to the household tasks app, runs `tasks-cli member add
  <pairing-code>`, and approves.  Done.  Minimal UI.
- (b) **QR code on the device.**  The printer displays a QR code on
  its status page; Anne scans it from the tasks app on her phone;
  the app handles the pairing.  Nicer UX; needs a QR decoder in
  the mobile app.
- (c) **Web UI.**  Full-screen dialog "Add device member".  Type in
  the device's webid, send a join request, the device (or its
  operator) accepts.  Most discoverable; most surface to build.

**My lean:** (a) for V0; (b) for V1.

**Risk to flag:** if device-agent onboarding is the first thing a
household tries, (a) feels primitive.  But (a) is universally
applicable (works for headless devices), and (b) can be added later
without changing the underlying primitive.

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) CLI flow with pairing code (my lean)
>   ( ) (b) QR code + mobile scan
>   ( ) (c) web UI dialog
>   ( ) defer device-agent support to V1; humans only in V0
>   ( ) comment:

---

## Group F — Sanity check

### Q-H4.12 — Do we really need this app?

(Following the pattern of H2's "do we really need an LLM" closer.)

The H4 use case is **multi-member task coordination with role-aware
governance and skill-based dispatch.**  That's a lot of machinery
for a household that could plausibly survive on:

- **A shared shopping list app** (e.g. Bring!) for groceries.
- **A shared calendar** for schedule items.
- **A group chat** for "who's doing what tonight?".
- **H2 (Household)** for the chat-driven extraction flow.

**The trade-off:**

- **(a) Build H4 anyway.**  The use case is real
  (cross-household, role-based maintenance + multi-tenant
  generalization to neighborhoods + businesses).  V0 = single
  household but the architecture pays off later.
- **(b) Defer H4 indefinitely.**  Solve the household case with H2
  + a shared calendar.  Revisit if/when a neighborhood-scale or
  business-scale user shows up.
- **(c) Reframe H4 as a thin extension to H2.**  Add `assignee`,
  `dependencies`, `requiredSkills` to H2's open-item schema; ship
  the role-policy gate as an H2 extension.  Save the multi-tenant
  + multi-member-agent generalization for V1+.

**My lean:** (a) — build H4 even though there's overlap with H2.
The reason: H4 is the **forcing function** for SDK primitives that
H5, H8, and any future multi-member app will need (role-aware
groups + permission table, pubsub-of-skills, shared-mutable-state
primitive).  Without H4 driving them, those primitives stay
unbuilt or under-specified.  H2 alone wouldn't surface them at the
right level of detail.

**But (c) is genuinely tempting** if the goal is "ship household
features fast" rather than "build the SDK substrate."  It saves
~1-2 weeks of work and the household audience may not notice the
difference between "tasks app" and "household app with tasks
mode".

**Your answer:**
> [Pick one or comment:]
>   ( ) (a) build H4 — drives SDK primitives forward (my lean)
>   ( ) (b) defer H4 indefinitely
>   ( ) (c) reframe as an H2 extension
>   ( ) comment:

---

## Once you've answered

When all questions above have a non-empty answer, ping me and I'll:

1. Fold the locks back into [`./track-H-app-tasks.md`](./track-H-app-tasks.md) (replacing the "drafted but not yet locked" Q-H4.x table with a "locked 2026-MM-DD" version).
2. Update the status header in the main plan from "Design — drafting" to "Design with answers locked, implementation plan deferred".
3. Update the entry in [`./track-H-apps.md`](./track-H-apps.md) §H4 from "design drafted; Q-H4.x not yet locked" to reflect the locks.
4. Note in the SDK side: Q-A.skill-pubsub (Track A) and the role-permission table (Track D extension) are confirmed as the L0 SDK additions H4 needs from the SDK side.

After locks: the next document to write is `track-H-app-tasks-impl.md` — the week-by-week implementation plan (deferred until B5 lands).
