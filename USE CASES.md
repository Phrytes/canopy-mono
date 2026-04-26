# Use cases — working document

**Status:** in-progress design dialogue.  Started 2026-04-25,
refined 2026-04-25 (pass 2), refined 2026-04-25 (pass 3).

This doc captures four use case sketches the author proposed before
committing to more technical work.  The use cases will shape SDK
priorities, particularly around: shared mutable state, skill-based
broadcast / matchmaking, **anonymous discovery with bilateral
identity-reveal handshake (NEW, parked)**, multi-tenant group
governance, mobile push, and Solid-pod ergonomics.

Two passes:

1. **Refine the sketches** (this doc).  Surface tensions, ask
   clarifying questions, list additions worth considering.  No
   commitment to system changes yet.
2. **Translate to integral improvements** (follow-up doc, structure
   sketched at the bottom of this file).  Map refined use cases
   onto:
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
> anderen, bijv documenten voor samenwerking of zelfs
> een blog.
>
> Vervolgens dat een app als obsidian die pod gewoon kan aanroepen
> als md-files en synchroniseren enzo.
>
> Uiteindelijk zou je er ook in willen kunnen samenwerken, zoals in
> google docs, eenvoudig forks/kopieen maken enzo.

> punt is, uiteindelijk wil je gewoon dat je met je agent bij je documenten kunt en je wilt erin kunnen samenwerken, los van bijv. Google

### Reading (English)

A **local-on-device** private agent that owns (or has access to)
the user's Solid pod.  It can selectively expose parts of that pod
to other agents — turning the pod into a permissioned knowledge
store you can collaborate on, like *collaboration docs* or *a blog*.
End-state: forks, shared editing, multi-user collaboration on
documents.

### What's resolved in pass 3

- **Real-time collaboration is the target.**  Hard but not
  impossible.  Won't be home-grown — instead **integrate with an
  existing open-source Google-Docs-like tool** that already does
  real-time + versioning.  We don't have the capacity to maintain
  a docs program as a side-project.
- **Solid is the storage spine.**  Other agents request shared
  content from the pod via Solid; the integrated docs tool's
  files live there too.  Solid is a hard dependency for this
  use case.
- **Encryption by default; plaintext only when public.**  Private
  content is encrypted at rest in the pod (envelope encryption,
  encrypted to the user's agent key).  Public content (e.g.
  blogs) lives in plaintext in a public-readable container.
- **Versioning** is delegated to whichever OSS docs tool we
  integrate — most candidates do this natively.  No need for
  the SDK to add a versioning primitive.
- **Obsidian is inspiration, not the integration target.**  It's
  the author's current go-to for markdown editing; the integration
  target is the OSS collab tool.  Obsidian could later be wired
  via a sync-to-local-vault path if useful.
- **Blog** is a public-readable subset of the pod.  No feed
  needed — it's just a public ACL on a container; readers
  navigate it.  Anyone in the trusted groups (or anonymous, if
  fully public) can read.

### Candidate OSS docs tools (for evaluation at decision time)

- **Cryptpad** — open-source, end-to-end encrypted, real-time
  collab on markdown / rich docs / spreadsheets / kanban.
  Encryption is built in, which matches the encryption-by-
  default requirement.  Closest fit on paper.
- **HedgeDoc** (formerly CodiMD) — markdown-focused, real-time,
  simpler than Cryptpad, no built-in encryption (would need to
  add it).
- **Etherpad** — most mature for real-time text collab; plain
  text + plugin system; less doc-shaped (no headings, no
  attachments by default).

Alternatives: 
- Nextcloud → full API, but less zero-knowledge
- Outline → API-friendly docs
- Appwrite → structured data + APIs

The integration question becomes: which of these has a sync /
storage layer pluggable enough to point at a Solid pod?
Cryptpad's storage is opaque (encrypted blobs server-side) —
swapping in a pod is non-trivial.  HedgeDoc / Etherpad use a
database — also non-trivial to redirect at a pod.  **All three
need real evaluation work.**  Decision deferred to the
improvements-doc pass, but worth queuing as an explicit
investigation item.

### Tensions / still-open choices

- **Encryption-at-rest vs. third-party-tool compatibility.**  If
  the OSS docs tool's storage layer doesn't support encryption,
  we either (a) accept that the docs tool's host can read the
  content, (b) add encryption between the tool and the pod, or
  (c) only use encryption for content the docs tool doesn't
  touch.  Decision per chosen tool.
- **Where does "the integrated tool" run?**  Hosted instance
  per-user (cloud, like a Cryptpad SaaS), self-hosted
  (Docker/VPS, full control), or local (on the same device as
  the agent — possible for HedgeDoc, harder for Cryptpad).
  Tradeoff: cloud is easy but introduces a server you don't
  trust; local is decentralization-aligned but a setup tax for
  the user.
- **Sharing semantics.**  Solid's WAC/ACP gives you per-document
  ACLs.  The OSS tool's permission model may or may not match.
  When they don't, the source of truth has to be one or the
  other (probably the pod, with the tool reading ACLs from
  there).

### What no longer applies

- ~~Whether "skills stored in the pod" means data or callable code~~
  → resolved in pass 2 (data only).
- ~~PR-style forks vs realtime CRDTs~~ → resolved pass 3:
  realtime, via OSS tool.
- ~~Whether the SDK needs a CRDT dependency~~ → resolved pass 3:
  no, the OSS tool brings its own.

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

> wellicht tijd voor een clustering van skills: technisch, menselijk, app-gerelateerd
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

**Anonymity model:**
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

### Status (pass 3)

The anonymity model is **parked for now**.  the author has thoughts to
share later on the open concerns (relay correlation power,
abuse-tracing tradeoff, governance model).  Until those land,
this is the largest novel primitive across all four use cases
and won't be designed in detail.

The other parts of #2 are clear:

- **Both broadcast forms are needed** — interactive prompts
  (negotiable skills) AND direct skill calls (always-available
  skills).  The SDK needs both.  Per-skill posture flag.
- **Human skills are first-class.**  Skill registration must
  carry a `humanInTheLoop: true` flag.  Listings need to
  surface this so requesters know what to expect.

These two are what overlaps with use case #4 — both need
skill-broadcast + posture-flag + push-notification.

### NEW: anonymity-with-mutual-consent — its own protocol layer (parked)

This is the architecturally novel part.  It's not covered by the
existing relay-forward / sealed-forward / hop-tunnel stack:

- relay-forward: bridge sees content (relay sees envelope, may
  see payload if not sealed).
- sealed-forward: bridge cannot read content; *identity is still
  attached*.
- This new layer: **identity is hidden from everyone except the
  relay** until both parties consent.  Relay vouches for
  membership but issues ephemeral session-pseudonyms instead of
  routing on real pubkeys.

The four phases of the protocol (sketch — needs design when
unparked):

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

Open at unpark time:
- Who issues the ephemeral handles? (relay correlation power)
- Governance model: operator-managed / invite-link / web-of-trust?
- Geographic / topical scoping (multiple groups per agent)
- Persistence of unanswered requests
- Notification UX (mobile push)
- Spam, abuse-tracing, "graceful identity-reveal" policy

These were all flagged in pass 2.  the author has thoughts to share
on them when this is unparked.

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

> later ook voor whatsapp (waarbij je misschien een agent je berichten kunt laten exporten, die export ophalen en die weer omzetten naar json met die ene github-applicatie). Moet rekening houden met overlap/duplicaten tussen berichten

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

### What's resolved in pass 3

- **Both local and cloud are allowed.**  Cloud is the default for
  scale; local for users with strong on-device-data preference.
  The agent must work in either deployment.
- **Sync mode is required, not just one-shot import.**  Implies
  webhook / poll loop, change-detection, conflict-resolution
  semantics.
- **Pod-storage convention adopted** (per the author's agreement
  pass 3): **direct storage for small/structured content
  (markdown, JSON metadata, small images < 1 MB, comment
  threads), reference for big binaries (videos, large images,
  archives — pod stores manifest pointing at S3 / Drive /
  Dropbox / IPFS).**  This is now a **default convention used
  by all four use cases** — not just #3.

### Open at improvements-pass time

- **One-shot vs. ongoing sync.**  Sync is a big complexity jump
  (polling/webhook, change detection, conflict resolution if
  both sides edit, deletion semantics).  Question: ship
  one-shot first and grow into sync, or design both up front?
- **Schema for separately-imported comments / images.**  A
  `comments.json` next to the `.md`?  Solid LDP container with
  one resource per comment?  Worth defining once across import
  sources so app #1 has one pattern to render.
- **Authentication chain.**  The import agent needs OAuth for
  each source service.  The pod needs Solid OIDC.  How does
  the SDK's `Vault` handle multiple credential namespaces —
  separate vault entries per service, or a composite
  `oauth-tokens` blob?
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

### Status

No new input from the author in pass 3.  Open questions from pass 2
remain:

- Where does the task ledger live? (pod / CRDT / leader-agent,
  configurable per group)
- Claim semantics (distributed lock vs. optimistic claim)
- Push semantics — same primitive as #2's skill-broadcast
- Human vs. device agents — same posture flag as #2
- Task lifecycle depth (cancel, reassign, retry, partial,
  audit trail)
- Privacy + role-based visibility on tasks

### NEW: roles within a group (carried from pass 2)

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

## 5. Archive app — search and browse the migrated data

### Sketch (added 2026-04-26)

> Find all kinds of data imported from external services
> (gdrive, docs, ms counterparts, whatsapp etc) in a solid pod
> and make them searchable.

### Reading (English)

The natural pairing of #3.  #3 *gets data into the pod*; #5
*makes it useful*.  A local-on-device app that sits on top of
the user's Solid pod and lets them browse, search, and link
across everything that's been imported — emails, photos,
documents, messages, calendar events, contacts, social posts,
etc.  **API-first** (per the author's framing): the archive
registers a small set of agent skills (`search`, `list`, `get`,
`timeline`, `related`, `share`, `ingest`, `annotate`, `link`,
`tag`, …) that any consumer (a GUI, a CLI, another agent, an
LLM) reaches the same way.  GUI is a later layer on top.

### Status

Scope sketched in
[`projects/05-archive-app/README.md`](./projects/05-archive-app/README.md),
which holds the full API draft, data-model proposal,
pod-layout sketch, search-implementation choice (SQLite FTS5
for v1, embeddings for v2), encryption / sharing model, and
GUI considerations (deferred).

### Overlap with other use cases

- **Strong overlap with #3** — same agent ecosystem, with #3
  upstream of #5.  Connectors call `archive.ingest`; the
  archive doesn't fetch upstream itself.
- **Partial overlap with #1** — both consume content from the
  pod.  The notes app (#1) is focused on *editing*; the archive
  (#5) is focused on *querying / browsing*.  Could share the
  same pod backing.
- **Sharing flow reuses CapabilityToken** infrastructure from
  the SDK (already present), bridging to existing skill-call
  semantics.

### What's resolved

- API-first.  GUI later.
- Read-side and write-side skills sketched (10+ skills).
- `ArchiveItem` schema + extensible type enum proposed.
- Pod layout: `/archive/sources/<source-id>/items/...` plus
  manifest, links, annotations, people directories.
- Search: SQLite FTS5 local-to-device for v1; embeddings for
  v2 (later).
- Encryption-by-ACL convention reused; sharing via
  CapabilityToken.

### Still-open questions

See [`projects/05-archive-app/README.md` § Open questions](./projects/05-archive-app/README.md).
Notable: identity reconciliation depth (auto / manual / both),
search index in pod or local-only, what happens to deleted-
upstream items, GUI tech-stack choice when that phase begins.

---

## 6. Proof of location — signed beacons + witness network

### Sketch (added 2026-04-26)

> Are there any open source initiatives to help prove (to some
> app) in a privacy-safe way, that you really are at a specific
> location?

Plus, on multi-signal approaches:

> I thought, maybe the combination of nearby wifi-networks,
> photos verified with weather info, parked license plates, or
> locally distributed regularly-updated qr codes could help for
> this goal.

### Reading (English)

A privacy-preserving proof-of-presence service.  Two layers:
**privacy** (prove "I am inside region X" without revealing
exact coordinates — Zero-Knowledge Proofs) and **authenticity**
(prevent the user from simply lying about where they are —
trusted hardware, witness networks, or radio beacons).  Most
research projects address one well and the other less well.
The recommended starting point is **multi-signal**: combine
weak signals (rotating-QR beacons, witness peers, signed sensor
data) into a stronger composite proof.

### Status

Scope sketched in
[`projects/06-proof-of-location/README.md`](./projects/06-proof-of-location/README.md).
Includes a landscape survey of existing projects (ZKLP, OLP,
POLP, FOAM, C2PA, Truepic), per-signal honest read on the
user's multi-signal ideas (WiFi fingerprinting, photos +
weather, license plates, rotating QR codes), a 4-layer
architectural decomposition, and a recommended v1 starting
point: **signed rotating-QR beacons + witness-network skill**,
deferring ZKP composition until there's a concrete need.

### Overlap with other use cases

- **Strong overlap with #2.**  Witness networks ARE skill
  matchmaking with `attest-presence` as the skill.  Reuses
  pubsub-of-skills, closed-group governance.
- **Strong overlap with #4.**  Role-aware groups weight witness
  signatures by trust.  Tasks can be claim-bound to presence
  attestations ("water the garden — only claimable if presence-
  attested at the garden").
- **Composable verification primitive.**  Becomes a building
  block other use cases consume; not a standalone app surface.

### What's resolved

- Two-layer problem decomposition (privacy + authenticity).
- Multi-signal composition is the right architecture.
- Layer 1 (signed rotating-QR beacon) + Layer 2 (witness skill)
  is the v1 scope.
- ZKP composition (Layer 4) deferred until a concrete consumer
  demands it.

### Still-open questions

See [`projects/06-proof-of-location/README.md` § Open questions](./projects/06-proof-of-location/README.md).
Notable: beacon hardware scope (ESP32 vs phone-to-phone),
trust model for beacon operators, witness-graph privacy,
anti-Sybil for witnesses, GUI for the beacon-tap flow.

---

## 7. Household app — chat-driven, LLM-mediated household state

### Sketch (added 2026-04-26, original Dutch)

> Een soort huisgenoten-app, bijv:
> - een telegramkanaal die je een appje kunt sturen met "we
>   hebben brood nodig"
> - dit wordt opgeslagen in een gezamenlijke pod (of een pod die
>   linkt naar items op individuele pods)
> - vóór je naar de winkel gaat: app het kanaal met "wat hebben
>   we nodig in de supermarkt?"
> - de llm filtert irrelevante huishoudelijke chat eruit en
>   stuurt de juiste lijst terug
> - na 30 min appt de llm wat er is afgewikkeld
> - de gebruiker antwoordt, llm vertaalt naar pod-updates

### Reading (English)

A bot in a household Telegram channel watches incoming messages.
A **local-LLM-mediated agent** classifies each message
(actionable / noise), extracts structured items from actionable
ones (shopping, repair, errand, schedule), stores them in a
shared household pod.  On retrieval ("what do we need at the
supermarket?"), it returns a clean filtered list.  After
completion, it follows up, captures what got done, updates pod
state.  **First app where the LLM is the agent's intelligence,
not just a tool.**

### Status

Scope sketched in
[`projects/07-household-app/README.md`](./projects/07-household-app/README.md).
LLM feasibility + monthly-cost analysis in
[`projects/07-household-app/llm-cost.md`](./projects/07-household-app/llm-cost.md):
local LLM is viable on a used Mac mini M2 (~€500 once + ~€2/mo
electricity) for production, anything-you-already-have for
testing.

### What's resolved

- **Telegram for v0** as the input channel; native protocol /
  Signal / Matrix later.
- **Local LLM is the default** (privacy-aligned with the rest
  of the project; cloud-API is opt-in only).
- **Shared household pod for v0**; per-housemate-pod-with-
  shared-references for v1 if privacy boundaries within the
  household become important.
- **Schema aligned with #4's task model** so households that
  grow into structured task management can migrate cleanly.

### Open questions

See [`projects/07-household-app/README.md` § Open questions](./projects/07-household-app/README.md).
Notable: one-pod-or-many, channel-to-pod mapping, tool-calling
shape (MCP-like vs custom), hallucination tolerance,
completion-loop cadence, multilingual handling.

### Why this is project #7 and not a variant of #4

**#4 is structured** — task DAG with skill requirements + claim
semantics + role-based permissions.  **#7 is freeform** —
ambient natural-language chat parsed by an LLM.  Different
acquisition pattern even though the post-extraction state model
overlaps.  Worth keeping the schemas aligned so they can
migrate one to the other if needed.

---

## Cross-cutting threads (refined for pass 3, refreshed for #5 + #6, expanded for #7)

Each row picks up new use-case touchpoints as the project list
has grown.  The "use cases" column is now denser; that density is
the signal that L0/L1/L2 layering pays off — the SDK additions
in the right column are mostly shared, not duplicated per app.

| Theme | Use cases | What the SDK might need |
|---|---|---|
| **Solid pod as shared storage with the convention** (small/structured = direct, big = reference) | 1, 3, 4, 5, 7 | Already in `packages/core/src/storage/SolidPodSource.js` and `SolidVault.js`.  Convention is now binding across use cases.  Document once. |
| **Pod ↔ local-folder sync (translation layer)** | 1 (V0), 7 (household pod synced across phones / laptops) | New: a sync-skill pattern.  Watches a local folder + a pod container, propagates changes both ways.  Last-write-wins for v0; conflict UI later. |
| **OSS-doc-tool integration for real-time collab** | 1 (V1) | App-level integration work; the SDK does NOT need a CRDT primitive.  Investigation item: which OSS tool, how to plug pod as backing store. |
| **Encryption at rest + public-content override** | 1, 3, 4 (audit trail privacy), 5 (archive items encrypted; public sub-set plaintext), 7 (household pod encrypted to household-group key) | Envelope encryption per pod-resource.  Per-resource ACL determines whether decryption happens at all (public = plaintext stored, private = encrypted to user's agent / group). |
| **CapabilityToken-based attestation / sharing** | 5 (share archive items with peer), 6 (signed-beacon presence claims, witness attestations), 7 (Telegram-bot agent authorises against household pod) | Already exists in `packages/core/src/permissions/CapabilityToken.js`.  Need standardised usage patterns: short-lived tokens for ephemeral shares (#5); signed-beacon-as-token (#6 layer 1); aggregate-witness-tokens (#6 layer 2); bot-agent-bearer (#7). |
| **Skill posture flag** (always-callable vs. negotiable, machine vs. human) | 2, 4 | Extend `agent.register(id, handler, { posture: 'always' \| 'negotiable', humanInTheLoop: bool })` |
| **Skill-based broadcast / matchmaking** | 2 (neighbor questions), 4 (task dispatch), 6 (witness-network presence challenges) | Pub/sub-of-skills primitive (`broadcast(skillId, payload)` → arrives at every peer that has registered `skillId`); maybe extend `pubSub.js` |
| **Mobile push (APNs/FCM) for human-skill notifications** | 2, 4, 6 (wake witnessing agents) | New: backend bridge so phone agents can wake on incoming requests.  Single piece of new infra needed by 3 of the 7 use cases. |
| **Role-aware groups** (extension of Group X) | 4, 1 (collab access tiers), 2 (group governance), 6 (witness-trust weighting), 7 (household roles: member / admin / guest) | Per-role credentials within a group.  Per-role permissions on skills + content. |
| **Closed-group membership with invitation governance** | 2, 4, 6 (beacon-operator trust model), 7 (household membership) | Relay-side allowlist + invite-token issuance (already on the relay roadmap). |
| **OAuth credential management** | 3 | Extend `Vault` to store per-service OAuth tokens.  Refresh-token handling.  Per-service vault namespacing. |
| **Sync vs one-shot operations** | 3 (cloud-source sync), 5 (archive ingest from connectors), 1 + 7 (pod ↔ local-folder sync) | New: a "live-sync skill" pattern — agent declares "I will keep X in sync with Y", with explicit conflict-resolution callbacks. |
| **Anonymous discovery + bilateral identity reveal (PARKED)** | 2, partially 6 (anonymous witnessing as a privacy-of-the-witness-graph mitigation) | New protocol layer above sealed-forward.  Not designed yet; the author has thoughts to share when unparked. |
| **Identity reconciliation across sources** | 5 (same person via gmail / phone / pubkey) | Possibly L0 SDK primitive, possibly app-level.  Open question. |
| **Composable verification primitive** (proof-of-presence, proof-of-membership, proof-of-skill, …) | 6 (proof-of-presence as the first instance), potentially 4 (proof-of-skill for task claims) | New: a verification-token shape that other use cases consume.  App-level for now; could become an L1 building block once a second use case demands the same shape. |
| **LLM-mediated agent** (the agent's intelligence is an LLM) | 7 (household chat → extraction → pod state) | New: idiomatic "register a skill where the implementation is an LLM with these other agent skills as tools."  Possibly L1 helper; possibly app-level wrapper.  Tool-catalog accessor on `SkillRegistry` for the LLM to introspect available skills.  L0. |
| **External chat-channel bridge** (Telegram, Signal, Matrix, Discord) | 7 (Telegram first) | New: a bridge-agent pattern that translates external-platform messages into native skill calls.  App-level for one platform; promote to L1 if a second platform follows.  Closest analogue: `A2ATransport` for HTTP, but chat-bots are a different shape (long-poll / webhook, bot tokens). |

### Notes on the refresh

- **Pod-storage and encryption-at-rest** now reach 5 of 7 use
  cases each.  These are the strongest "L0 SDK convention"
  candidates — the cheapest things to make binding because
  they're already mostly built.
- **Skill matchmaking + push + role-aware-groups + closed-group
  governance** form a tight cluster used by #2, #4, #6, and
  partially #7.  They constitute the **"L1 skill-matchmaking
  building block"** proposed in the pass-3 structural decision.
  Building it once unlocks four apps.
- **CapabilityToken** is already implemented — what's missing
  is standardised *usage patterns* for the new shapes (#5's
  share flow, #6's beacon and witness tokens, #7's bot-agent
  bearer).  No new cryptography needed.
- **Pod ↔ local-folder sync** (new row from #1's V0 + #7) is
  more concrete and immediate than the abstract "sync vs.
  one-shot" theme.  Probably its own L1 building block.
- **LLM-mediated agent + external chat-channel bridge**
  (new rows from #7) are genuinely new themes the project list
  hadn't surfaced before.  Both are app-level for now, but
  they imply the SDK should make the skill registry more
  introspectable (so an LLM can enumerate available tools at
  runtime).
- **Identity reconciliation** (new row from #5) is still the
  only fundamentally novel SDK question that the project list
  raises beyond what was already on the table.  Worth its own
  design
  pass when #5 thaws.
- **Anonymous discovery** (parked) is now also relevant to #6
  for witness-graph privacy.  When it unparks, the design
  serves both #2 and #6.

---

## Open questions (priority order, refined for pass 3)

Resolved in earlier passes (struck through):

- ~~For #1, "skills stored in the pod" — data or callable code?~~ → data only.
- ~~For #2, primary unit of broadcast — interactive prompts vs.
  auto-executing skill calls?~~ → both, posture flag distinguishes.
- ~~For #3, local-agent or cloud-hosted?~~ → both, cloud is default.

Resolved in pass 3:

- ~~For #1, what flavor of collaboration?~~ → real-time, via OSS
  tool integration.  No CRDT in the SDK.
- ~~For #1, encryption-at-rest vs Obsidian compatibility?~~ →
  Obsidian is inspiration only, not the integration target.
  Encryption is per-resource based on ACL (public = plaintext,
  private = encrypted).
- ~~For #3, pod-storage convention?~~ → adopted: direct for
  small/structured, reference for big binaries.

Still open + new:

1. **For #1, which OSS docs tool to integrate with?**  Cryptpad
   is the front-runner on encryption alignment; HedgeDoc and
   Etherpad need more eval.  Investigation item, not a design
   question yet.
2. **For #1, how to plug a Solid pod as the OSS tool's backing
   store?**  Likely the deciding factor between candidates.
3. **For #2, anonymity protocol** — parked, the author has thoughts.
4. **For #2, joining the closed group** — operator-managed,
   invite-link, or web-of-trust?  (Carries from pass 2.)
5. **For #3, ship one-shot import first, sync later?**  Or
   design both up front?
6. **For #3, schema for separately-imported comments / images.**
7. **For #4, where does the task ledger live?**  Pod / CRDT /
   leader-agent, configurable per group?
8. **For #4, role model** — minimal set of standard roles, or
   fully app-defined?
9. **Across all four — is mobile-push-notification a hard
   requirement?**  Main new-infrastructure piece, alongside the
   production relay.

---

## Pass-3 structural decision: shape of the improvements doc

the author noted in pass 3 that there's clear overlap between
**#2 ↔ #4** (skill broadcast / matchmaking / push / group
governance) and arguably between **#1 ↔ #3** (document handling /
Solid pod / encryption).  The improvements doc should be
structured to honor that overlap explicitly so we don't write
the same SDK additions twice or scatter them across use cases.

**Proposed structure: three layers, deepest first.**

### Layer 0 — SDK primitives (lowest-level additions)

Things that live in `@canopy/core`, `@canopy/react-native`,
or `@canopy/relay`, used by multiple consumers, with one
specification per primitive.  Each primitive is justified by
≥2 use cases (or ≥1 use case + a clearly common pattern outside
this list).

Concrete L0 candidates from pass 3 cross-cutting table:

- Skill posture flag (`always` / `negotiable`, `humanInTheLoop`).
- Skill-broadcast / pubsub-of-skills primitive.
- Mobile push (APNs/FCM) bridge.
- Role-aware groups (extension of Group X).
- OAuth credential management in `Vault`.
- "Live-sync skill" pattern (with conflict-resolution callbacks).
- Encryption-by-ACL convention on pod resources.
- Pod-storage convention (small = direct, big = reference) —
  already adopted as a default; just needs to be documented.
- (Parked) anonymous-marketplace protocol.

### Layer 1 — Cross-cutting building blocks (compositions)

Bigger pieces that compose primitives, used by multiple use
cases.  Each is built once.

Concrete L1 blocks from the use cases:

- **"Skill matchmaking"** = skill-broadcast + posture flag +
  mobile push + role-aware groups + closed-group membership.
  Used by #2 (neighborhood) and #4 (task dispatch).
- **"Shared pod-backed content"** = Solid integration +
  encryption-by-ACL + reference-storage + pod-as-API surface
  for other agents.  Used by #1 (consumer) and #3 (producer).

### Layer 2 — Per-use-case specifics (what's unique per app)

What each app needs uniquely on top of L0+L1.  These live in
`apps/*` and are NOT SDK additions — they're the surface area
each app builds itself.

Concrete L2 specifics:

- #1 picks an OSS docs tool (Cryptpad / HedgeDoc / Etherpad),
  integrates its sync layer with the pod, builds the
  notes/projects UI, exposes the public-blog subset.
- #2 builds a neighborhood UI on top of skill matchmaking +
  the (parked) anonymity protocol.  Onboarding flow for
  invite codes.  Skill-listing UX with anonymous browsing.
- #3 holds OAuth tokens for source services, runs conversion
  pipelines (Google Docs / Notion / etc. → markdown), watches
  for changes, writes to pod.
- #4 builds a task DAG executor on top of shared pod-backed
  content + skill matchmaking + role-aware groups.  Task UI,
  claim flow, dependency visualization.

### Why this structure works

- Overlap between #2 and #4 surfaces as one shared L1 block
  ("skill matchmaking"), built once.
- Overlap between #1 and #3 surfaces as another L1 block
  ("shared pod-backed content"), built once.
- L2 makes the unique parts of each app explicit so we don't
  bloat the SDK with app-specific code.
- The "SDK additions must be useful for ≥2 use cases" rule maps
  to L0/L1; L2 is purely app-level.

---

## Next step

When the still-open questions above (especially #4–#8 — the
ones that affect the SDK shape) have working answers, write
the improvements doc using the three-layer structure proposed
above.  The two parked design docs spinning out:

- **`Design-v3/role-aware-groups.md`** — the role/permission
  generalization of Group X needed by #4.  Bounded scope,
  ready to design when #4's role-model question is answered.
- **`Design-v3/anonymous-marketplace.md`** — the new privacy
  protocol from #2.  Currently parked; the author has thoughts to
  share when unparked.
