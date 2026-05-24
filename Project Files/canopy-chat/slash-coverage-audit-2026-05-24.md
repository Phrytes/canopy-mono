# Slash-command coverage audit — 2026-05-24 (SP-12, #246)

Output of task **#246** — resolves the cross-cutting question raised
in `[[slash-command-coverage]]` memory (2026-05-20): which apps
declare native slash commands, which are LLM-only, and which need
explicit decisions.

## State of play

| App | Native slash count | Decision recorded? |
|---|---|---|
| **household** | 9 | ✅ Full slash (SP-1 byte-equivalent to legacy regexCommands) |
| **stoop** | 14 | ✅ Full slash — `/post /bulletin /mine /respond /withdraw /lend-assign /lend-return /report` + 6 more |
| **calendar** | 8 | ✅ Full slash — `/addappt /upcoming /accept /decline /tentative /cancelappt /pod-status /icalfeed` |
| **tasks-v0** | 0 | ✅ "LLM-only" — explicit V0 call per memory (SP-3) |
| **folio** | 0 | ❌ **Decision not recorded** |

The memory entry was stale — it claimed only household had slash.
Stoop + calendar in fact have substantial slash coverage. The
actually-open question is folio.

## Two-layer slash story (worth distinguishing)

1. **App-native slash** — declared in the app's `manifest.js`.
   Power-user shortcuts for ops the app considers "first-class".
   household / stoop / calendar opted in.
2. **Chat-shell slash** — declared in `apps/canopy-chat/src/core/
   manifests/mockManifests.js` for substrate ops the chat-shell
   wants to expose. tasks-v0 + folio are addressed THIS way today
   (`/addtask`, `/mytasks`, `/claim`, `/share`, `/folio-status`, etc.
   — provided by the chat-shell, not the app itself).

This is fine architecturally: the chat-shell can layer slash on top
of any substrate without the substrate needing to commit. But it
means tasks-v0 and folio are reachable via slash IN canopy-chat
even though their own manifests stay LLM-clean.

## Folio recommendation

**Keep folio LLM-only native; chat-shell provides slash.** Two reasons:

1. **Folio's audience is "I want to save this note" intent users**,
   not power users running `/list-files /share-folder`. Natural-
   language chat with the LLM picking the skill fits the
   information-management mental model better than a CLI surface.
2. **The chat-shell layer already does this work** —
   `mockFolioManifest` declares `/share /save-to-pod /download-file
   /folio-status` for users who DO want slash. No coverage gap.

Folio's manifest should add a one-line comment recording the
LLM-only call (same convention tasks-v0 used) so a future audit
doesn't reopen this question.

## Tasks-v0 recommendation

**Keep LLM-only.** The SP-3 V0 call holds — tasks is conversational
("which crew? what task?") and slash flatten that to flag soup.
Chat-shell's `mockTasksManifest` provides slash for power users.
Memory already records this.

## Cross-app collision policy

Today household + stoop + calendar all have slash but no overlapping
command names — no real collision. The host's `compose()` returns
`commandMenu + collisions[]` but `collisions` is always empty in
practice.

When the **first real collision lands** (someone adds `/post` to
household, say), pick one of:

- **First-mount-wins** (simplest; current behaviour by accident)
- **Prefix-on-collision** (`/household.post` vs `/stoop.post`)
- **LLM-disambiguate** (chat-shell asks user which app they meant)

Recommendation: codify **first-mount-wins** in the host README as
the explicit policy, with prefix-on-collision as a manual override
when needed. Defer LLM-disambiguate until a real user struggles.

## Mobile slash question (re #241)

If canopy-chat-mobile reintroduces slash via a `/` FAB (#241), all
the chat-shell mappings (`mockTasksManifest /addtask`, etc.) come
along for free since they live in the portable
`apps/canopy-chat/src/core/manifests/mockManifests.js` (lifted in
#221.5). Per-app native slash (household + stoop + calendar)
similarly works without per-app porting.

## Concrete actions

1. **Folio**: add a comment to `apps/folio/manifest.js` recording
   the LLM-only call (mirroring tasks-v0's SP-3 convention).
2. **Host README**: codify first-mount-wins collision policy under
   `packages/manifest-host/README.md` § "Cross-app slash collisions".
3. **Memory update**: refresh `[[slash-command-coverage]]` with
   accurate counts (stoop 14 + calendar 8 + household 9).

Actions 1 + 2 are ~15 minutes each; action 3 is bookkeeping. Total
~1h to close SP-12 cleanly.

## Related

- `[[slash-command-coverage]]` — original memory (now stale)
- `[[chat-surfaces-not-just-slash]]` — reminder that slash is one of
  five chat surfaces; the question isn't "slash everywhere?" but
  "which apps lean on it as primary"
- Mobile roadmap §"Open follow-ups" → #241 (slash-on-mobile FAB decision)
