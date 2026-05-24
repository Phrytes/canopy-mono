# Post-2026-05-24 priority order

After the massive 2026-05-24 mobile-pivot + parity wave (40+
commits, 8 mobile slices, 4 stoop-web parity ships, 3 docs).
What's open + the order I'd tackle it in.

## Tier 1 — unblocks everything else

### 1. **#249 — Test canopy-chat-mobile (first Android boot + V1 smoke)** ⭐ START HERE
Validates the entire V1 wave (#222 / #222.5 / #222.6 / #223 /
#241 SlashFAB) end-to-end on a real device.  Until this happens
the mobile pivot is "structurally complete + unverified."  Every
remaining mobile task benefits from knowing whether the V1 boot
actually works on Hermes.  ~1-2h on-device; might surface gradle
or polyfill issues that need fixes.

### 2. **#224 Phase A — Playwright on Expo web parity tests**
After #249 surfaces real flows, codify the 5 JM-* scenarios that
fit web-style testing.  Reuses
`apps/canopy-chat/test-browser/helpers.js`.  ~1d per scenario;
schedule the highest-value 2-3 first (JM-1 cross-app, JM-2
offline-post, JM-7 sub-task spawn).

## Tier 2 — concrete tech debt that grows if ignored

### 3. **#240 — manifest cross-app convergence** (now actionable)
Three real drifts found 2026-05-24:
- `state: 'open'` (household, string) vs `state: ['open']`
  (tasks-v0, array) — same field, two shapes
- `appliesTo.kind` is tasks-v0-only; other apps will collide
- `pickerSource` is calendar-only; tasks-v0 editTask would
  benefit from the same pattern
~1-1.5d to pick canonical shapes, migrate, strengthen validator.

### 4. **#248 — wire reconnect-trigger half of stoop-mobile catch-up**
The lastSeenFrom persistence shipped in #247; the actual request-
on-reconnect needs an architectural choice (A: add NknTransport
to stoop-mobile, ~1.5d, best long-term; B: translate envelopes,
~half-day; C: stoop-native via notify-envelope, ~1d).  Decide
first, then ship.  Closes the last user-visible stoop-mobile
substrate gap.

## Tier 3 — parity expansion (codeable now, no decisions blocking)

### 5. **#237 — folio-mobile substrate wiring**
folio-mobile is essentially a UI stub: ShareScreen.js has no
shareFolder / saveToMyPod / downloadFile / listFiles / Q29
getFileSnapshot calls.  ~1d to wire the 5 skills.  Alternative:
defer until canopy-chat-mobile composes folio via the shared
factory (Option B from #220 audit), making this redundant.
Pick a path; ship either way.

### 6. **#250 — tasks-v0 web profile-edit** (#242a, cheapest)
Mobile has it, web doesn't.  Model after stoop's web profile.html.
~half-day.

### 7. **#251 — tasks-v0 web edit-skills** (#242b, medium)
Mobile EditSkillsScreen uses a dynamic per-crew form schema.  Web
needs the same.  ~half-day.

### 8. **#252 — tasks-v0 web chat thread** (#242c, biggest)
Mobile has peer-to-peer task chat.  Web has zero chat surface.
Needs full message-list + send-input + appeal-button page.
~1 day.

## Tier 4 — needs design call before code

### 9. **#238 — calendar substrate path on mobile**
Mobile uses native calendar sync only; substrate's
`calendar_addEvent` + RSVP not wired.  Three options:
(a) Substrate only (drop native);
(b) Native only (lose cross-peer RSVP);
(c) Both (sync native ↔ substrate).
Pick first, then ~1.5d to wire.

## Tier 5 — deferred / pre-existing

### 10. **#167 — provision 3 pod creds + flip 9 it.todo to real**
Pre-existing deferred from v0.7.P3 work.  Needs real Solid pod
accounts; not mobile-pivot territory.

### 11. **#224 Phase B — Detox real-device cross-device tests**
After Phase A.  Covers the native-only JM-* journeys (JM-3 push,
JM-4 BLE, JM-5 camera, JM-6 voice).  Detox setup is its own
investment; defer until Phase A informs the API.

## Manual-only (always Frits's turf, never automated)

- **Browser smoke per app** — pending since 2026-05-23 + the
  2026-05-24 wave (#218 / #219 / #231.* / #243 / #244 / #245).
  See `[[canopy-chat-smoke-pending]]` memory for the checklist.
- **Real device verification of NknTransport (#223)** — unit
  tests use a mock; the real network connect needs a phone.
- **iOS** — out of scope per `[[stoop-mobile]]` convention.

## Snapshot — what shipped tonight

7 substantive ships + 1 audit doc + 2 follow-ups filed + 2 memory
updates:

| Task | What | Tests delta |
|---|---|---|
| #246 | Slash-coverage audit + folio LLM-only call + first-mount-wins policy | — |
| #243 | Stoop web rotateMyAddress + unmutePeer | 0 (locale-integrity passes) |
| #244 | Stoop web kind sub-picker | 0 |
| #245 | Stoop web group switch/join/create | 0 |
| #239 | Stoop-mobile catch-up verify (→ #247 filed) | — |
| #241 | Canopy-chat-mobile slash FAB + filter | +10 (mobile 7→17) |
| #247 | Stoop-mobile lastSeenFrom + wireCatchUp scaffold (→ #248 filed) | +14 (mobile 918→932) |

## Cumulative state of the mobile pivot

**Structurally complete:** the renderMobile projector exists, the
canopy-chat-mobile skeleton boots with real factory wiring, NKN
transport is built, AsyncStorage covers all known persistence
paths, the slash FAB is wired, every web wizard has a portable
state core ready for RN re-use.

**Awaiting real-device validation** (the #249 step).  Once that's
green, the remaining work is per-app polish (#240, #237, #242a-c)
and the cross-device test infrastructure (#224).
