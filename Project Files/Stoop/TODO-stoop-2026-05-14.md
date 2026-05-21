# Stoop — unified TODO (2026-05-14)

> **End-of-day 2026-05-14 update.** The Stoop V2 web A-track AND
> the Stoop-mobile V4 C-track both shipped today. The only
> Stoop-related item still open is Phase 40.23 (mobile real-device
> pass — hardware-dependent). Sections below preserved as a record
> of what shipped.
>
> Single point of truth for what's left on Stoop after the
> 2026-05-14 standardisation push. Consolidates:
>
> - V2 web functional-design §6a (substrate-adoption UX surface)
> - Coding plan v2 §Phase 31+ (V2.5 internal hardening)
> - V4 mobile functional-design §6a (mobile track)
>
> Source docs stay authoritative for specifics; this file is the
> sequencing + priority view. Update one item's status here AND in
> the source doc when shipping it.

---

## A. Web track — substrate-adoption UX surface (post-2026-05-14)

The substrate work shipped 2026-05-14 (item-types, substrateMirror,
conflict-resolution `_v`, Solid-auth consolidation, sharing v2).
This list is the **app-level UX surface** that exposes those
capabilities to users.

| ID | Item | Source | Size | Status |
|---|---|---|---|---|
| A1 | `'stale-peer'` event subscription on `bundle.pseudoPod` — auto-heal: publish local-fresher copy back via `notifyEnvelope.publish` for stale peers. `'concurrent-write'` affordance + UI banner deferred (lean: silent auto-heal only for V2.5) | functional-design §6a / coding-plan §"Standardisation adoption" | ~1 day | ✅ shipped 2026-05-14 — `wireSubstrateMirror` subscribes via `pseudoPod.on('stale-peer', ...)`, publishes back via `notifyEnvelope.publish({type:'request', ref, payload:event.localBytes, _v:event.localV, recipients:[event.fromActor]})`. 9/9 tests in `apps/stoop/test/staleAutoHeal.test.js`. |
| A2 | `groupCheck` wiring for `fetch-resource` (Phase 52.2.x peer-fetch gates) | coding-plan §"Standardisation adoption" | ~0.5 day | ✅ shipped 2026-05-14 — `attachSubstrateMirror` now registers `fetch-resource` on `bundle.agent` via `pseudoPod.fetchResourceSkill({groupCheck})`, with `groupCheck(uri, ctx) ⇒ mirror.getPeers().has(ctx.from)`. Multi-bundle-on-same-agent: first wins, subsequent attaches see the skill registered and skip. Closes the gap forward of envelope-only mode + cross-app embed-fetches. **Limitation**: substrate-mirror's `addPeer` is monotonic; eviction-aware sub-filtering (cross-check against `evictionRoster`) is a V3 follow-up. 6/6 tests in `apps/stoop/test/fetchResourceGate.test.js`. |
| A3 | Storage-policy picker in `/create-group.html` — four §II.2 policies (`no-pod` default / `centralised` / `decentralised` / `hybrid`). Wizard step copy + provider list when `centralised`/`hybrid` picks a fresh pod | functional-design §4a | ~1-2 days | ✅ shipped 2026-05-14 — `createGroupV2` accepts `storagePolicy`+`groupPodUri`, validates, persists in rules item + pushes to `bundle.podRouting.setCrewPolicy`. New `getCrewStoragePolicy` skill. UI: fieldset in `/create-group.html` with toggling pod-URI input. EN+NL locales. 12/12 tests in `apps/stoop/test/storagePolicy.test.js`. |
| A4 | `embeds: [{type, ref}, ...]` field on `postRequest` skill + embed-ref chip rendering on prikbord cards | functional-design §4b | ~1-2 days | ✅ shipped 2026-05-14 — `postRequest` accepts `embeds:[]`, validates (type+ref required, max 8), persists on `item.source.embeds`, broadcasts to peers via substrate-mirror payload. Receiver's `substrateMirror.mirror()` copies into mirrored item's `source.embeds`. Chip rendering in `web/app.js` via `renderEmbedChips`; CSS in `web/style.css`. 7/7 tests in `apps/stoop/test/embedsPost.test.js`. Click-through (Hub-mediated cross-app routing) deferred to P6. |
| A5 | `/group.html` storage-policy section + upgrade wizard (provision dedicated buurt pod / use admin's personal pod / point at existing pod) | functional-design §4c | ~1 day | ✅ shipped 2026-05-14 — new `setCrewStoragePolicy` skill (admin-only, one-way: rejects downgrade to no-pod once pod-having). `/group.html` storage-card with current policy display + upgrade row (hidden once pod-having). EN+NL locales. Covered by `storagePolicy.test.js`. |
| A6 | `/profile.html` "My Solid pods" section + two-pod upgrade preset | functional-design §4c | ~1 day | ✅ shipped 2026-05-14 (partial scope) — section displays pod-attach status (WebID + attached/detached) using existing `podSignInStatus` skill + sign-out via `signOutOfPod`. **Two-pod preset deferred to V3**: the substrate-side storage-mapping migration is V2-design-only (see `Substrates/storage-migration-design-2026-05-14.md`); the full editor lives in the Hub-web-console (post-P5). UI shows a disabled placeholder with the deferral note. EN+NL locales. |
| A7 | Agent-registry registration on bundle bring-up (Phase 52.10 / P5) — browser agent registers per-device under `pseudo-pod://<deviceId>/private/agent-registry` on first run | functional-design §6a | ~0.5 day | ✅ shipped 2026-05-14 — `attachSubstrateMirror` wires `createAgentRegistry({pseudoPod, deviceId: substrate.deviceId})` and registers the agent (idempotent CAS upsert). Opt-out via `agentRegistry: false`; capabilities/name customisable. Soft-fail: failures attach `null` rather than throwing. 6/6 tests in `apps/stoop/test/agentRegistryWiring.test.js`. |

**Status: all A-track items shipped 2026-05-14.** A2 turned out
to be useful immediately (forward-looking eviction protection per
the live discussion) so it was implemented rather than deferred.

**Suggested order:** A7 → A1 → A4 → A3 → A5 → A6 (small foundational
pieces first; bigger UX surfaces second).

---

## B. Web track — V2.5 internal hardening (Phases 31-38)

Stoop-internal polish items deferred during V2 (Phases 0-22) and
recommended for V2.5. **Audit 2026-05-14: B1-B5 + B8 (Phase 39)
all shipped already** — 50/50 tests pass across the five phase
test files.

| ID | Phase | Item | Size | Status |
|---|---|---|---|---|
| B1 | 32 | Deterministic stableId from mnemonic (HKDF-SHA256, salt `stoop-stableId-v1`) | ~1 day | ✅ shipped — verified 5/5 tests pass in `packages/core/test/identity/AgentIdentity.stableId.test.js` |
| B2 | 31 | Mid-flight identity swap on restore (`Agent.swapIdentity(newIdentity)`) | ~2 days | ✅ shipped — verified 9/9 tests pass in `apps/stoop/test/phase31.test.js`; `swapIdentity` at `packages/core/src/Agent.js:656` |
| B3 | 33 | Device-specific settings split (`shared.json` + `devices/<deviceId>.json`) | ~2 days | ✅ shipped — verified 10/10 tests pass in `apps/stoop/test/phase33.test.js` |
| B4 | 34 | `CachingDataSource.attachInner` bulk-sync of pre-attach local writes | ~1.5 days | ✅ shipped — verified 6/6 tests pass in `apps/stoop/test/phase34.test.js` |
| B5 | 35 | Auto-eviction enforcement (lives in `substrateMirror`-aware path post-2026-05-14 groupMirror retirement) | ~1.5 days | ✅ shipped — verified 8/8 tests pass in `apps/stoop/test/phase35.test.js` |
| B6 | 37 | Audit substrate (cornerstone for Hub Layers 2-4) | ~3-4 days | parked (Hub track) |
| B7 | 38 | Capability manifest + per-app pod namespaces; blocked-by B6 | ~2-3 days | parked (Hub track) |
| B8 | 39 | Picture attachments in posts and chat | ~2-3 days | ✅ shipped — verified 17/17 tests pass in `apps/stoop/test/phase39.test.js` |

Phase 36 (real OIDC against CSS fixture) is **deferred indefinitely**
per 2026-05-07 decision; not in this list.

**Remaining work in B-track:** none active. B6 + B7 parked.

---

## C. Mobile track — V4 web-mirror (shipped 2026-05-14)

Per user direction at start of day: mobile work comes after web.
Both A-track (web) and C-track (mobile) shipped same-day.

| ID | Item | Source | Size | Status |
|---|---|---|---|---|
| C1 | Phase 40.23 real-device pass + closed-beta APK (Hardware test, independent of substrate work, can ship anytime — user holds for hardware availability) | v4-mobile §6a | ~2-3 days | pending (hardware) |
| C2 | `'stale-peer'` event subscription on mobile (mirror of A1) | v4-mobile §6a | ~1 day | ✅ inherited 2026-05-14 — the auto-heal subscriber lives inside `wireSubstrateMirror`, which all three mobile bundle paths already call. No mobile-side code change needed. |
| C3 | Agent-registry registration on mobile bundle bring-up (mirror of A7) | v4-mobile §6a | ~0.5 day | ✅ shipped 2026-05-14 — extracted `registerAgentInRegistry` helper from `attachSubstrateMirror`; called from all three mobile bundle bring-up paths (`bootstrapBundle.js` + `agentBundle.js` × 2). Capability tag `['stoop', 'stoop-mobile', 'mdns', 'ble']`. `bundle.podRouting` also exposed on mobile. |
| C4 | Crew-create wizard storage-policy step on mobile (mirror of A3) | v4-mobile §6a | ~1 day | ✅ shipped 2026-05-14 — `CreateGroupScreen.js` adds a 4-radio policy picker with conditional pod-URI input. Passes `storagePolicy`+`groupPodUri` to `createGroupV2` skill. EN+NL locales + 12 new keys in localesIntegrity test (593/593 pass). |
| C5 | "My Solid pods" profile section + embed-ref slot on compose (mirror of A4/A6) | v4-mobile §6a | ~1 day | ✅ shipped 2026-05-14 — `ProfileMineScreen.js` adds My-Solid-pods section (`podSignInStatus` + `signOutOfPod` skills; sign-out flow; two-pod placeholder for V3). `PostComposeScreen.js` adds an embeds list + add-row (type + ref + remove-chip) that passes `embeds: [{type, ref}]` to `postRequest`. Cap of 8 + validation. EN+NL locales. |

**Status: C2-C5 all shipped 2026-05-14.** Only C1 (Phase 40.23
real-device pass) remains — hardware-dependent.

---

## Open questions before A-track starts

Captured here so they're not lost. Each blocks the relevant
A-track item; pin during that item's implementation.

- **A1** — How should `'stale-peer'` divergence surface to the
  user? Three options: (a) silent auto-republish (no UI); (b)
  banner on prikbord (`Concurrent edit detected — your version was
  newer`); (c) both. Lean: (a) for V2.5 (auto-heal); add (b) in V3
  only if real divergence is observed in field testing.
- **A3** — Default policy for new crews. The functional-design
  recommends `no-pod` (V1 parity). Worth re-confirming after
  testing the wizard UX.
- **A3/A5** — Storage-policy migration UX. Today's design says
  "upgrade only, no downgrade once pod-having." Should the wizard
  also surface a clear "this is one-way" warning? Lean: yes,
  explicit warning.
- **A4** — Embed-ref chip layout. Inline below post body or a
  separate "See also" row? Lean: inline chips below body (matches
  Folio note design).

---

## Out-of-scope for this TODO

- **P4 / P6 / P7 Hub track** — direction-only; design-mature;
  timing-deferred. Not Stoop-specific work.
- **V3 mobile design changes** — beyond C-track mirror, the V4
  mobile functional-design's "new V4" content is not yet planned
  for implementation.
- **Activities/hobbies app fork** (Stoop variant) — tracked
  separately in functional-design §9 Non-goals.

---

## Cross-references

- Coding plan: [`coding-plan-v2-2026-05-07.md`](coding-plan-v2-2026-05-07.md) — Phases 31-38 source + standardisation adoption appendix
- Web functional design: [`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md) — §4a-c functional-surface source + §6a status table
- Mobile functional design: [`v4-mobile-functional-design-2026-05-11.md`](v4-mobile-functional-design-2026-05-11.md) — §6a status table
- Cross-app residuals: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Standardisation residuals"
- Substrate phase list: [`../Substrates/substrates-v2-coding-plan-2026-05-11.md`](../Substrates/substrates-v2-coding-plan-2026-05-11.md)
- Q-D conflict-resolution design: [`conflict-resolution-design-2026-05-14.md`](conflict-resolution-design-2026-05-14.md)
- Stoop open-questions (live):
  [`open-questions-2026-05-12.md`](open-questions-2026-05-12.md)
