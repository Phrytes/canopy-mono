# 01 — Notes / documents / projects app

## Opmerkingen
- voor samenwerking op documenten met peers, heb je eigenlijk wel een soort stream oid nodig. Zulke apps zou je idealiter ook op zo'n relayserver draaien. Met andere woorden: de relays zullen het alternatief voor clouddiensten vormen. En ipv dat alles daar opgeslagen is, kunnen ze vanuit je pod dingen ophalen. Wanneer je met twee personen samenwerkt, dan zou het logisch zijn dat die veranderingen realtime zichtbaar zijn in de online bewerker (liefst wel een opensource alternatief)
- achtergrondsynchronisatie is nog niet compleet
- staan de bestanden ook lokaal op de telefoon? 
- kan ik ook de locatie kiezen waar naartoe gesynct moet worden (op telefoon/pc etc)
- eigenlijk maakt het niet uit dat de syncer de bestanden onmiddellijk terugplaatst: wel of niet deleten zou bepaald moeten worden vanuit de interface



**Use-case section:** [`../../USE CASES.md` § 1](../../USE%20CASES.md#1-documents--notes--project-files-app)
**Status:** pass-3 design dialogue.  Real-time collab via OSS-tool
integration is the chosen direction.  No code yet.

**In het kort**
Eigenlijk wil je gewoon dat:
- je md-bestanden kunt bewerken en dat die weer in je pod komen. Dus een soort vertaallaag tussen opslag en app
- je agent ook md-bestanden kan schrijven in je pod. Heeft zelf die app niet nodig

## In one paragraph

A local-on-device private agent that owns the user's Solid pod.
The pod is the single store of truth for personal documents,
notes, and project files.  Other agents request access to
selectively-shared content via Solid (e.g. collaboration docs,
a public blog).

**V0 — translation layer.**  The simplest viable shape:
markdown files live in a local folder, the agent syncs that
folder bidirectionally with the pod.  Any markdown editor (the
user's existing Obsidian / iA Writer / VSCode / whatever) just
sees a folder of `.md` files.  The agent itself can also read
and write files in the pod directly without the editor running
— important because the household app (#7), the archive app
(#5), and the import bridge (#3) all need to write into the
same pod.

**V1 — real-time collab.**  Editing happens in an integrated
open-source Google-Docs-like tool that already does real-time
collab +
versioning — we don't reinvent that.  Encrypted by default,
plaintext only when public.

## Resolved direction (pass 3 + pass 4)

### V0 — pod ↔ local-folder sync (no real-time collab)

Build first because it's the foundational app: get markdown
content flowing between pod and devices.  Reuses any existing
markdown editor.  Ships in a few weeks; gives friends something
real to test with.

- **Translation layer** between pod and local filesystem.  The
  agent watches a local `~/notes/` folder and a pod container,
  syncs changes both ways.
- **Any editor works** because what the editor sees is just a
  folder.  Obsidian, iA Writer, VSCode, even plain `vim`.
  No editor lock-in.
- **Agent can write directly to the pod** without the editor
  running — important because #3 (import bridge), #5 (archive),
  #7 (household app) all write to the same pod.
- **Conflict policy:** last-write-wins for v0; surface a UI for
  conflicts later.  Deliberately punt on the merge problem in
  v0.
- **"Remove from local but keep in pod"** is a per-file flag in
  the file manager — supported via a sync-marker convention
  (file in pod stays; local file gets a placeholder or is
  dropped).
- **Encryption by default.**  Per-resource: public ACL =
  plaintext in pod; private ACL = encrypted to user's agent
  key.
- **Pod-storage convention** binding: markdown direct, big
  attachments as references.
- **Metadata lives in the data object, not in the file**
  (locked 2026-05-12). When a note carries structured metadata
  (title, tags, dueAt, …), it sits on the `note` data object in
  the pseudo-pod / pod — NOT in YAML frontmatter at the top of
  the `.md` file. The `.md` body is just the prose; metadata is
  carried alongside it on the canonical `note` item-type from
  `@canopy/item-types`. Reasons:
  - file operations stay simple (no frontmatter parser);
  - metadata can include rich types (arrays, refs, nested
    objects) without YAML's quirks;
  - cross-app embeds (Tasks pinning a note, Archive collecting
    notes) read structured metadata from the item-type schema
    without parsing markdown;
  - editors that don't understand frontmatter (or strip it on
    save) don't silently lose state.
  Editors that prefer frontmatter as an *authoring* affordance
  can still write it; the sync layer treats it as body — round-
  trip is byte-equivalent. If/when a use case actually needs
  frontmatter as the canonical metadata source, we revisit. See
  also `Project Files/Substrates/substrates-v2-coding-plan-
  2026-05-11.md` §52.7.3.

### V1 — real-time collab via OSS doc tool

Layered on top of V0 once the storage substrate is real.

- **Real-time collab via integration with an existing OSS docs
  tool**, not home-grown CRDTs.  Side-project capacity does
  not cover building a docs editor.
- **Versioning is delegated** to the OSS tool — most candidates
  do this natively.  No SDK-side versioning primitive needed.
- **Obsidian is inspiration, not the integration target.**
  V0 supports it via plain folder sync; V1 adds collaborative
  editing with a different tool.
- **Blog** = public-readable subset of the pod.  No feed
  needed.  Works at V0 (publish a folder); enriches at V1
  if the collab tool also handles publishing.

## Candidate OSS docs tools (to evaluate)

| Tool | Pros | Cons |
|---|---|---|
| **Cryptpad** | E2EE built in, real-time, markdown + rich + sheets + kanban | Storage layer is opaque encrypted blobs; pod swap non-trivial |
| **HedgeDoc** | Markdown-focused, real-time, simpler | No built-in encryption; database-backed, pod swap non-trivial |
| **Etherpad** | Most mature real-time text editor | Plain text + plugins; less doc-shaped; no native encryption |
| **Nextcloud** | Full WebDAV/CardDAV/CalDAV API | Not zero-knowledge — the host can read |
| **Outline** | API-friendly knowledge base | Less aligned with markdown-as-source-of-truth |
| **Appwrite** | Structured data + APIs | Not a docs editor — useful as a generic backend, not the editor itself |

**Investigation question:** which of these has a sync/storage
layer pluggable enough to point at a Solid pod?  Cryptpad
front-runner on encryption alignment but storage is opaque.

## Open questions

1. **Which OSS docs tool to integrate with?**
2. **How to plug a Solid pod as the OSS tool's backing store?**
   Likely the deciding factor between candidates.
3. **Where does the integrated tool run?**  Hosted SaaS (easy,
   trust required), self-hosted (Docker/VPS, full control), local
   (decentralization-aligned, setup tax for the user).
4. **Sharing semantics.**  Solid's WAC/ACP gives per-document
   ACLs.  When the OSS tool's permission model differs, source of
   truth probably stays the pod with the tool reading ACLs from
   there.

## What this app needs that the SDK doesn't have today

Pulled from USE CASES.md §1 + the cross-cutting threads table —
**none of these block this app's design phase**:

- Encryption-by-ACL convention on pod resources (L0 SDK primitive,
  shared with #3).
- Pod-storage convention (small=direct, big=reference) — already
  agreed pass 3, just needs documenting.
- Solid-pod read/write ergonomics — `SolidPodSource.js` and
  `SolidVault.js` exist; verification work, not new code.

What this app needs that's purely app-level:

- Glue code between the chosen OSS tool and the agent.
- Pod-as-storage adapter for the OSS tool (likely the biggest
  piece of L2 work).
- UI for navigating notes, projects, blog publishing.
- Sharing flow: "publish this note to my-friends-group" / "this
  blog post is public."

## Cross-app substrate compatibility (added 2026-05-07)

Tasks V1 (see [`../../Tasks App/advice-2026-05-07.md`](../../Tasks%20App/advice-2026-05-07.md))
flags one pattern relevant to the notes app:

- **Pod-data-sharing caution principles.** Whenever the notes
  app is asked to share a note with another agent (collaborator
  via the OSS-doc-tool, blog publication, fork-and-share), the
  same caution principles apply: explicit per-recipient opt-in,
  smallest derivative shared (link by reference, not by copy),
  audit trail of cross-pod reads, sign-off from the author before any
  *new* cross-pod flow ships. Same discipline as Tasks /
  Stoop / Household.

(The notes app is unlikely to consume the `getFreeBusy` /
`InAppInboxChannel` / DoD-lifecycle substrates Tasks V1
introduces; flagged here only for the pod-sharing discipline.)

## Related work in the repo

- `packages/core/src/storage/SolidPodSource.js` — pod read/write
  primitives.
- `packages/core/src/identity/SolidVault.js` — Solid OIDC for
  auth.
- `Design-v3/` — protocol-level designs.  The notes-app sits
  *above* these.
