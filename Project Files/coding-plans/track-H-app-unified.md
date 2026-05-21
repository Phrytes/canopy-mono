# H2+H4 — Unified household-tasks app (draft)

| | |
|---|---|
| **Status** | Draft — high-level only.  Written 2026-05-02 to test the hypothesis that H2 (chat-driven household assistant) and H4 (structured task ledger) are better shipped as a single app with multiple interfaces.  No detailed architecture, schemas, or implementation plan in this doc — those land in a follow-up if the unification approach is endorsed. |
| **Owner** | unassigned |
| **App name** | TBD — placeholder candidates from the H2 + H4 lists: **Klus**, **Stoel**, **Bord**, **Hearth**, **Ledger**.  One name covers everything. |
| **Replaces (if endorsed)** | [`./track-H-app-household-v2.md`](./track-H-app-household-v2.md) (becomes the "chat interface" sub-spec) and [`./track-H-app-tasks.md`](./track-H-app-tasks.md) (becomes the "structured interface" sub-spec).  Both retained as feature specs; the unified doc becomes the top-level. |

---

## The pitch in one paragraph

A single household-tasks app with **one shared task ledger** and **multiple interfaces** — Telegram DM (per member, conversational LLM), simple web UI (per member, structured form), mobile RN later.  Members pick the interface that fits the moment.  The data model is unified: every entry is a "task" with optional fields (DAG dependencies, required skills, role visibility) that default to "none".  The same item Anne adds via chat ("we hebben brood nodig") shows up in the web UI; the same item the author ticks off on web disappears from Anne's chat list at her next session.

---

## Why combine — the architectural argument

H2 v2's reframe (1:1 DM, conversational, narrow tools, shared pod) collapsed the difference between H2 and H4 to **interface only**.  Both were already converging on:

- Per-member agent
- Shared household pod (hybrid pattern)
- Same item shape (H4 = strict superset of H2)
- Same Track D / B5 / audit substrate

The historical "they're different products" rule was written when H2 was multi-member group chat and H4 was structured.  After the v2 reframe, the only real delta is **how a member interacts** — through chat or through a web UI.  That's a UI choice, not an app boundary.

**Implication for H4's coding plan:** H4 hasn't started.  The user's instinct is that much of H2's existing code (Telegram adapter, LLM client, conversational session, hybrid-pod write paths) can be reused under a unified app.  Likely true — most of `apps/household/src/` (skills barrel, tool dispatcher, audit, pod-write paths) is interface-agnostic.

---

## What it is — high-level shape

```
                Anne (chat)        the author (web)        future: mobile, CLI
                   │                  │                       │
                   ▼                  ▼                       ▼
        ┌──────────────────┐  ┌────────────────┐       ┌────────────┐
        │ Telegram DM      │  │ Web UI         │       │ ...        │
        │ adapter          │  │ adapter        │       │            │
        │ (conversational) │  │ (structured)   │       │            │
        └────────┬─────────┘  └───────┬────────┘       └─────┬──────┘
                 │                    │                      │
                 └─────────┬──────────┴──────────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────────┐
        │  Unified app agent (per-member or per-household)     │
        │  - tools: addItems / markComplete / removeItems /    │
        │           claimItem / setDeps / setSkills            │
        │  - role-policy gate (Track D)                        │
        │  - audit log                                         │
        │  - LLM client (only used by chat adapter)            │
        └──────────────────────────────┬───────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────┐
                        │ Shared household pod     │
                        │ (Solid, hybrid pattern)  │
                        │ /tasks/                  │
                        └──────────────────────────┘
```

**One pod, one item shape, multiple adapters.**  Each adapter is an
incoming interface; the agent core is the same.  The chat adapter
adds the LLM layer; the web adapter renders structured forms.

---

## Two small example flows

### Example 1 — Chat add, web read

```
Anne, in her Telegram DM:
   "Doe brood en eieren erbij voor de boodschappen."

Bot (LLM-mediated):
   ✓ Brood en eieren toegevoegd.

the author, ten minutes later, opens the web UI on his laptop:
   ┌──────────────────────────────────────┐
   │  Open boodschappen                   │
   ├──────────────────────────────────────┤
   │  □ brood          (Anne, 10 min ago) │
   │  □ eieren         (Anne, 10 min ago) │
   └──────────────────────────────────────┘

the author adds via the form:
   "+ Add task: melk, type=shopping"

Anne, next session in her DM:
   "Wat hebben we nodig?"

Bot:
   Open boodschappen:
   - brood (door jou, 12 min geleden)
   - eieren (door jou, 12 min geleden)
   - melk (door the author, 2 min geleden)
```

### Example 2 — Web claim with skill, chat completion

```
Anne, in the web UI, adds a task:
   ┌────────────────────────────────────┐
   │  + New task                        │
   │  Title:  Repaint the hallway       │
   │  Type:   repair                    │
   │  Needs:  paint                     │
   │  Due:    next weekend              │
   └────────────────────────────────────┘

the author, who has skill "paint" registered, sees a notification.
He claims via the web UI:
   [ I'll take it ]  →  task assigned to the author.

the author, the next weekend, in his Telegram DM:
   "Klaar met de hal schilderen."

Bot:
   ✓ Repaint the hallway afgevinkt.  Mooi werk!

(Web UI updates live for Anne — task moves to "completed".)
```

The chat interface and the web interface are interchangeable; the
member picks whichever is convenient.  The pod is the truth.

---

## V0 scope — strictly capped

The unification only works if V0 stays disciplined.  V0 = **H2 v2's
chat surface + a minimal structured UI**, nothing more:

- ✓ Telegram DM adapter (conversational, narrow tool catalog).
- ✓ Web UI adapter (per-member, simple list view: open + closed,
  add via form, mark complete, remove).
- ✓ One unified item schema (H4-shape, but with all H4-extension
  fields as optional defaults to none).
- ✓ Shared household pod (hybrid pattern).
- ✓ Single role: every household member can do everything.
- ✓ Audit log (who did what when).
- ✓ Bot has its own keypair (own identity).
- ✓ Daily digest cadence (per Q-H2.7).

**Not in V0** (deferred to V1+):

- DAG dependencies (`depends_on`).
- Required skills + skill-match dispatch.
- Role-aware governance beyond "member" (no admin / coordinator /
  observer / external-volunteer split yet).
- Multi-tenant (no friend-groups / businesses / neighborhood).
- Mobile RN client.
- DAG editor UI.
- Custom roles.
- Recurring tasks.
- Push notifications (waiting on E2c).

**Estimated V0 size:** roughly H2 v2 + 1-2 weeks for the web list
view.  The structured interface is small because it has no DAG / no
roles / no skills — just CRUD over the same pod the chat interface
already writes to.

---

## How the existing plans fold in

Both prior plans become **feature specifications** under this
unified umbrella; neither is thrown away.

- **`track-H-app-household-v2.md`** → the "chat interface"
  sub-spec.  Describes the Telegram-DM-with-LLM half.  Most of it
  (architecture, NL-context-loading, narrow tool catalog,
  conversational LLM) carries over verbatim.
- **`track-H-app-tasks.md`** → the "structured interface" + V1+
  features sub-spec.  Describes the web UI shape, role-aware
  permissions, DAG, skill-match dispatch.  V0 of the unified app
  uses only the simplest part (web list view); the rest is V1+.
- **The H4 worksheet (`track-H-app-tasks-questions.md`)** mostly
  applies as V1+ design questions, not V0 questions.  Q-H4.0 (app
  name) merges with H2's app-name placeholder.
- **The H2 v1 and v2 worksheets** still apply for the chat half.

---

## Open questions for the unification decision

These need to be settled before drafting the detailed unified plan:

1. **Single agent process or per-member?**  H2 v2 is one process
   serving N member sessions.  H4 leans toward per-member agents.
   Probably one unified process for V0; per-member is V1+ when
   device-agents arrive.
   > F: exactly
2. **Web UI tech.**  Folio's web client is a good template (vanilla
   JS over PodClient).  Reusing that vs. picking something new.
	 F: exactly, actually, maybe we could ship the interface part to Folio, in order not to duplicate code too much, as it was a bit challenging to create folio already. What do you think?
3. **Web-UI ↔ agent IPC.**  REST + SSE (Folio pattern) probably.
   F: See point 2 (but agreed)
4. **Authentication on the web UI.**  Members log in with their
   webid; same primitive as Folio.
   > F: see point 2
5. **Telegram + web concurrency.**  When Anne adds via chat and
   the author adds via web at the same instant, both writes need to land
   without one clobbering the other.  H4's compare-and-swap on
   `assignee` handles claim races; for plain adds, LWW is fine
   because items have unique ids.
   > F: sure
6. **App name.**  One name covers both interfaces.
		F: any suggestions? ^^

---

## Next step (if endorsed)

If the unification approach is the right one, the work is:

1. Lock the V0 scope cap (the bullets above) so it can't drift.
2. Draft `track-H-app-unified-v0-detailed.md` — same depth as the
   v2 doc, but covering the full unified surface (chat + web).
3. Mark `track-H-app-household-v2.md` and `track-H-app-tasks.md` as
   "now sub-specs" with a banner pointing at the unified doc.
4. Update [`./track-H-apps.md`](./track-H-apps.md) to merge H2 + H4
   into one entry.
5. Plan a single implementation doc instead of two
   (`track-H-app-unified-impl.md`).

If the unification approach is rejected after reading this draft,
nothing changes — H2 v2 and H4 stay independent and this doc becomes
a record of the decision.

---

## My honest read (one paragraph)

The unification math is favourable **only** if V0 is held to
"H2 v2 + simple web list view".  If V0 grows to include H4's
DAG/skills/roles, it explodes from ~3 weeks to ~8 weeks and the
"easier" claim collapses.  The strict V0 scope above keeps it small
and reuses most of `apps/household/src/`.  The risk is scope creep
during implementation, not the architecture itself.
F: the more I think about it, the more sense it starts to make. Ship the interface part to some app that is built on top of Folio for now (which makes the current project a bit lighter), but both idealistically and functionally Im in for making the task infrastructure both available to humans as machines this way. Lets include the DAG/skills/roles in this unified app too. Also, lets just work in the household directory within the apps-part. 