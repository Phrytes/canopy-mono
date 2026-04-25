# Use cases — working document

**Status:** in-progress design dialogue.  Started 2026-04-25.

This doc captures four use case sketches the author proposed before
committing to more technical work.  The use cases will shape SDK
priorities, particularly around: shared mutable state, skill-based
broadcast / matchmaking, closed-group governance, mobile push, and
Solid-pod ergonomics.

Two passes:

1. **Refine the sketches** (this doc).  Surface tensions, ask
   clarifying questions, list additions worth considering.  No
   commitment to system changes yet.
2. **Translate to integral improvements** (follow-up doc).  Map
   refined use cases onto:
   - app-level concerns (live in `apps/*`)
   - SDK-level additions (live in `packages/core`, `packages/react-native`,
     `packages/relay`)
   …with a clear separation between the two.

The original sketches were written in Dutch; English translations
preserve intent.

---

## 1. Documents / notes / project-files app

### Sketch (original)

> Een prive-agent die bij de solid-pod kan (of een gedeelte ervan)
> en daarmee dus ook toegang kan geven aan anderen (bijv skills daar
> opgeslagen).  Of misschien dat je dan in de praktijk min of meer
> twee solid-pods hebt, die aan elkaar gekoppeld zijn en waarvan je
> eentje kunt openstellen, maar er geen risico is van doorbreken
> naar je privé-info.
>
> Vervolgens dat een app als obsidian die pod gewoon kan aanroepen
> als md-files en synchroniseren enzo.
>
> Uiteindelijk zou je er ook in willen kunnen samenwerken, zoals in
> google docs, eenvoudig forks/kopieen maken enzo.

### Reading (English)

A private agent that owns (or has access to) the user's Solid pod.
It can selectively expose parts of that pod to other agents —
turning the pod into a permissioned knowledge store you can
collaborate on.  Possibly two linked pods (private + share-able)
to harden the isolation.  An editor like Obsidian sees plain
`.md` files via the pod's filesystem-like interface.  End-state:
forks, shared editing, multi-user collaboration on documents.

### Tensions / open choices

- **One pod or two?**  "Two linked pods, one openable" is
  conceptually clean but operationally heavier (two ACL stores,
  two auth flows, two sync targets).  One pod with two
  ACL-scoped containers (`/private/`, `/shared/`) gives the same
  isolation with less overhead.  Solid's WAC / ACP supports this
  natively.
- **What does "give access to skills stored in the pod" mean?**
  Two readings:
  - (a) Skills are *data* the pod stores (recipes, templates,
    prompts).  Other agents can read them.
  - (b) Skills are *callable code* an agent runs on behalf of
    others, with the pod as the persistence layer.
  Reading (b) requires a sandbox model (you really don't want
  strangers running JS on your laptop).  Reading (a) is benign.
  **Question: which did you mean?  Likely (a)?**
- **Obsidian compatibility.**  Obsidian wants a local filesystem.
  Two paths:
  - One-way sync (pod ↔ local Obsidian vault) — simple but
    conflicts on concurrent edits.
  - FUSE / WebDAV mount that makes the pod look like a local
    folder — more powerful, more setup.
  **Question: which UX feels right?**
- **Collaboration semantics.**  "Like Google Docs" can mean three
  very different things:
  - Real-time character-level collab → CRDTs (Yjs, Automerge).
    Heavy.
  - "Wiki-style" simultaneous saves with last-write-wins → easy,
    occasional lossage.
  - "PR-style" forks + merges → cleanest for `.md`, lossless,
    loses real-time feel.
  Real-time is the most Google-Docs-like; PR-style matches how
  programmers already work with markdown.  **Strong opinion
  needed.**

### Additions worth considering

- **Versioning / history.**  If users fork and merge, they
  implicitly want history.  The pod can hold revisions natively
  (Solid's container + timestamp model) but the editor has to
  surface them.
- **Encryption at rest.**  A Solid pod hosted by a third party —
  the host can read it unless you encrypt before storing.  For
  truly private notes, do we want envelope encryption (each note
  encrypted to your agent's key)?

---

## 2. Gated relay + neighborhood skill matchmaking

### Sketch (original)

> Een relayserver waar je alleen bij kan als je wordt toegevoegd
> en die je in contact stelt met buurtgenoten waar je vervolgens
> een vraag kan stellen, die weer aan skills gekoppeld is en die
> dan de matchende buurtgenoten een notificatie stuurt met de
> vraag of ze erop willen reageren.  Met andere woorden: elke
> buur heeft een eigen agent op hun device en die staan met
> elkaar in contact via een veilige relayserver.

### Reading (English)

A relay you can only join by invitation (closed network of, say,
your block / building).  Each member runs an agent on their phone.
Members can broadcast a question that's tagged with one or more
skills; the relay forwards the request to members whose agents
have registered that skill, asking *interactively* whether they
want to respond.  Responders opt in; non-responders are silent.
Built-in privacy from the relay (sealed forward) and identity-
disclosure controls.

### Tensions / open choices

- **What's the unit of broadcast?**
  - "Help-needed" notification — `Anyone good with bikes?`  Each
    receiver sees a prompt on their device and can choose to
    respond.
  - Skill-call — `someone please run skill 'fix-bike-summary' on
    my problem statement.`  Receivers' agents auto-execute if
    configured to.
  Probably both, but UX is very different.  **Question: which is
  the primary?**
- **Notification UX.**  If skill-broadcasts are interactive
  ("do you want to respond?"), the receiver's agent has to
  *interrupt* the user.  On a phone that means push notifications
  (iOS APNs / Android FCM) — which means a backend bridge, since
  the phone agent isn't always online.  **Acceptable architectural
  cost?**
- **Identity exposure.**  Should the requester's identity be
  revealed to non-respondents?  Default-hidden (only revealed
  when someone accepts) vs default-visible.  A neighborhood is
  small enough that visible may be fine; a building of strangers
  might want hidden.
- **What "added to the relay" means.**  Three governance models:
  - Operator-controlled: one admin manually adds members.
  - Invite-link: existing members issue invite tokens.
  - Web-of-trust: any member can vouch; new joins surface to the
    group for review.
  **Question: which governance shape?**
- **Geographic / topical scoping.**  "Neighborhood" implies a
  single closed group.  What about belonging to multiple groups
  (block + sports club + family)?  Same agent participates in
  many; the matchmaking is per-group.

### Concerns

- **Spam.**  Closed group helps, but a single bad actor can flood.
  Need rate limits at the relay AND opt-out per skill at the agent.
- **Persistence of unanswered requests.**  If your agent is
  offline when a question comes in, do you see it later?  Implies
  a relay-side queue (already on the relay roadmap) but with
  multi-recipient semantics — fan-out to all skill-holders,
  fan-in for any-one-replies.

---

## 3. Document import bridge

### Sketch (original)

> Een app (met agent) die documenten ophaalt van bijv google docs,
> zoveel mogelijk omzet naar md en die upload naar solidpod (of
> opslag waar de pod naar verwijst).  Moet steeds meer compatibel
> worden met andere documentsystemen.  Waarbij het dan weer in
> app 1 gebruikt kan worden.

### Reading (English)

An agent whose only job is "see a Google Doc URL, fetch it via
Google's API, convert to markdown, write to your Solid pod."  Over
time, expand to other sources: Notion, Dropbox Paper, Office 365,
OneNote, Roam, etc.  The user-facing app in #1 then sees the
imported content as just-another-markdown-file.

### Tensions / open choices

- **Where does this agent run?**  Two flavors with very different
  security postures:
  - As a *cloud service* (your hosted endpoint, holds OAuth
    tokens for many users): scalable, but you're holding
    everyone's Google tokens.
  - As a *local agent on your device*: each user's tokens stay
    local, but you need a local OAuth flow for each source
    service.
  Decentralization narrative favors local.  Operational reality
  favors cloud.  **Question: which is the model?**
- **One-shot import or ongoing sync?**  Import is a single
  fetch+write.  Sync requires polling or webhook for updates,
  change detection, conflict resolution if both sides edit,
  deletion semantics.  Big jump in complexity.
- **Conversion fidelity.**  Google Docs → md is lossy (comments,
  suggestions, embedded images, custom styles).  Acceptable
  losses?  Probably yes, but worth listing what you'd accept
  losing vs. what you'd want preserved-as-extension.
- **Authentication chain.**  The import agent needs Google OAuth.
  The pod needs Solid OIDC.  So the agent ends up holding *two*
  sets of credentials — different from the existing trust model
  where an agent has one identity.

---

## 4. Task / workflow app with skill-based dispatch

### Sketch (original)

> Een taken-app waarmee zowel mensen (agents) als devices (agents)
> taken van kunnen claimen/uitvoeren en dat wanneer de
> dependencies van een taak zijn vervuld automatisch de nieuw
> beschikbare taak wordt gepusht naar de relevante agents (of dit
> nu mensen of machines zijn).

### Reading (English)

A shared task list among a group (project team, household,
neighborhood org).  Tasks have dependencies — a DAG.  Tasks have
skill requirements — "needs someone-who-can-paint", "needs a
3D-printer-equipped-machine".  When a task's dependencies are
met, the system pushes the task to all agents (human or device)
that match the skill, and one of them claims it.

### Tensions / open choices

- **Where does the task ledger live?**  Three options:
  - Shared Solid pod (use case #1 territory) — simple, one
    source of truth, but the pod becomes a single point of
    failure / bottleneck.
  - CRDT replicated across all participating agents — robust,
    but real CRDT semantics on a task-with-claim-state are
    non-trivial.
  - "Project-leader" agent owns the canonical state, others
    sync — simple, but reintroduces a coordinator.
  **Question: which model?**
- **Claim semantics.**  When two agents see a task simultaneously
  and both try to claim, who wins?  Distributed lock
  (relay-coordinated) vs. optimistic claim with rollback.  The
  latter is friendlier on intermittent connections.
- **Push semantics.**  "Push to relevant agents" — same primitive
  as use case #2's skill-broadcast.  Worth unifying.
- **Human vs. device agents.**  Same identity model but very
  different UX.  Devices auto-claim if capable; humans see a
  prompt.  The agent's policy decides which behavior.  Makes
  sense to model devices as "agents with auto-accept on, prompt
  off."
- **Task lifecycle.**  Beyond claim/complete: cancel, reassign,
  fail-and-retry, partial completion (multi-part tasks), audit
  trail.  Depth of model needed?
- **Privacy.**  Does every group member see every task?  Or are
  tasks scoped (this task is for the kitchen-renovation crew
  only)?  Sounds like Group X visibility filtering applies.

---

## Cross-cutting threads

Patterns that recur across the four use cases — where the SDK
level is most likely right.

| Theme | Use cases | What the SDK might need |
|---|---|---|
| **Shared mutable state across agents** | 1 (collab docs), 4 (task ledger) | Either CRDT primitive, or a "shared object" backed by the pod with conflict callbacks |
| **Skill-based broadcast / matchmaking** | 2 (neighbor questions), 4 (task dispatch) | A pub/sub-of-skills primitive (`broadcast(skillId, payload)` → arrives at every peer that has registered `skillId`); maybe extend `pubSub.js` |
| **Closed-group membership with invitation governance** | 2, 4, partially 1 | Relay-side allowlist + invite-token issuance (already on the relay roadmap); group-claim mechanism with member-vouching is new |
| **Solid-pod-as-shared-storage** | 1, 3, 4 | Already in `packages/core/src/storage/SolidPodSource.js` and `SolidVault.js` — verification + ergonomics, not new code |
| **Notifications / interrupts to humans** | 2, 4 | New: mobile push (APNs/FCM) bridge so phone agents can wake on incoming requests |
| **Group-visible content (tasks / skills / docs)** | 1, 2, 4 | Group X (group-visibility) already exists; might need polishing |

---

## Open questions (priority order)

1. **For #1, is "skills stored in the pod" reading (a) [data] or
   (b) [callable code]?**  Decides whether we need a sandbox.
2. **For #1, what flavor of collaboration?**  PR-style
   forks/merges (lossless but async) vs Google-Docs realtime
   (CRDTs, heavy) vs middle ground.
3. **For #2, primary unit of broadcast** — interactive "want to
   respond?" prompts to humans, or auto-executing skill calls
   between agents?  Probably both, but which is the headline?
4. **For #2, joining the closed group** — operator-managed,
   invite-link, or web-of-trust?
5. **For #3, local-agent-with-local-OAuth or cloud-hosted import
   service?**  Big posture difference.
6. **For #4, where does the task ledger live?**  Solid pod /
   CRDT / leader-agent.
7. **Across all four — is mobile-push-notification a hard
   requirement?**  Main new-infrastructure piece these use cases
   imply, alongside the production relay.

---

## Next step

Once the seven questions above have answers, the follow-up doc
maps refined use cases to:

- **App-level work** — what each app needs to build itself,
  including UI, app-specific skills, OAuth flows for source
  services, etc.
- **SDK additions** — what `@canopy/core`, `@canopy/react-native`,
  `@canopy/relay` need to grow to support these apps.  With
  the rule that SDK additions must be useful for at least two
  of the four use cases (or one use case + a clear "common"
  pattern outside this list), to avoid app-specific bloat.
