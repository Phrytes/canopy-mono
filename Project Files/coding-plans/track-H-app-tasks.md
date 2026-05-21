# H4 — Tasks app (skill-based dispatch, multi-tenant)

| | |
|---|---|
| **Status** | Design — drafting.  Source material consolidated 2026-05-02; design questions Q-H4.1–Q-H4.9 surfaced but **not yet locked**.  Implementation plan deferred to a follow-up document. |
| **Started** | 2026-05-02 (drafted by combining `projects/04-tasks-app/README.md` + the H4 entry in `track-H-apps.md`). |
| **Owner** | unassigned |
| **App name** | TBD — placeholder names: **Klus** (Dutch for "task / chore", evokes household maintenance), **Beurt** ("turn / one's go"), **Spar** (a tongue-in-cheek nod to "shared"), **Ledger**.  Confirm before kickoff. |
| **Blocked on** | **B5 (in flight)** — the shared-mutable-state primitive in Track B.  Track A ✅, Track D (role-aware groups) ✅.  E2c (push integration) needed for full multi-member UX, deferred — H4 v0 ships without push and uses pull/poll instead. |

**Goal:** ship the per-app L2 work for the **shared-task-list with skill-based dispatch** use case described in `projects/04-tasks-app/README.md` — a task ledger with DAG dependencies and skill requirements, where tasks are pushed to all agents (human or device) that match the requested skill, and one of them claims it.  V0 targets a **single household**: small group, high trust, shared pod, simpler test surface than the multi-org variants.  V0 is the first @canopy app to exercise **role-aware groups** (Track D) and **merge contracts on shared mutable state** (Track B5) on real product code.

This is the **first multi-member @canopy app**.  Folio (H1) is single-user; Archive (H7) is read-only; Household (H2) is multi-member by way of an external chat platform.  H4 is the first where **multiple SDK-native agents share write access to a live, structured ledger** — and where role + permission decisions matter for every action.

**Refs (consolidated into this doc):**

- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md)
  — L2 design notes (the most detailed source).
- [`./track-H-apps.md`](./track-H-apps.md) §H4 — readiness analysis,
  tier placement, dependency map.
- [`../USE CASES.md`](../USE%20CASES.md) §4 — cross-cutting use-case
  summary (post pass-3 refresh).
- [`../Design-v3/topology.md`](../Design-v3/topology.md) §Hybrid pod
  patterns — H4 will exercise the *per-field split* variant from day 1.
- [`./track-H-app-household.md`](./track-H-app-household.md) — sibling
  app's design; schema alignment is intentional.
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — Folio's pod-client
  + sync-engine layering is reusable for H4's pod side.
- [`./track-H-app-archive.md`](./track-H-app-archive.md) — Archive's
  read-side query patterns (FTS5, capability-gated sharing) are
  reusable for H4's "show me open tasks" retrieval surface.
- `Design-v3/role-aware-groups.md` — **to-be-written** when Q-H4.7
  (role model) is locked.

---

## Why this is its own app and NOT a variant of H2

The H2 doc has a long section ("Why this is project #7 and NOT a
variant of H4 (Tasks)") arguing the inverse — copied here from the
opposite direction so the boundary is captured in both places:

- **H2 is freeform.**  Household chat is a stream of unstructured
  natural-language utterances, most of them noise, with structure
  *inferred* by the LLM from the message content.
- **H4 is structured.**  Tasks have explicit DAG dependencies, skill
  requirements, claim semantics, role-based permissions.  Input is
  user-driven via a tasks UI (web or mobile), not a chat channel.

The two end up with overlapping pod state ("a list of open items the
group cares about") but the **acquisition pattern is fundamentally
different**.  Trying to design one app that does both ends up doing
both badly.

That said: **H4's task schema is a strict superset of H2's open-item
schema** (see "Schema alignment with H2" below).  A household that
graduates from "items extracted from chat" to "tasks with DAG deps
and explicit assignees" can lift its open items into the H4 schema
without a migration — H4 just treats H2 fields like `source.tg` as
opaque metadata, and H2 ignores fields like `dependencies` and
`requiredSkills` it doesn't understand.

Keep the schemas aligned.  H4 is where tasks-app lives; H2 is where
chat-input lives; the shared schema is what lets a household start
chat-only and grow into structured-task management without a rewrite.

---

## The user's ambition (from `projects/04-tasks-app/README.md`)

Preserved verbatim — useful as the durable acceptance test:

> **In het kort:**
> Eigenlijk hetzelfde als de buurt-app, maar ipv een soort tinder
> (connectie, en daarna chat), zit er ook nog een afrondingsmoment in
> waarna dependent tasks worden getriggerd.

**English reading:** A shared task list among a group.  Tasks have
dependencies (a DAG) and skill requirements ("needs
someone-who-can-paint", "needs a 3D-printer-equipped machine").  When
a task's dependencies are met, the system pushes it to all agents
(human or device) that match the skill, and one of them claims it.
Multi-tenant: must work for households (4-6 people, high trust),
businesses (5-500, role-based), friend groups, neighborhood
maintenance (50-500 mixed companies + volunteers).

V0 targets only the first audience — a single household with 4-6
trusted members.  Multi-tenant generalization is V1+.

---

## What you see (v0 functional sketch)

Concrete UX target.  All three surfaces (web, mobile, agent-internal
trigger) drive the same agent skills.

**Adding a task** — a household member opens the tasks app on web or
mobile:

```
┌──────────────────────────────────────────────┐
│  + New task                                  │
│                                              │
│  Title:        [Repaint the hallway      ]   │
│  Type:         [repair         ▼]            │
│  Needs skill:  [paint, ladder-7ft     ▼+]    │
│  Depends on:   [— select existing tasks —]   │
│  Due:          [— optional —]                │
│  Notes:        [                         ]   │
│                                              │
│              [ Cancel ]   [ Add task ]       │
└──────────────────────────────────────────────┘
```

**Tasks app — open list, role-filtered:**

```
┌──────────────────────────────────────────────────────┐
│  Open tasks   (showing: all I can claim)             │
├──────────────────────────────────────────────────────┤
│  □ Buy paint               Anne  • shopping          │
│    ↳ ready                                           │
│                                                      │
│  □ Repaint the hallway     —     • repair · paint    │
│    ↳ waiting on: Buy paint                           │
│                                                      │
│  □ Vacuum the living room  —     • errand            │
│    ↳ ready  · skill: none                            │
│                  [ I'll take it ]    [ Defer 1 day ] │
└──────────────────────────────────────────────────────┘
```

**Claim flow** — Anne taps "I'll take it" on "Vacuum the living room":

```
[Anne]      taps "I'll take it" on T-3.
[Tasks UI]  ✓ assigned to Anne.  (others in the household see the
            task move from "open / unclaimed" to "open / Anne".)
[Anne]      completes the task, taps "Done".
[Tasks UI]  ✓ marked complete.
[Tasks UI]  triggers any tasks whose `dependencies` include T-3.
            (e.g. "Wipe the windowsill" was waiting; now visible.)
```

**Dependent-task trigger** — when "Buy paint" is marked complete by
the buyer, the agent automatically transitions "Repaint the hallway"
from `waiting` → `ready` and (in v1+) pushes a notification to anyone
with the `paint` skill.

**Device-agent claim** — a household member configures their 3D
printer's agent with `skill: 3d-print` and posture `always`.  When a
task `Print replacement bracket` is added with `needs skill:
3d-print`, the device claims it automatically and reports completion
when the print finishes.  V0 supports human and device agents on the
same primitive.

---

## Architecture

V0 ships as a single `apps/tasks-v0/` package with three surfaces:

```
                ┌──────────────┐    ┌──────────────┐
                │ Web client   │    │ Mobile (RN)  │
                │ (browser)    │    │ client       │
                └──────┬───────┘    └──────┬───────┘
                       │   ↑               │   ↑
                       │   │  (REST + SSE  │   │
                       │   │   from agent) │   │
                       ▼   │               ▼   │
                ┌──────────┴───────────────┴────────────┐
                │  Tasks agent (per-member)             │
                │  - skills: addTask, claimTask,        │
                │    completeTask, listTasks,           │
                │    cancelTask, reassignTask, …        │
                │  - role checks via Track D's          │
                │    GroupManager + PolicyEngine        │
                │  - dependency-DAG resolver            │
                │  - skill-match dispatcher             │
                └────────┬─────────────┬────────────────┘
                         │             │
                         │             │ pubsub-of-skills
                         │             │ (broadcast claim
                         ▼             ▼ requests to peers
                ┌─────────────┐  with matching skill)
                │ Hybrid pod  │
                │ (Solid)     │
                │ /tasks/     │  ← shared household pod
                │ /private/   │  ← per-member pods
                └─────────────┘
```

### Per-member agent, not per-household

Unlike H2 (one bot agent for the whole household), H4's runtime model
is **one agent per member**.  Each human's agent runs on their device
(or their private server); each device-agent (3D printer, network
camera, etc.) is its own agent on the device itself.  The household's
shared task ledger is what the agents collaborate on; there's no
"household coordinator" agent.

Why per-member:

- **Authorisation is per-member.**  Every claim, complete, cancel
  needs the actor's webid — so the agent that does it must be the
  member's agent, signing as their identity.
- **Devices are independent agents.**  A 3D printer's agent has its
  own keypair, its own posture flag, its own state about jobs in
  flight.  Device agents need their own runtime; piggybacking on a
  per-household agent process doesn't extend.
- **No central single-point-of-failure.**  If one member's agent is
  offline, the others continue to work; tasks they don't claim simply
  don't get assigned to them.

Inverse of H2's design rationale.  H2 has *one* bot because it's
bridging *one* external chat channel and the bot is a synthetic
member of the group.  H4 has *N* member-agents because each member
(or device) is a real participant making their own decisions.

### Components in a member's tasks-agent

The single Node process (or RN bundle for mobile) holds:

1. **Tasks-agent skills** — `addTask`, `listTasks`, `claimTask`,
   `completeTask`, `cancelTask`, `reassignTask`, `setTaskSkillNeeds`,
   `setTaskDependencies`, etc.  Plain functions registered with the
   agent's `SkillRegistry` (Track A's skill primitive).
2. **Dependency-DAG resolver** — given a `tasks/open/<id>.json`
   document, walks `dependencies` to determine `status: ready |
   waiting | blocked`.  Topological sort + cycle-detection.  Pure
   function, easy to test.
3. **Skill-match dispatcher** — given a task with
   `requiredSkills: [...]`, queries `Group.members` for member
   profiles with matching skills (Track A's `IdentityPodStore`),
   broadcasts a claim-request via the pubsub-of-skills primitive
   (Track A — Q-A.skill-pubsub).  Whichever agent claims first wins;
   others see the claim in the merge contract and back off.
4. **Role-policy gate** — every skill call goes through
   `PolicyEngine.check(action, actor, context)` (Track D).  E.g.
   `member` can claim and complete; `coordinator` can reassign;
   `external-volunteer` can claim only tasks tagged
   `external-friendly`; `observer` can list but cannot claim.
5. **Pod read/write** — `PodClient` (Track A) for direct CRUD on
   `/tasks/<...>`.  Subscribes to pod change events for live updates
   to the UI.
6. **Vault** — keys held: member's own keypair, household group key,
   per-task capability tokens (when a task references content on
   another pod).

### UI surfaces

V0 ships **web first**, **mobile-RN second**, **CLI/agent-only
third** (used for device agents and tests).  All three are clients
of the same agent — same skill API, same pod conventions.  Same
layering as Folio (web + mobile against the same agent core).

---

## Pod schema

### Hybrid pod from v0 (per-field split)

Per the `projects/04-tasks-app/README.md` "Pod shape" section's
pass-2 refinement, H4 ships **a per-field split within one group**
(not "one ledger model per group").  Some fields live in a shared
group-owned pod; some project from member pods; the merge contract
for projected fields is chosen per field.

```
─── per-member pod ─────────────────────────────────────────
  /private/                       (read-only to other members)
    skills.json                   # member's skill profile
                                  # (e.g. ["paint", "wood-glue", "drive"])
    posture.json                  # claim posture per skill
                                  # (e.g. paint: "always",
                                  #       drive: "negotiable")
    private-tasks.json            # personal tasks, not shared

─── shared household pod ───────────────────────────────────
  /tasks/
    config.json                   # household name, member webids,
                                  #   group key id, role mappings
    open/<ulid>.json              # OPEN — one file per task
    closed/yyyy-mm/<ulid>.json    # CLOSED — archived monthly
    by-skill/<skill>.jsonl        # cached index of open tasks
                                  #   needing <skill> (rebuilt on write)
    by-assignee/<webid>.jsonl     # cached index of open tasks
                                  #   assigned to <webid>
    audit/yyyy-mm.jsonl           # role-checked actions: who claimed
                                  #   what when, who reassigned, etc.
```

**Per-field merge contracts** (pass-2 refinement of Q-H4.1):

| Field | Where it lives | Merge contract |
|---|---|---|
| `id`, `type`, `title`, `notes`, `dependencies`, `requiredSkills`, `dueAt` | shared pod (`/tasks/open/<id>.json`) | LWW (last-writer-wins).  Edits are rare and small; conflicts are unlikely. |
| `assignee` | shared pod | **Compare-and-swap.**  A claim succeeds only if the field is currently `null`.  Distributed claim races resolve via the merge contract; first-to-write wins. |
| `status` | shared pod | Derived field — recomputed on read from `assignee`, `completedAt`, and `dependencies`.  Not stored. |
| `completedAt` | shared pod | LWW.  A task can only be completed once; second writer is rejected by the role-policy gate. |
| `skills` (per member) | member pod | Member-owned; read-only to others. |
| `posture` (per skill) | member pod | Member-owned; read-only to others. |
| `audit/...` | shared pod | Append-only.  No merge — each agent appends its own actions. |

Deciding "compare-and-swap" for `assignee` is what makes Q-H4.2
(claim semantics) lock to **optimistic with rollback**: the claim
*tries* to write `assignee = me` only-if-null, then re-reads to
confirm.  No distributed lock required.

### Task-document shape

```js
{
  id:               "01HX...",   // ULID
  type:             "shopping" | "errand" | "repair" | "schedule" | "fabricate" | string,
  title:            "Repaint the hallway",
  notes:            "Use the off-white from the basement",
  addedBy:          "https://id.inrupt.com/anne",
  addedAt:          1714000000000,
  assignee:         null | "https://id.inrupt.com/frits",
  claimedAt:        null | 1714003000000,
  completedAt:      null | 1714008000000,
  completedBy:      null | "https://id.inrupt.com/frits",
  dueAt:            1714200000000 | null,
  dependencies:     ["01HX-buy-paint", "01HX-clear-hallway"],  // task ids
  requiredSkills:   ["paint", "ladder-7ft"],
  visibility:       "household" | "role:kitchen-crew" | "private",
  source:           { tg: { chatId, messageId } } | null,  // when imported from H2
}
```

### Schema alignment with H2

H4's task schema is a strict superset of H2's open-item schema.
Cross-walk:

| Field | H2 (Household) | H4 (Tasks) |
|---|---|---|
| `id` | ULID | ULID |
| `type` | enum: shopping/errand/repair/schedule | open enum (H2's four + arbitrary app-defined) |
| `text` | freeform string | `title` (string) |
| `addedBy` | webid | webid |
| `addedAt` | ms epoch | matches |
| `claimedBy` | webid \| null | `assignee` (renamed) |
| `completedAt` | ms epoch \| null | matches |
| `source` | `{ tg: { chatId, messageId } }` | preserved as opaque metadata |
| — (absent in H2) | — | `dependencies` |
| — (absent in H2) | — | `requiredSkills` |
| — (absent in H2) | — | `visibility` |
| — (absent in H2) | — | `dueAt` (already optional in H2; same field name) |

A household that's running H2 today and "graduates" to H4 lifts its
open items into `/tasks/open/<id>.json` with `dependencies: []`,
`requiredSkills: []`, `visibility: "household"`.  Reverse direction
(H4 → H2) is also clean — H2 ignores fields it doesn't understand
and treats every task as flat.

---

## Roles + governance

H4 is the first @canopy app where **role-aware groups** (Track D)
matter for every action, not just for membership management.

### V0 standard roles (single household)

| Role | Permissions |
|---|---|
| `admin` | All `member` permissions + manage roles + manage group key + delete tasks irreversibly |
| `coordinator` | All `member` permissions + reassign tasks + cancel tasks others added |
| `member` | Add tasks, claim unassigned tasks, complete tasks they're assigned to, edit tasks they added |
| `observer` | Read-only — list, view audit log, no writes |
| `external-volunteer` | Claim + complete tasks tagged `external-friendly`; cannot see private/role-restricted tasks |

In a household, everyone is typically `member`; the bill-payer might
be `admin`; a teenage child might be `member` with restricted
visibility on certain task types (e.g. "manage finances" tasks are
`role:adult` only).

### App-defined custom roles (V1+)

Per the project README's open question 7 ("minimal set of standard
roles, or fully app-defined?"), V0 ships **the standard set above**
plus a **per-app role-extension** mechanism: an app can declare
custom roles in `/tasks/config.json` (`customRoles: { "kitchen-crew":
{...} }`) which the policy engine treats as opaque labels for ACL
gating.  V0 does NOT ship a UI for managing custom roles; it's
edit-the-config-by-hand.  V1 adds UI.

### Per-task `visibility` field

Independent of role assignments, each task has a `visibility` field:

- `household` — visible to all household members (default).
- `role:<role-id>` — visible only to members holding that role.
- `private` — visible only to `addedBy` and `assignee`.

The role check happens on every read; tasks the actor isn't allowed
to see are filtered out before they reach the UI.

This refines question 6 from the README ("Privacy + role-based
visibility") to a concrete locked answer.

---

## Skill-match + claim primitive

### Pubsub-of-skills (Track A — Q-A.skill-pubsub)

When a task is added with `requiredSkills: ["paint"]`:

1. Tasks-agent (the adder's) writes `/tasks/open/<id>.json` to the
   shared pod.  Pod-change event fires for all subscribed agents.
2. Each member-agent receives the pod-change event.  Each one's
   skill-match dispatcher checks the member's
   `/private/skills.json` against the task's `requiredSkills`.
3. Members whose `skills.json` intersects `requiredSkills`:
   - if `posture[skill] = always`, the agent **auto-claims** (writes
     `assignee = me` only-if-null).  Compare-and-swap; first to win
     gets the task.
   - if `posture[skill] = negotiable`, the agent **shows a prompt**
     to the human: "Repaint the hallway.  Required: paint.  Claim?"
4. Others (no matching skill, or `posture = never`) ignore.

For human-only tasks (no `requiredSkills`, or skill is "general"),
all members see the task in their UI; whoever claims first wins.

### Why pubsub-of-skills is L0, not L1

This primitive is shared with H5 (Neighborhood) and is needed by
both — it's the natural way to dispatch "find someone who can do X"
in a multi-member group.  Track A surfaces it (Q-A.skill-pubsub
flagged in the readiness analysis).  H4 is the **first consumer**
that drives the SDK to ship it.

---

## Multi-tenant — what's V0 vs V1+

V0 = **single household, 4-6 members, high trust**.  This is what the
H4 readiness analysis flags as "first multi-member app".  Everything
in this doc is sized for that audience.

V1+ generalizations (named so we don't drift):

- **Friend groups** (4-20, low-medium trust).  Smaller scale than
  households, looser governance, often without an `admin` — flatten
  the role model.
- **Businesses** (5-500, role-based hierarchy).  Adds: hierarchical
  permissions ("project-leader can reassign within their project,
  not across"), audit trail with stronger non-repudiation, possibly
  a leader-agent that owns canonical state.
- **Neighborhood maintenance** (50-500, mixed company + volunteer).
  Adds: cross-org integration patterns ("this task is paid pro vs.
  volunteer"), per-org visibility rules, strangers-in-group flows.

Each of these may want a different ledger model (per the README's
question 1):

- **Household** — shared pod (V0).
- **Medium group, intermittent connections** — CRDT replicated.
- **Business with clear hierarchy** — leader-agent owns canonical
  state, others sync.

V0 ships only the shared-pod model.  The other two are V1+ and
involve real Track-B5 work (the shared-mutable-state primitive
needs to abstract over all three).

---

## SDK surface (what's new vs. what reuses)

### Reuses existing SDK primitives

| Primitive | Source | Use |
|---|---|---|
| Solid pod with storage convention | Track A | All task state |
| Encryption-by-ACL | Track A | Tasks encrypted to household group key |
| Role-aware groups (Group X) | Track D ✅ | Member / admin / coordinator / observer / external-volunteer roles |
| `PolicyEngine` | `packages/core/src/permissions/PolicyEngine.js` | Per-action role check |
| Closed-group invitation governance | Track D + relay | Adding members to the household |
| `CapabilityToken` | `packages/core/src/permissions/CapabilityToken.js` | Cross-pod references (e.g. a task on the shared pod that references content on a member's pod) |
| `PodClient` | `packages/pod-client/` | CRUD on `/tasks/...` |
| Skill registry + skill calls | `packages/core/src/skills/` | Tasks-agent's own skills |
| `IdentityPodStore` | Track A | Reading other members' `skills.json` |
| Folio's pod-client + sync-engine layering | H1 | Pod side of the agent (live updates, conflict events) |
| H7 Archive's read-side query patterns | H7 | "Show me open tasks" — FTS5 over task titles + filtering by skill/assignee |

### New — required L0 SDK additions

These are flagged in `projects/04-tasks-app/README.md` "What this app
needs that the SDK doesn't have today".  H4 is the **forcing function**
for landing them in the SDK.

- **Skill posture flag** — L0, shared with H5.  Per-member,
  per-skill, value `always | negotiable | never`.  Stored in
  `/private/posture.json`; consulted by the skill-match dispatcher.
- **Pubsub-of-skills primitive** — L0, shared with H5.  Track A
  question Q-A.skill-pubsub.  H4 is the first consumer.
- **Role-aware groups extension** — Track D ✅ ships the role
  primitive; H4 needs the **role-permission table** for task actions
  (claim/complete/reassign/cancel).  Sized as: 1 file in
  `packages/core/src/permissions/` defining the default permission
  table; app-extensible per `customRoles` in pod config.
- **Closed-group membership with invitation governance** — Track D ✅
  has the membership primitive; H4 surfaces it in the UI ("invite
  Anne to the household — give her role: member").  No new SDK code,
  but UX surface to be designed.

### New — required L1 SDK additions (driven by H4 / B5 in flight)

- **Shared mutable state across agents** — L1 building block.  This
  is **Track B5** (in flight).  H4 is the gating consumer.  Three
  concrete sub-needs:
  - Compare-and-swap on a single field (for `assignee`).
  - LWW on bulk fields (for task body).
  - Append-only log (for `audit/`).
  The primitive should expose all three without forcing the
  consumer to choose one model for everything.

### New — likely L1 SDK additions (promote when a second consumer arrives)

- **Audit trail / append-only history primitive** — L0-or-L1
  depending on depth.  H4 needs every claim/complete/reassign
  written to `audit/yyyy-mm.jsonl`.  H2 wants the same for LLM
  calls (Q-H2-audit).  Lean: **start app-level**; promote to L1
  when H2 + H4 both ship and the pattern is confirmed.

### Deferred — needed by V1+, not V0

- **Mobile push (APNs/FCM) bridge** — L0, blocked on **E2c**
  (deferred per Q-E.4).  Without it, V0's mobile client uses
  pull/poll on a configurable interval.  Acceptable for the
  household-scale audience; less so for V1+'s neighborhood-scale.

---

## Locked decisions (Q-H4.x — drafted, **not yet locked**)

The questions below are the ones surfaced from the
`projects/04-tasks-app/README.md` open questions, plus a few
implementation-level questions that emerged while writing this
document.  **None of them are locked yet** — they need a working
session before kickoff.

| # | Question | **Drafted answer** (to be confirmed) |
|---|---|---|
| Q-H4.1 | Where does the task ledger live? | **Hybrid pod with per-field split.**  Open tasks + assignee + completion go on the shared household pod; per-member skills + posture stay on member pods.  See "Pod schema → Per-field merge contracts" above.  V1+ may add CRDT-replicated and leader-agent-owns-canonical models for larger groups. |
| Q-H4.2 | Claim semantics — distributed lock or optimistic? | **Optimistic with compare-and-swap on `assignee`.**  No relay-coordinated lock.  Friendlier on intermittent connections; the merge contract resolves races. |
| Q-H4.3 | Push semantics — share with H5? | **Yes, unified.**  Pubsub-of-skills primitive in Track A serves both.  Q-A.skill-pubsub. |
| Q-H4.4 | Human vs device agents — same identity model? | **Yes.**  Same skill-posture flag; devices auto-claim if `posture = always`, humans see a prompt if `negotiable`.  Identical primitive on both sides. |
| Q-H4.5 | Task lifecycle depth | **V0:** open / claimed / complete / cancelled.  Reassign is a coordinator-only action.  **V1+:** fail-and-retry, partial-completion (multi-part tasks), recurring tasks. |
| Q-H4.6 | Privacy + role-based visibility | **Per-task `visibility` field** with values `household | role:<id> | private`.  Filtered on read by the policy engine.  See "Roles + governance" above. |
| Q-H4.7 | Role model — minimal standard or fully app-defined? | **Standard set in V0** (`admin`, `coordinator`, `member`, `observer`, `external-volunteer`) + **per-app `customRoles` extension** in pod config.  V0 ships the standard set; custom roles are config-only (no UI).  V1 adds UI. |
| Q-H4.8 | DAG cycle detection | **At write time.**  When a task's `dependencies` is set, the agent walks the DAG; if a cycle would form, the write fails with a friendly error.  Cheaper than tolerating cycles and detecting them on read. |
| Q-H4.9 | "Recurring" tasks (weekly chores) | **Out of scope for V0.**  V1+.  V0 supports one-shot tasks only; "do dishes weekly" is modeled as repeatedly adding a task each week (manual or via a scheduler agent later). |

The questions need a real lock pass — see "Open before kickoff" below.

---

## Cross-cutting integrations

How H4 touches other tracks / apps:

- **H1 (Folio).**  No direct dependency.  Folio's pod-client +
  sync-engine layering is reusable for H4's pod side.
- **H2 (Household).**  Schemas align (see "Schema alignment with H2"
  above).  H2's open items can lift cleanly into H4's task ledger
  when a household graduates from chat-driven to structured-task
  management.
- **H5 (Neighborhood).**  Heavy overlap on skill-match + push
  primitives.  H4 + H5 share `Skill posture flag`,
  `Pubsub-of-skills primitive`, `Closed-group invitation governance`.
  Most of the SDK gaps surfaced by H4 are also surfaced by H5.
- **H6 (Import bridge).**  Could feed H4 — e.g. import a Google Doc
  list of household tasks as the initial task ledger.  Not a
  dependency for V0; a follow-on opportunity.
- **H7 (Archive).**  H7's read-side filtering is the natural query
  layer for "show me open tasks".  H4 v0 may query its own pod
  directly for simplicity; promote to H7-backed retrieval if the
  filter UX becomes attractive.
- **Track A.**  Skill posture + pubsub-of-skills + IdentityPodStore.
- **Track B5 (in flight).**  Shared mutable state primitive — the
  gating dependency.
- **Track D ✅.**  Role-aware groups + `PolicyEngine`.
- **Track E (mobile push relay).**  Not required for V0 (UI uses
  pull/poll).  E2c push integration is deferred — V1+.
- **Track I (distribution).**  The tasks-agent is a deployable Node
  service (or a per-member desktop/mobile bundle).  Track I's
  installer + launchd/systemd story extends naturally.

---

## Out of scope for V0 (named so we don't drift)

- **Multi-tenant configuration.**  V0 = single household.  Friend
  groups, businesses, neighborhood-maintenance are V1+.
- **Cross-org integration patterns.**  Mixed companies + volunteers
  in one group.  V1+, requires the multi-tenant work first.
- **CRDT-replicated ledger model.**  Shared-pod only in V0.
- **Leader-agent-owns-canonical model.**  V1+, businesses.
- **Custom-role UI.**  V0 = config file edit-by-hand; V1 = UI.
- **Recurring tasks.**  V1+.  V0 = one-shot only.
- **Multi-part tasks (partial completion).**  V1+.  V0 = atomic
  open / complete / cancel.
- **Push notifications on mobile.**  V0 = pull/poll.  Blocked on E2c.
- **Calendar bidirectional sync.**  Track-J style work.  V1+.
- **Voice / chat task input.**  H2's territory; H4 is structured
  input only.
- **DAG editor UI.**  V0 = "select dependencies from a list".
  Visual editor is V1+.
- **Multi-claim / co-assignment.**  V0 = single assignee per task.
- **Sub-agents (a task's claim spawns child tasks for a
  sub-team).**  V1+.

---

## Hand-off triggers

| When this completes | What it unblocks |
|---|---|
| **V0 (single household, web + agent-CLI)** | First multi-member @canopy app.  Track D's role-aware groups + `PolicyEngine` proven on real product code.  Track B5's shared-mutable-state primitive proven (compare-and-swap + LWW + append-only).  Skill-posture + pubsub-of-skills primitives proven; H5 unblocks (was sharing them). |
| **V0 (mobile RN client)** | Per-member mobile UX proven.  Same pattern as Folio's web + mobile pair. |
| **V0 (device-agent claim)** | First non-human agent to claim work.  Validates posture flag, pubsub-of-skills, signed-by-device-keypair audit trail. |
| **V1 (multi-tenant — friend groups + businesses)** | Generalizes role model + ledger model.  Drives the CRDT-replicated and leader-agent variants in Track B. |
| **V1 (cross-org neighborhood)** | Strangers-in-group flows + per-org visibility.  Drives Q-H5 anonymity model. |

---

## Implementation plan — DEFERRED

This document is the design.  An implementation plan (week-by-week
slicing, file paths, test additions, DoD per slice) belongs in a
separate follow-up doc — `track-H-app-tasks-impl.md` or similar.

The implementation plan should:

1. Lock Q-H4.1–9 above before slicing.  See "Open before kickoff".
2. Wait for **B5** to ship (gating dependency).  Without B5, V0 has
   to bring its own shared-mutable-state primitive — duplicates work
   and risks divergence.
3. Pick a test strategy: dependency-DAG resolver and skill-match
   dispatcher are pure functions and unit-testable directly.  The
   compare-and-swap claim flow needs an integration harness with a
   simulated multi-agent race.  Pod-side tests reuse Folio's
   pod-client test harness.
4. Define a **claim-race regression test** as the gate for "V0
   ships": spin up N member-agents, all eligible for the same
   task, all calling `claimTask` simultaneously; verify exactly one
   wins and the others see the assignment + back off.
5. Pin the deployment story.  Per-member desktop install (Track I) +
   per-device install for device-agents (Track I, smaller bundle).
   Pod is wherever the household's hosting — typically alongside H2
   on the same private server.

---

## Open before kickoff

Things to settle in a working session before writing
`track-H-app-tasks-impl.md`:

- **Lock Q-H4.1–9.**  Each has a drafted answer above; needs a
  working session to confirm or revise.
- **App name.**  Klus / Beurt / Spar / Ledger / something else.
- **B5 readiness.**  How close is the shared-mutable-state primitive
  to landing?  Does V0 need to wait, or can it ship a stub and swap
  in B5 when it arrives?
- **Per-task visibility cost.**  Filtering on read scales linearly
  with task count.  At household-scale (10s-100s of tasks) trivial;
  at neighborhood-scale (1000s+) the by-skill / by-assignee indexes
  become load-bearing.  V0 doesn't need to over-engineer, but the
  index file shape should accommodate filtering on visibility too.
- **Custom-role config format.**  `/tasks/config.json` `customRoles`
  shape.  Lean: same structure as the standard role table (a JSON
  object with permission flags), parsed by the same policy engine.
- **Audit-log retention.**  V0 = forever, monthly archives.  Same
  pattern as H2.  Confirm.
- **Device-agent onboarding.**  How does Anne add her 3D printer to
  the household?  Closed-group invitation primitive (Track D) — but
  the device needs a UX to scan/accept the invite.  Probably a CLI
  flow + a QR code displayed on the device-agent's status page.
  V0 = CLI; UX polish = V1.

---

## Loose ends — flagged for the implementation pass

These belong in the design conversation but should be visible
before the planner starts writing weeks:

- **DAG cycle detection at write time.**  Q-H4.8 leaned this way —
  but the primitive needs a clear error UX.  "You can't add this
  dependency because it would create a cycle: T1 → T2 → T3 → T1."
- **Tasks that require resources (3D printer, kitchen, ladder).**
  The README mentions skill *requirements* including
  device-equipped machines.  V0 lumps these into `requiredSkills`
  (e.g. `["3d-print"]` matches both a person who can operate a
  printer AND the printer itself).  V1 may need a separate
  `requiredResources` field if booking conflicts arise.
- **"Claim and forget" vs "claim and start now".**  When a member
  claims a task, do they commit to start now, or just to do it
  eventually?  V0 = "claim = I'll do it eventually, see also
  `dueAt`".  Stalled-claim detection (a task claimed > N days ago
  with no `completedAt`) is a V1 nudge.
- **Multi-claim — should two members be able to co-own a task?**
  V0 = no.  Use a child task instead.  But the schema reserves
  the option — `assignee` could become `assignees: webid[]` later
  without a migration if the field is single-valued in V0 by
  convention only.
- **Public observer feed.**  An observer-role member can read but
  not write.  Use case: a friend who's not in the household but
  wants to see what's going on.  V0 supports it; UX needs a "share
  this view as read-only" button.
- **Group key rotation on member leave.**  Same primitive as H2.
  When Anne leaves, the household group key rotates so her old
  agent can no longer decrypt new pod content.  Track A + Track D
  handle the primitives; H4's UX needs to surface the "remove
  member" action and trigger rotation.
- **Bulk operations.**  "Cancel all open tasks" or "reassign Anne's
  tasks to the author because Anne's on holiday".  V0 can support these
  as a CLI flow; UI is V1.
- **Conflict UX when two members edit the same task body
  simultaneously.**  LWW resolves it silently; the loser's edit is
  lost.  V0 acceptable (small scale, infrequent edits); V1 may
  surface "your edit was overwritten" as a UX affordance.

---

## Pointers

- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md)
  — L2 design notes (the most detailed source).
- [`../USE CASES.md`](../USE%20CASES.md) §4 — cross-cutting use-case
  summary.
- [`../Design-v3/topology.md`](../Design-v3/topology.md) §Hybrid pod
  patterns — H4 will exercise the *per-field split* variant.
- [`./track-H-apps.md`](./track-H-apps.md) §H4 — readiness analysis,
  tier placement, dependency map.
- [`./track-H-app-household.md`](./track-H-app-household.md) — sibling
  app's design (schemas align).
- `Design-v3/role-aware-groups.md` — to-be-written.
- `track-H-app-tasks-impl.md` — to-be-written, after Q-H4.x lock.
