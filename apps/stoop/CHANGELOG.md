# Changelog — @canopy-app/stoop

## [0.2.0] — 2026-05-06

V2 of what was H5 / neighborhood-v0. Renamed in place; the package
is now `@canopy-app/stoop`.

Substrate extensions (Phase 1 — landed in `packages/`):

- `identity-resolver`: handle + avatarUrl on `MemberMap`; new `Reveals` class; pure `resolve()` function.
- `notifier`: `scheduleBefore({dueAt, leadMs, ...})` convenience.
- `item-store`: no change required (existing `Item.type` + `dueAt` cover Stoop's needs).

Relay extensions (Phase 2 — landed in `packages/relay`):

- `verifyBound({proof, connectingPubKey, rotationProof?})` closes the
  spoofing loophole + accepts `core.KeyRotation` rotation chains.
- `acceptedGroups[].revokedMembers` static blocklist.
- `acceptedGroups[].quotas: {msgsPerDay, maxConnections}`.

Stoop V1 skills (Phases 3, 6, 7, 10):

- `postRequest` — accepts `kind: 'ask'|'offer'|'lend'|'report'` + `dueAt`; auto-schedules a return reminder for lend.
- `markReturned` (lend lifecycle).
- `mutePeer` / `unmutePeer` / `listMutedPeers` — local-only filter.
- `reportPost` — `kind:'report'` audit item.
- `setMyHandle` / `setMyDisplayName` / `setPeerReveal` / `setGroupReveal` / `getMyProfile`.
- `createGroupWithRules` / `getGroupRules` / `acceptGroupRules` / `getOnboardingState`.
- `getDataLocation` / `getPrivacyNotice` / `markMnemonicShown`.
- `exportMyData` / `leaveGroup({deletePosts?})`.
- `listOpen` / `listMyRequests` now hydrate `addedByDisplay` via `identity-resolver.resolve()`.

Stoop V1 lib modules (Phases 4, 6, 8, 9):

- `lib/CachingDataSource.js` — local-first DataSource wrapper with write queue + `attachInner` mid-session.
- `lib/SyncCadence.js` — foreground-only periodic sync ticker.
- `lib/handle.js` — pure handle validator.
- `lib/i18n.js` — `i18next` wrapper; en + nl ship.
- `lib/RotationScheduler.js` — periodic `Agent.rotateIdentity` (foreground-only).
- `lib/PushPolicy.js` — humanInTheLoop + per-day cap + quiet-hours wrapper.
- `lib/UsageMetrics.js` — local counter for the V1 push-UX feedback loop.
- `lib/privacyNotice.js` — closed-beta privacy-notice content (NL/EN).
- `lib/itemTypes.js` — Stoop `Item.type` vocabulary constants.

Web (Phase 5, 7):

- `web/index.html` — prikbord with kind tabs (Alles / Vragen / Aanbod / Te leen) + per-post `…` menu (mute / report) + honest "Naam verbergen tot connectie" copy.
- `web/profile.html` — handle + display-name forms + default-render preview.
- `web/create-group.html` — six-question governance wizard.
- `web/privacy.html` — privacy notice + data-location.

Locales: `locales/{en,nl}.json` populated.

i18next as a dependency.  Dropped explicit pre-Stoop H5 wording from
the codebase (test expectations updated; CHANGELOG, README, bin
script names re-cast to `stoop-*`).

Tests: **143** in `apps/stoop`.  Plus substrate/relay deltas:
identity-resolver 30→49, notifier 40→45, relay 121→126.

## [0.1.0] — 2026-05-02

H5 V0 — initial release (non-anonymous).

- `createNeighborhoodAgent({skillMatch, members?, itemBackend?})` factory.
- Skills: `postRequest`, `acceptResponder`, `cancelRequest`, `listMyRequests`, `listOpen`, `resolveMember`.
- 9 integration tests.

V0 = non-anonymous; Q-H5 anonymity model is parked.
