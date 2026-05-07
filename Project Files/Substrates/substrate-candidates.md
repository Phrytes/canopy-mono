# Substrate candidates — flagged inline, listed here

> Authors flag substrate candidates inline as they write them (per
> [`./policies.md`](./policies.md#substrate-candidate-flagging--flag-while-writing-dont-audit-later-locked-2026-05-06)).
> This file is the consolidated index — scan once instead of
> auditing every app.
>
> **Promotion rule:** an entry stays here until a *second* app needs
> the same shape.  At that point rule-of-two is satisfied and the
> candidate is extracted into a real substrate; the entry is
> deleted from this file (with a pointer in the substrate's
> README's "lifted from" line).

## Active candidates

| Candidate | First consumer | Likely substrate | Triggered by |
|---|---|---|---|
| **Local-first cache + foreground-only sync** (`CachingDataSource` + `SyncCadence`) | `apps/stoop/src/lib/CachingDataSource.js`, `apps/stoop/src/lib/SyncCadence.js` (Phase 4, 2026-05-06) | `@canopy/local-store` (or extend `@canopy/sync-engine` with a non-file shape) | Any second agentic app whose pod-shaped data benefits from "boot offline, attach pod later, queue writes, foreground-only poll". `apps/household` and `apps/archive` are the natural triggers. |
| **Author hydration for list-shaped skill responses** (helper that takes a webid + `Reveals` + `MemberMap` and returns `{handle, displayName?, isRevealed, render}`) | `apps/stoop/src/skills/index.js` `hydrateItem` / `hydrateItems` (Phase 3, 2026-05-06) | Promote helper into `@canopy/identity-resolver` itself (additive) | Any second app rendering authors via Reveals + MemberMap.  Likely just absorbs back into the substrate it composes — not a new package. |
| **Moderation skill set for closed-group apps** (`removeMember`, `leaveGroup`, `reportPost`, `mutePeer`, `unmutePeer`, `setMemberRole`, `requestProofRefresh`) | `apps/stoop/src/skills/index.js` (Phase 3, 2026-05-06; partial — only `mute*`, `reportPost` shipped) | `@canopy/group-mod` | `apps/household` (sibling-disagreement / blocking), `apps/archive` (collaborator removal), `apps/tasks-v0` (admin-only operations) — any closed-group app eventually wants this. |
| **Identity rotation scheduler** (`RotationScheduler` — periodic `Agent.rotateIdentity` on a foreground-only cadence) | `apps/stoop/src/lib/RotationScheduler.js` (Phase 9, 2026-05-06) | bundle into the same `@canopy/local-store` candidate as `CachingDataSource` + `SyncCadence` (all "agent operations on a foreground-only schedule") | Any second app that wants rotating network identity for unlinkability. Most natural at the same time household / archive land. |
| **Push policy wrapper** (`PushPolicy` — humanInTheLoop-only + per-day cap + quiet-hours over a notifier-style send) | `apps/stoop/src/lib/PushPolicy.js` (Phase 9, 2026-05-06) | `@canopy/notifier` (additive — promote to a `PushPolicyChannel` wrapper) | Any second app that wants a "calm push" policy on top of `notifier`. household and tasks-v0 both will. |
| **Peer-to-peer chat skill set** (Stoop V1 Phase 11 — `sendChatMessage`, `getChatThread`, `listChatThreads`, `getThreadParticipants`; threads as `kind: 'chat-message'` items linked by `source.threadId`; cross-agent delivery via `agent.sendOneWay`) | `apps/stoop/src/skills/index.js` + handler at agent-construction (Phase 11, 2026-05-XX — to be built) | new `@canopy/chat-p2p` (NOT `chat-agent`, which is LLM-mediated) | household direct messages, neighbourhood whisper-to-admin, archive collaborator chat — any app where two members need to talk privately under the same group identity. |
| **Solid-pod-as-DataSource adapter** (a `core.DataSource` implementation backed by `@canopy/pod-client.PodClient`) | new in Phase 13 if not already present in `@canopy/core` | `@canopy/core` (probable existing slot — audit first) | Every agentic app that wants Solid persistence. Folio's sync-engine has its own; Stoop V1's path is the same shape, so this is likely already-implemented core surface to reuse. |
| **OIDC session for browser-redirect flows** (`OidcSession` — `start({issuer, redirectUrl}) → authorize URL`, `handleCallback(callbackUrl)`, vault-backed refresh-token persistence, `_setSessionFactory` test seam) | `apps/stoop/src/lib/OidcSession.js` (Phase 20, 2026-05-06) — lifted from `apps/folio/src/auth/OidcSession.js` | `@canopy/oidc-session` (or merge with `@canopy/pod-client.SolidOidcAuth`) | **Folio + Stoop = 2 consumers already.** Eligible for promotion now; deferred until a household-V1.5 pod-sync flow or the AgentHub pod-sign-in lands and forces the call. Lift is non-trivial (vault wiring, test seams) — keep app-local until forced. |
| **Trust-graded 1:1 contact graph** (`ContactBook` — `addContact`, `setTrustLevel`, `setTags`, lists, asymmetric add-request envelopes; `MemberMap.relation: 'contact' \| 'group-member'` distinction) | `apps/stoop/src/lib/ContactBook.js` (Phase 24 V2, 2026-05-07 — to be built) | `@canopy/contacts` | `apps/stoop-hobby` (the planned fork — same model: contacts with trust + tags + lists). Folio could also pick it up if collaborator-trust ever shapes up that way. |
| **Coarse-grain geo-grid + filter primitives** (`cellFor({lat, lng, gridM})`, `distanceKm(cellA, cellB)`, `snapToGrid(km)`; cell encoding as `<gridM>:<row>:<col>` strings) | `apps/stoop/src/lib/geo.js` (Phase 26 V2, 2026-05-07 — to be built) | `@canopy/geo-grid` | Any second app needing distance-filtered fan-out. `apps/stoop-hobby` (range-bound activity matchmaking), `apps/proof-of-location` if it ever returns. Substrate is small + pure; trivial to lift. |
| **Battery-aware online cadence** (`pollIntervalMs`, `onlineWindow`, `broadcastable`, `allowHopThrough` settings + an Expo-task-manager-shaped scheduler interface) | `apps/stoop/src/lib/Settings.js` + scheduler hook (Phase 23 + Phase 28 V2, 2026-05-07 — to be built) | `@canopy/online-cadence` | Any second app whose mobile build needs scheduled wake-ups (V3 mobile Stoop is the first; sibling mobile apps the next). Settings shape is the contract; per-platform schedulers (web no-op / RN Expo) plug in. |
| **Reveals / InterestProfile / PushRegistry write-through** (event-driven snapshot to `CachingDataSource` for the small in-memory entities — same shape as `MemberMapCache`) | `apps/stoop/src/lib/RevealsCache.js`, `InterestProfileCache.js`, `PushRegistryCache.js` (Phase 29 V2, 2026-05-07 — to be built) | `@canopy/identity-resolver` (additive — promote `RevealsCache` next to existing `MemberMapCache`-shaped helper); other two stay app-local until rule-of-two | If a 2nd consumer needs durable Reveals or push-sub mirroring, the helper extracts. The InterestProfile cache is intentionally Stoop-shaped (TF-IDF over post bodies) and likely stays app-local even with a 2nd consumer. |

## How to use this file

- Adding a candidate: append a row with first-consumer file pointer + likely substrate name + plausible second-consumer triggers.
- Promoting a candidate: when a second app needs it, extract into the proposed substrate (or the existing one named in "Likely substrate"), then delete the row.
- Demoting a candidate: if review concludes it's actually app-specific glue, delete the row + remove the inline flag from the source file.

## See also

- [`./policies.md`](./policies.md#substrate-candidate-flagging--flag-while-writing-dont-audit-later-locked-2026-05-06) — the flagging rule.
- [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md) — the three-layer model.
- [`./README.md`](./README.md) — substrate-first methodology summary.
