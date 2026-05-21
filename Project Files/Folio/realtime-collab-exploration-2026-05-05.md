# Realtime decentralised document collaboration — exploration (2026-05-05)

> Speculative. Captures a "what would it take to do Google-Docs-style
> live collab over the @canopy SDK" brainstorm. Not a plan, not on
> the roadmap. Sibling to `sync-improvements-2026-05-05.md`.

## Verdict

Theoretically very feasible — the transport (P2P / mDNS / relay /
WebRTC) is already in the SDK and that's not the hard part. The hard
parts are (a) the convergent-editing layer and (b) the mobile
rich-text editor.

## The actually hard problem: convergent concurrent editing

Two keystrokes happening on different devices at the same moment have
to converge to the same document on every replica, with no central
server arbitrating. Two answers in the wild:

- **OT (Operational Transformation)** — what Google Docs uses. Requires a central server to linearise ops. Doesn't fit a P2P story.
- **CRDTs (Conflict-free Replicated Data Types)** — designed exactly for this. Every replica applies ops in any order and converges. The dominant text CRDTs:
  - **Yjs** — JS-first, battle-tested, tiny binary update blobs (~30–100 bytes per keystroke). De facto standard. The obvious pick for a JS/RN/web stack.
  - **Automerge** — Rust core + JS/Swift/Kotlin bindings. More "git-like" with history/branches. Heavier per-op.
  - **Loro**, **diamond-types** — newer, very fast, less ecosystem.

For markdown notes Yjs is the natural choice.

## How it would slot into the SDK

Yjs has a pluggable provider model — the CRDT layer is transport-
agnostic. Existing providers: `y-websocket`, `y-webrtc`, `y-libp2p`,
`y-indexeddb`. Writing a `y-canopy` provider over the existing
transport is a few hundred lines:

- subscribe to `update` events on the local Y.Doc
- broadcast the update binary via the SDK's message-passing primitive (relay / WebRTC / BLE — whatever's available)
- apply incoming updates to the local Y.Doc
- awareness (live cursors, presence) rides the same channel and is built into Yjs

Capability tokens + rendezvous are already the right primitives for
"invite this WebID to collaborate on this document."

So the dream's transport story is real and small.

## The mobile editor problem

This is where most attempts die.

- **Web/desktop:** excellent Yjs editor bindings — `y-prosemirror` (Tiptap, Notion-style), `y-codemirror`, `y-monaco`, `y-quill`. Plug-and-play.
- **React Native:** no first-class native rich-text editor that binds to Yjs. Realistic options:
  - WebView wrapping a web editor (Tiptap/ProseMirror + `y-prosemirror`). Works, feels slightly off, keyboard handling is finicky.
  - Plain `TextInput` with manual op translation (Y.Text deltas ↔ string diffs). OK for simple markdown, no rich formatting, edge-cases on cursor position.
  - Lexical-on-RN exists but is immature.

If a WebView editor on mobile is acceptable, there's a path. If
native-feeling RN editing is required, it's research territory.

## Tension with the file-as-truth model

Folio's current promise is "any editor on any device, the file is the
truth". Live collab inverts that: while a session is active, the
**CRDT** is the truth and the file is just a render of it.

Cleanest design: **collab is a mode**.

- "Open this note for collaboration" → spin up a Y.Doc, stream updates via SDK, file gets rewritten as a text-render of CRDT state on each idle moment.
- End session → final snapshot becomes the file; CRDT log is discarded (or stored as opaque blob in pod for later resume).
- External-editor edits *during* a live session would need to be imported as ops — solvable but design-intensive.

The mode switch keeps the Folio "file is truth" contract intact for
the 99% non-collab case.

## What already exists in the wild

| Project | P2P? | Mobile? | Markdown-file-shaped? | Notes |
|---|---|---|---|---|
| Anytype | ✅ (any-sync) | ✅ | ❌ (own block model) | Closest existing thing |
| Logseq | partial | ✅ | ✅ | Sync exists, no realtime collab |
| CryptPad | ❌ (central) | partial | partial | E2E-encrypted realtime, central server |
| HedgeDoc | ❌ (central) | web | ✅ | Markdown collab, central server |
| Etherpad | ❌ (central) | web | ❌ | Old, OT-based |
| Obsidian | ❌ (paid sync) | ✅ | ✅ | No decentralised collab |
| Yjs demos / Hocuspocus | depends | possible | possible | Building blocks, not products |

**No turn-key product** combines P2P + phone + web + markdown-file-
shaped + plays-well-with-external-editors. The components are
mature; the integration is missing.

## Rough cost if scoped

- Yjs + custom provider over the SDK transport — **small**
- Web editor (Tiptap + Yjs) — **well-trodden, small–medium**
- Mobile WebView wrapper + Yjs binding — **medium, finicky**
- File ↔ CRDT round-trip + mode switch in Folio — **medium–large, the design-intensive piece**
- Capability-token-based "invite to collab" UX — **small, reuses existing primitives**

A small focused effort can demo it. A polished version is a real
product, and one that fills a real gap.

## Open questions (not for this dream pass)

- Persistence: is the CRDT log stored in the pod as opaque binary, or do we discard after each session and rely on file snapshots only?
- Permissions: who can join an active session? Capability tokens with a "collaborate" scope, presumably.
- Offline rejoin: a peer was in a session, went offline, comes back — how do we reconcile their CRDT state with the post-session file?
- Identity: does the CRDT carry per-op WebID attribution (for "who wrote this paragraph")?
