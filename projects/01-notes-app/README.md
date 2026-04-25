# 01 — Notes / documents / projects app

**Use-case section:** [`../../USE CASES.md` § 1](../../USE%20CASES.md#1-documents--notes--project-files-app)
**Status:** pass-3 design dialogue.  Real-time collab via OSS-tool
integration is the chosen direction.  No code yet.

## In one paragraph

A local-on-device private agent that owns the user's Solid pod.
The pod is the single store of truth for personal documents,
notes, and project files.  Other agents request access to
selectively-shared content via Solid (e.g. collaboration docs, a
public blog).  Editing happens in an integrated open-source
Google-Docs-like tool that already does real-time collab +
versioning — we don't reinvent that.  Encrypted by default,
plaintext only when public.

## Resolved direction (pass 3)

- **Real-time collab via integration with an existing OSS docs
  tool**, not home-grown CRDTs.  Side-project capacity does not
  cover building a docs editor.
- **Solid pod is the storage spine.**  The OSS tool's files live
  there, and other agents access via Solid.  Pod-storage
  convention: small/structured = direct, big binaries = reference.
- **Encryption by default.**  Per-resource: public ACL = plaintext
  in pod; private ACL = encrypted to user's agent key.
- **Versioning is delegated** to the OSS tool — most candidates
  do this natively.  No SDK-side versioning primitive needed.
- **Obsidian is inspiration, not the integration target.**
- **Blog** = public-readable subset of the pod.  No feed needed.

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

## Related work in the repo

- `packages/core/src/storage/SolidPodSource.js` — pod read/write
  primitives.
- `packages/core/src/identity/SolidVault.js` — Solid OIDC for
  auth.
- `Design-v3/` — protocol-level designs.  The notes-app sits
  *above* these.
