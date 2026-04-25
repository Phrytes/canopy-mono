# Use cases — working document

**Status:** in-progress design dialogue.  Started 2026-04-25,
refined 2026-04-25 (pass 2).

This doc captures four use case sketches the author proposed before
committing to more technical work.  The use cases will shape SDK
priorities, particularly around: shared mutable state, skill-based
broadcast / matchmaking, **anonymous discovery with bilateral
identity-reveal handshake (NEW)**, multi-tenant group governance,
mobile push, and Solid-pod ergonomics.

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

### Sketch (original, pass 2)

> Een prive-agent (lokaal op device) die bij de solid-pod kan (of
> een gedeelte ervan) en daarmee dus ook toegang kan geven aan
> anderen, of misschien dat je dan in de praktijk min of meer twee
> solid-pods hebt, die aan elkaar gekoppeld zijn en waarvan je
> eentje kunt openstellen, maar er geen risico is van doorbreken
> naar je privé-info: bijv documenten voor samenwerking of zelfs
> een blog.
>
> Vervolgens dat een app als obsidian die pod gewoon kan aanroepen
> als md-files en synchroniseren enzo.
>
> Uiteindelijk zou je er ook in willen kunnen samenwerken, zoals in
> google docs, eenvoudig forks/kopieen maken enzo.

### Reading (English)

A **local-on-device** private agent that owns (or has access to)
the user's Solid pod.  It can selectively expose parts of that pod
to other agents — turning the pod into a permissioned knowledge
store you can collaborate on.  Possibly two linked pods (private
+ share-able) to harden the isolation, with the share-able one
holding things like *collaboration docs* or *a blog*.  An editor
like Obsidian sees plain `.md` files via the pod's filesystem-like
interface.  End-state: forks, shared editing, multi-user
collaboration on documents.

### What's resolved in pass 2

- **"Skills stored in the pod" is gone.**  The previous ambiguity
  (skills-as-data vs skills-as-callable-code) is dropped — the
  pod holds documents and content, not executable code.
  Confirms reading (a): no sandbox needed.
- **Agent location is local-on-device.**  Trust posture:
  agent's keypair lives in the device's keychain, pod-access
  credentials too.  Cloud-only versions are out of scope for #1.

### Tensions / still-open choices

- **One pod or two?**  "Two linked pods, one openable" is
  conceptually clean but operationally heavier (two ACL stores,
  two auth flows, two sync targets).  One pod with two
  ACL-scoped containers (`/private/`, `/shared/`) gives the same
  isolation with less overhead.  Solid's WAC / ACP supports this
  natively.
- **Obsidian compatibility.**  Two paths:
  - One-way sync (pod ↔ local Obsidian vault) — simple but
    conflicts on concurrent edits.
  - FUSE / WebDAV mount that makes the pod look like a local
    folder — more powerful, more setup.
  **Question: which UX feels right?**
- **Collaboration semantics.**  Three options with very
  different complexity:
  - Real-time character-level collab → CRDTs (Yjs, Automerge).
    Heavy; needs continuous sync.
  - "Wiki-style" simultaneous saves with last-write-wins → easy,
    occasional lossage.
  - "PR-style" forks + merges → cleanest for `.md`, lossless,
    loses real-time feel.
  Real-time is the most Google-Docs-like; PR-style matches how
  programmers already work with markdown.  **Strong opinion
  needed.**
- **Blog as a use case.**  Suggested in pass 2 ("zelfs een
  blog").  A blog is:
  - Public-readable (no ACL on `/shared/blog/`).
  - Append-only-ish (rare edits).
  - Has a feed.
  Adds RSS / Atom / static-site-generation as adjacent concerns.
  Probably an app-level extension, not a SDK concern.

### Additions worth considering

- **Versioning / history.**  If users fork and merge, they
  implicitly want history.  The pod can hold revisions natively
  (Solid's container + timestamp model) but the editor has to
  surface them.
- **Encryption at rest.**  A Solid pod hosted by a third party —
  the host can read it unless you encrypt before storing.  For
  truly private notes, do we want envelope encryption (each note
  encrypted to your agent's key)?
  Open question: how does this interact with Obsidian
  compatibility?  Obsidian wants to read plaintext.  Either:
  the encryption layer is below the pod (so Obsidian sees
  decrypted files via WebDAV/FUSE), or only the *index/manifest*
  is encrypted and the files themselves are plaintext-but-
  ACL'd.

---

## 2. Gated relay + neighborhood skill matchmaking with anonymity

### Sketch (original, pass 2)

> Een relayserver waar je alleen bij kan als je wordt toegevoegd
> en die je in contact stelt met buurtgenoten waar je vervolgens
> een vraag kan stellen, die weer aan skills gekoppeld is (dat
> kunnen dus ook menselijke skills zijn) en die dan de matchende
> buurtgenoten een notificatie stuurt met de vraag of ze erop
> willen reageren.  Met andere woorden: elke buur heeft een eigen
> agent op hun device en die staan met elkaar in contact via een
> veilige relayserver.  Het hangt ervan af of de user het
> neerzet als skill die hij/zij altijd wel wil inzetten, (zodat
> je gewoon direct kunt requesten) of dat het meer is 'ja ik kan
> meubels bouwen, maar ik weet niet of ik in elke tafelpoot
> reparatie zin heb'.  Dus er zal een deel onderhandelen
> inzitten.  By default zou je willen dat mensen anoniem kunnen
> scrollen door skills (ook anoniem) en dat pas na goedkeuring
> van beide kanten de anonimiteit wordt opgeheven.

### Reading (English)

A relay you can only join by invitation (closed network of, say,
your block / building).  Each member runs an agent on their phone.
Skills can be **machine** skills (auto-callable) OR **human**
skills (the human gets a prompt and decides).  Members can
broadcast a question that's tagged with one or more skills.

The interaction has two flavors depending on the skill provider's
declared posture:

- **"Always available"** — provider has marked the skill as
  always-callable.  Direct request, no prompt, runs immediately.
- **"Negotiable"** — provider has marked the skill as
  case-by-case ("yes I can build furniture, but I don't know if I
  want to do every table-leg repair").  Request goes to a
  negotiation / opt-in phase before commitment.

**Anonymity model (NEW, important):**
- By default, members can browse skills *anonymously* — they see
  skill listings without seeing provider identities.
- Listings themselves are anonymous — providers list a skill
  without exposing who they are.
- A request goes to the matching providers without revealing the
  requester's identity.
- Only after **both sides have explicitly approved engaging** is
  the anonymity lifted on both ends.

Both browsing and being-listed are anonymous-by-default; identity
reveal is a two-sided handshake, not a single click.

### What's resolved in pass 2

- **Both broadcast forms are needed** — interactive prompts
  (negotiable skills) AND direct skill calls (always-available
  skills).  The SDK needs both.  Per-skill posture flag.
- **Human skills are first-class.**  Skill registration must
  carry a `humanInTheLoop: true` flag.  Listings need to surface
  this so requesters know what to expect.

### NEW: anonymity-with-mutual-consent — its own protocol layer

This is the architecturally novel part of pass 2.  It's not
covered by the existing relay-forward / sealed-forward / hop-
tunnel stack:

- relay-forward: bridge sees content (relay sees envelope, may
  see payload if not sealed).
- sealed-forward: bridge cannot read content; *identity is still
  attached*.
- This new layer: **identity is hidden from everyone except the
  relay** until both parties consent.  Relay vouches for
  membership but issues ephemeral session-pseudonyms instead of
  routing on real pubkeys.

Closest analogues:
- Dating-app mutual-swipe (both sides opt in before contact).
- Tor onion services (anonymous routing, but no bilateral
  identity-reveal step).
- Blind-signature credential systems (can prove "I'm a member"
  without revealing which member).

The four phases of the protocol (sketch — needs design):

1. **Skill listing.**  Provider's agent registers a skill with the
   relay along with a posture flag (`always` / `negotiable`).
   Listing carries an *ephemeral handle* signed by the relay
   ("this is a valid member, identity hidden") — not the
   provider's pubkey.
2. **Browsing.**  Requester queries the relay for skills matching
   a description.  Returns ephemeral-handle listings.
3. **Request.**  Requester sends a question against an ephemeral
   handle.  Relay forwards to the provider, also under an
   ephemeral handle.  Both sides see only the relay-issued
   handles.
4. **Mutual consent → reveal.**  If provider accepts AND
   requester confirms (or vice versa), an "identity-reveal"
   exchange happens: each side shares their actual pubkey,
   signed against the previously-used ephemeral handle, so each
   can verify the other was the entity they were just talking
   to.

After phase 4 the conversation continues over the normal native
protocol with each peer's real pubkey known to the other.

### Tensions / still-open choices

- **Who issues the ephemeral handles?**  Relay does (knows
  membership); but that gives the relay correlation power.
  Mitigation: relay only sees handle ↔ pubkey at the moment of
  reveal; before reveal, the mapping is encrypted client-side.
  This is non-trivial cryptography — worth its own design doc.
- **What "added to the relay" means.**  Three governance
  models:
  - Operator-controlled: one admin manually adds members.
  - Invite-link: existing members issue invite tokens.
  - Web-of-trust: any member can vouch; new joins surface to the
    group for review.
  **Question: which governance shape?**
- **Geographic / topical scoping.**  "Neighborhood" implies a
  single closed group.  What about belonging to multiple groups
  (block + sports club + family)?  Same agent participates in
  many; the matchmaking is per-group.  The anonymity model is
  per-group too — your handle in the block is unrelated to your
  handle in the sports club.
- **Persistence of unanswered requests.**  If your agent is
  offline when a question comes in, do you see it later?
  Implies a relay-side queue with multi-recipient semantics —
  fan-out to all skill-holders, fan-in for any-one-replies.
- **Notification UX.**  Interactive prompts means the receiver's
  agent has to *interrupt* the user.  On a phone that means push
  notifications (iOS APNs / Android FCM) — which means a backend
  bridge, since the phone agent isn't always online.
  **Acceptable architectural cost?**

### Concerns

- **Spam.**  Closed group helps, but a single bad actor can
  flood.  Need rate limits at the relay AND opt-out per skill at
  the agent.
- **Anonymity vs. abuse.**  If the relay can't tell who's
  requesting (only that it's a member), abuse-tracing is harder.
  Need a "graceful identity-reveal" path the relay operator can
  invoke under defined circumstances (e.g. complaint from
  multiple members).  Tradeoff vs. pure anonymity needs explicit
  policy.

---

## 3. Document import bridge

### Sketch (original, pass 2)

> Een app (met agent) die documenten ophaalt van bijv google
> docs, zoveel mogelijk omzet naar md en die upload naar solidpod
> (of opslag waar de pod naar verwijst).  Moet steeds meer
> compatibel worden met andere documentsystemen.  Waarbij het dan
> weer in app 1 gebruikt kan worden.  Dit zou lokaal moeten kunnen
> draaien, maar logischer is natuurlijk in de cloud.  Het zou ook
> moeten kunnen listenen naar alles wat er geupload wordt en dat
> doorsturen.  Comments en afbeeldingen zouden op een losse
> manier geimporteert moeten worden, maar dat is denk ik prima te
> doen in solid-pod structuur (slaat het ergens op om solidpods
> als directe opslag te gebruiken of is het altijd een
> referentieboek?).

### Reading (English)

An agent whose job is "see a Google Doc URL, fetch it via Google's
API, convert to markdown, write to the user's Solid pod (or to
the storage the pod refers to)."  Over time, expand to other
sources: Notion, Dropbox Paper, Office 365, OneNote, Roam, etc.
The user-facing app in #1 then sees the imported content as
just-another-markdown-file.

Two operational modes:
- **Local agent** with local OAuth flows per source service.
  Tokens stay on-device.
- **Cloud agent**, more logical for scale.  Holds OAuth tokens for
  many users; standard SaaS posture.

Plus a **sync mode** — listen to all uploads (e.g. via Google
Drive change-notification API) and forward incrementally.

Comments and images imported "separately" — i.e. as adjacent files
or pod entries, not embedded in the main markdown blob.

### What's resolved in pass 2

- **Both local and cloud are allowed.**  Cloud is the default for
  scale; local for users with strong on-device-data preference.
  The agent must work in either deployment.
- **Sync mode is required, not just one-shot import.**  Implies
  webhook / poll loop, change-detection, conflict-resolution
  semantics.

### NEW question (raised by the author)

> "slaat het ergens op om solidpods als directe opslag te
> gebruiken of is het altijd een referentieboek?"
> *Does it make sense to use Solid pods as direct storage, or
> are they always a reference book?*

The honest answer is **both, depending on payload size.**
Solid pods CAN store any binary blob, but in practice:

- **Direct storage is fine for:** markdown text, JSON metadata,
  small images (<1 MB), comment threads, structured data.  Solid
  pod servers handle these at the same scale as a small-file
  HTTP server.
- **Reference book is better for:** videos, large images,
  binary archives, anything past a few MB.  The pod stores a
  manifest (URL + content hash + access policy) pointing at S3 /
  Drive / Dropbox / IPFS / wherever.  The pod controls the access
  policy; the underlying blob lives elsewhere.

For document import (use case #3), the natural pattern:
- The .md text → direct storage in pod.
- Embedded images → reference (with hash + size + ACL stored in
  pod, blob in linked storage).
- Comments → direct storage (small JSON entries).

So pods are **mostly direct storage with reference fallback for
heavy binaries.**  Worth documenting as a default convention so
all four use cases follow it consistently.

### Tensions / still-open choices

- **One-shot vs. ongoing sync.**  Sync requires polling or webhook
  for updates, change detection, conflict resolution if both
  sides edit, deletion semantics.  Big jump in complexity over
  one-shot import.  **Question: ship one-shot first, sync later?
  Or design both up front?**
- **Conversion fidelity.**  Google Docs → md is lossy (comments,
  suggestions, embedded images, custom styles).  Per pass 2
  these are imported "separately" — but **what's the schema for
  separately-imported comments?**  A `comments.json` next to the
  `.md`?  Solid LDP container with one resource per comment?
  Worth defining once across import sources so app #1 has one
  pattern to render.
- **Authentication chain.**  The import agent needs OAuth for each
  source service.  The pod needs Solid OIDC.  So the agent ends
  up holding multiple sets of credentials.  How does the SDK's
  `Vault` handle this — separate vault entries per service, or a
  composite `oauth-tokens` blob?
- **Deletion semantics for sync.**  If a Google Doc is deleted,
  what happens to the imported markdown?  Soft-delete in pod
  (mark as archived)?  Hard-delete?  User-configurable?

---

## 4. Task / workflow app with skill-based dispatch — multi-tenant

### Sketch (original, pass 2)

> Een taken-app waarmee zowel mensen (agents) als devices (agents)
> taken van kunnen claimen/uitvoeren en dat wanneer de
> dependencies van een taak zijn vervuld automatisch de nieuw
> beschikbare taak wordt gepusht naar de relevante agents (of dit
> nu mensen of machines zijn).  Dit zou moeten kunnen werken voor
> huishoudens, bedrijven, vriendengroepen,
> buurtonderhoudgroepen (mix van bedrijven en vrijwilligers).

### Reading (English)

A shared task list among a group.  Tasks have dependencies — a
DAG.  Tasks have skill requirements — "needs someone-who-can-paint",
"needs a 3D-printer-equipped-machine".  When a task's dependencies
are met, the system pushes the task to all agents (human or
device) that match the skill, and one of them claims it.

**Multi-tenant scope:** must work for households (4–6 people, high
trust, casual), businesses (5–500, formal SLAs, role-based), friend
groups (10–30, medium trust, social), neighborhood maintenance
(50–500, mixed-trust, mix of companies and volunteers).

### What's resolved in pass 2

- **Multi-tenant is a hard requirement.**  Implies the system
  must support different governance models per group.
- **Group-roles are needed.**  Not just "is a member of group X"
  but "what role within X" — admin / coordinator / member /
  observer / external-volunteer.  Maps onto skill-visibility +
  task-claim policy.

### Tensions / still-open choices

- **Where does the task ledger live?**  Three options, scaled
  to context:
  - Shared Solid pod (use case #1 territory) — works for
    households and small friend groups.
  - CRDT replicated across all participating agents — robust
    for medium-size groups, intermittent connections.
  - "Project-leader" agent owns the canonical state, others
    sync — works for businesses with clear hierarchy.
  Probably **one model, with the choice configurable per group.**
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
  off" — same posture flag as use case #2's `always` /
  `negotiable`.
- **Task lifecycle.**  Beyond claim/complete: cancel, reassign,
  fail-and-retry, partial completion (multi-part tasks), audit
  trail.  Depth of model needed?
- **Privacy.**  Does every group member see every task?  Or are
  tasks scoped (this task is for the kitchen-renovation crew
  only)?  Sounds like Group X visibility filtering applies, but
  with the **role** dimension added.

### NEW: roles within a group

Pass 2's scope expansion ("households, companies, friend groups,
neighborhood mix") implies the SDK needs **role-aware groups**,
not just flat membership.  Group X (group-visibility) gets you
"member of group X yes/no"; this needs:

- Roles per group: `admin`, `coordinator`, `member`, `observer`,
  `external-volunteer`, custom-app-defined.
- Per-role permissions: who can create tasks?  who can claim?
  who can see all-tasks vs. assigned-tasks?  who can promote
  someone else's role?
- Role assignment is a signed credential, much like
  capability tokens but scoped to a group.
- Roles compose: a person can be `admin` of household-X and
  `member` of neighborhood-Y at the same time.

This is a generalization of the existing trust-tier system
(`anonymous` < `authenticated` < `trusted` + group-membership)
that adds an in-group axis.

---

## Cross-cutting threads (refined)

| Theme | Use cases | What the SDK might need |
|---|---|---|
| **Shared mutable state across agents** | 1 (collab docs), 4 (task ledger) | Either CRDT primitive, or a "shared object" backed by the pod with conflict callbacks.  Pod-as-direct-storage is the default; reference for big blobs. |
| **Skill-based broadcast / matchmaking** | 2 (neighbor questions), 4 (task dispatch) | A pub/sub-of-skills primitive (`broadcast(skillId, payload)` → arrives at every peer that has registered `skillId`); maybe extend `pubSub.js` |
| **Skill posture flag** (always-callable vs. negotiable, machine vs. human) | 2, 4 | Extend `agent.register(id, handler, { posture: 'always' \| 'negotiable', humanInTheLoop: bool })` |
| **NEW: anonymous discovery + bilateral identity reveal** | 2 | New protocol layer above sealed-forward.  Relay issues ephemeral handles; mutual-consent reveal exchange.  Worth its own design doc (`Design-v3/anonymous-marketplace.md`). |
| **NEW: role-aware groups** | 4, partially 1 (collab access) | Extend Group X with per-role credentials.  Per-role permissions on skills + content. |
| **Closed-group membership with invitation governance** | 2, 4 | Relay-side allowlist + invite-token issuance (already on the relay roadmap); still need to decide governance model (operator / invite / web-of-trust). |
| **Solid-pod-as-shared-storage** | 1, 3, 4 | Already in `packages/core/src/storage/SolidPodSource.js` and `SolidVault.js`.  Convention: direct storage for small/structured, reference for big blobs.  Document this once. |
| **Notifications / interrupts to humans** | 2, 4 | New: mobile push (APNs/FCM) bridge so phone agents can wake on incoming requests.  Single piece of new infra needed by 2/4 of the use cases. |
| **OAuth credential management** | 3 | Extend `Vault` to store per-service OAuth tokens.  Refresh-token handling.  Per-service vault namespacing. |
| **Sync vs one-shot operations** | 3 | New: a "live-sync skill" pattern — agent declares "I will keep X in sync with Y", with explicit conflict-resolution callbacks. |
| **Versioning / history on shared documents** | 1, 4 (audit trail) | Append-only log alongside live state.  Could ride on the pod's natural revision tracking. |

---

## Open questions (priority order, refined for pass 2)

Answered in pass 2 (struck through):

- ~~For #1, is "skills stored in the pod" reading (a) [data] or
  (b) [callable code]?~~ → (a): just data.
- ~~For #2, primary unit of broadcast — interactive prompts to
  humans, or auto-executing skill calls between agents?~~ →
  Both, distinguished by per-skill posture flag.
- ~~For #3, local-agent or cloud-hosted?~~ → Both modes
  supported; cloud is the default-for-scale.

Still open + new:

1. **For #1, what flavor of collaboration?**  PR-style
   forks/merges (lossless but async) vs Google-Docs realtime
   (CRDTs, heavy) vs middle ground.
2. **For #1, encryption-at-rest vs Obsidian compatibility — how
   to reconcile?**
3. **For #2, joining the closed group** — operator-managed,
   invite-link, or web-of-trust?
4. **For #2, the anonymous-marketplace protocol** — needs its
   own design doc.  Who issues handles, where they're stored,
   how reveal is mutually verified.  This is the largest new
   primitive across all four use cases.
5. **For #3, ship one-shot import first, sync later?  Or design
   both up front?**
6. **For #3, schema for separately-imported comments / images** —
   one pattern across all import sources.
7. **For #4, where does the task ledger live?**  Pod / CRDT /
   leader-agent, configurable per group?
8. **For #4, role model** — minimal set of standard roles, or
   fully app-defined?
9. **Across all four — is mobile-push-notification a hard
   requirement?**  Main new-infrastructure piece these use cases
   imply, alongside the production relay.
10. **Across all four — Solid-pod-as-direct-storage convention** —
    document once; agree on small/structured = direct, big
    binaries = reference.

---

## Next step

Once the ten questions above have answers, the follow-up doc maps
refined use cases to:

- **App-level work** — what each app needs to build itself,
  including UI, app-specific skills, OAuth flows for source
  services, etc.
- **SDK additions** — what `@canopy/core`, `@canopy/react-native`,
  `@canopy/relay` need to grow to support these apps.  Rule:
  SDK additions must be useful for **at least two** of the four
  use cases (or one use case + a clear common pattern outside
  this list), to avoid app-specific bloat.

The two probable separate design docs spinning out of this
working doc:

- **`Design-v3/anonymous-marketplace.md`** — the new privacy
  protocol from #2.  Largest novel primitive; deserves dedicated
  thought.
- **`Design-v3/role-aware-groups.md`** — the role/permission
  generalization of Group X needed by #4.  Smaller scope, but
  a real extension to the existing trust model.
