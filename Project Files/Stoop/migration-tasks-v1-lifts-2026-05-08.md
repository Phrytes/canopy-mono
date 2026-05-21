# Stoop migration TODO — Tasks V1 substrate lifts (2026-05-08)

> Tasks V1 implementation lifts several Stoop `lib/` files into
> shared substrates because Tasks V1 is the second consumer that
> satisfies rule of two. **This means Stoop-side migration work**:
> each lifted file in `apps/stoop/src/lib/` becomes either deleted
> or a thin re-export shim around the new substrate.
>
> Source: [`Project Files/Tasks App/advice-2026-05-07.md` § Stoop
> lift opportunities](../Tasks%20App/advice-2026-05-07.md#stoop-lift-opportunities-triggered-by-tasks-v1-added-2026-05-07)
> + [`Project Files/Tasks App/coding-plan-2026-05-07.md`](../Tasks%20App/coding-plan-2026-05-07.md).
>
> **Scheduling.** The migration work happens *inside the Tasks V1
> implementation PRs* — when Tasks V1's Phase N lifts a file, the
> same PR contains the Stoop-side shim/migration. This avoids a
> "lifted but Stoop not yet updated" intermediate state. Stoop
> tests must stay green after each PR merges.

## Migration items, by Tasks V1 phase

### From Tasks V1 Phase 1 — `@canopy/local-store`

Three Stoop lib files become shims around the new substrate.

| Stoop file | Migration |
|---|---|
| `apps/stoop/src/lib/CachingDataSource.js` | Delete the implementation; make it a re-export `export { CachingDataSource } from '@canopy/local-store';` for back-compat with existing import sites. (Or: rewrite all import sites in one sweep + delete the file. Lean: shim + sweep later.) |
| `apps/stoop/src/lib/SyncCadence.js` | Same pattern: re-export shim. |
| `apps/stoop/src/lib/Settings.js` | Re-export shim, but pass Stoop's field schema (`{shared: ['broadcastable', 'defaultShareLocation'], device: ['pollIntervalMs', 'onlineWindow', 'allowHopThrough']}`) into the substrate constructor. Stoop's existing accessors (`broadcastable`, `defaultShareLocation`, etc.) keep working because the field schema is what generates them. |

**Tests.** Stoop's full suite must pass unchanged. Add a Stoop
integration test that reads a pre-lift fixture (`mem://stoop/settings/...`)
to prove the storage shape didn't drift.

**Risks.** The Settings field-schema parameter is a small API
addition — the only behavioural change. Audit Stoop's call
sites to ensure no hidden assumption about field set ordering
or migration logic.

### From Tasks V1 Phase 2 — `@canopy/identity-resolver` extension + `core.GroupManager` extension

| Stoop file | Migration |
|---|---|
| `apps/stoop/src/lib/MemberMapCache.js` | Re-export shim around `@canopy/identity-resolver/MemberMapCache`. Storage paths must NOT change; the substrate copy keeps Stoop's `members/<webid-encoded>.json` layout. |
| `apps/stoop/src/onboarding.js` | The `issueInvite` + `redeemInvite` skill helpers + `spawnOnRedeem` hook get canonical homes in `core.GroupManager`. Stoop's `onboarding.js` becomes a thin wrapper that just registers the canonical helpers as Stoop-named skills (preserving `onboarding.issueInvite` etc. for any existing import sites). The spawn-hook implementation stays Stoop-specific (testbed-shaped). |

**Tests.** Stoop's onboarding tests + member-roster auto-persist
tests must pass unchanged.

**Risks.**
- `MemberMapCache` storage shape is Stoop-internal today —
  ensure the lift preserves the exact paths + blob format.
- Skill names: if `core.GroupManager`'s canonical helpers use
  the exact skill names Stoop registers (`issueInvite`,
  `redeemInvite`), there's no collision; if the canonical names
  differ, Stoop's wrapper re-registers under Stoop's existing
  names so consumers don't change.

### From Tasks V1 Phase 3 — `@canopy/identity-resolver/skills/` submodule

| Stoop file | Migration |
|---|---|
| `apps/stoop/src/lib/skillsTaxonomy.json` | Delete; import from `@canopy/identity-resolver/skills/taxonomy`. Update all Stoop call sites (`skillsMatch.js`, any dropdown UIs). |
| `apps/stoop/src/lib/tagNormalisation.json` | Same — delete + import. |
| `apps/stoop/src/lib/skillsMatch.js` | Re-export shim around `@canopy/identity-resolver/skills/skillsMatch`. Stoop's import sites (`apps/stoop/src/lib/skillsMatch.js`'s own consumers) keep working. |

**Tests.** Stoop's skill-matching test suite must pass unchanged.
Particularly the multilingual NL↔EN normalisation tests.

**Risks.**
- Taxonomy is Stoop-shaped today (categories like `vervoer`,
  `huishouden`). After lift, it lives in identity-resolver
  used by Tasks too. Decision (per advice doc): lift as-is;
  add OSS-flavour categories via a separate PR if a real OSS
  crew complains.
- Frozen-shape contract — the taxonomy was deeply frozen
  (`Object.freeze`) in Stoop. Verify the substrate preserves
  the freeze.

### From Tasks V1 Phase 6 — `@canopy/chat-p2p` substrate (NEW package)

The biggest lift. Stoop's `wireChat` + chat skill set become a
new package.

| Stoop file | Migration |
|---|---|
| `apps/stoop/src/chat/wireChat.js` | Delete implementation; re-export shim around `@canopy/chat-p2p/wireChat`. |
| `apps/stoop/src/skills/index.js` (chat handlers: `sendChatMessage`, `getChatThread`, `listChatThreads`, `getThreadParticipants`) | Delete handler implementations; import from `@canopy/chat-p2p/skills` and re-register on the agent under the same Stoop skill names. |
| Envelope type rename (`stoop-chat` → `p2p-chat`) | One-time backward-compat: the Stoop-side reader accepts both `type: 'stoop-chat'` (legacy) and `type: 'p2p-chat'` (new). Sender always emits the new type. Items already stored in pods keep the legacy `source.envelopeType` field; readers don't care. |

**Tests.** Stoop's chat suite (peer-message send/receive, dedup
via nonce, thread listing, thread isolation) must pass
unchanged. Add a fixture test for the legacy `stoop-chat`
envelope reader.

**Risks.**
- The envelope-type rename is the only wire-shape change. Once
  one peer migrates and starts emitting `p2p-chat`, peers on
  the old code receive an unrecognised envelope and silently
  drop it. **Mitigation**: ship the *reader* migration before
  any *sender* migration. I.e. Phase 6's first commit teaches
  Stoop to accept both; the second commit (after closed-beta
  uptake) flips the sender to the new name. Or just keep
  emitting the legacy name from Stoop forever; Tasks emits
  the new name; both substrate readers accept both.
- `wireChat`'s `STOOP_CHAT_TYPE = 'stoop-chat'` constant is
  literally Stoop-named. The substrate version should accept
  both as a configurable list (`acceptedEnvelopeTypes:
  ['p2p-chat', 'stoop-chat']` with sender-side `emitEnvelopeType:
  'p2p-chat'`).

### From Tasks V1 Phase 9 — `@canopy/notifier` extension

| Stoop file | Migration |
|---|---|
| `apps/stoop/src/lib/UsageMetrics.js` | Re-export shim around `@canopy/notifier/UsageMetrics`. Stoop's metrics tests pass unchanged. |

**Risks.** Trivial lift (small file, pure logic, no storage).
Lowest-risk item in this list.

## Stoop docs that need updating after migration

- `apps/stoop/README.md` — substrate-composition table refresh
  (calls out `local-store`, the new identity-resolver
  submodules, `chat-p2p`).
- `Project Files/Stoop/coding-plan-v2-2026-05-07.md` — note
  which `lib/` files became shims; flag the lifted-out
  candidates as resolved.
- Stoop's `lib/CachingDataSource.js`, etc. — each shim file
  carries a one-line comment pointing at the substrate as
  source of truth.

## What's NOT lifted (Stoop keeps owning)

These stay app-local; Tasks V1 doesn't trigger them:

- `lib/handle.js` (Stoop handle convention)
- `lib/dupCheck.js` (post-spam filter)
- `lib/ContactBook.js` (Stoop V2 1:1 contacts)
- `lib/geo.js` + `lib/geocode.js` (Stoop V2 distance filter)
- `lib/itemTypes.js` (per-app vocabulary by design)
- `lib/targetResolver.js` (Stoop V2 audience resolver)
- `groupMirror.js` + `cluster.js` (Stoop group-event broadcast)
- `lib/WebPushSender.js` (Stoop's VAPID send wrapper)
- `lib/Attachments.js` (image attachments — Tasks V1.1+ might
  want this, lift triggers then)
- `lib/EvictionRoster.js` (Stoop's revoked-membership grace
  roster — different shape from Tasks's per-task revoke)
- `lib/encryptedBackup.js` (handy but no Tasks V1 consumer)
- `lib/i18n.js` (trivial wrapper around `i18next`)
- `lib/RevealsCache.js` + `lib/InterestProfileCache.js` +
  `lib/PushRegistryCache.js` (lift triggers when a 2nd
  consumer needs the same auto-persist shape; not yet)
- `lib/RotationScheduler.js` (V1+ when 2nd anonymity-shaped
  consumer emerges)
- `lib/PushPolicy.js` (V1.5 when Tasks push lands)
- `lib/OidcSession.js` (V1.5+ when Tasks pod sign-in lands;
  Folio + Stoop already make 2 consumers; Tasks would be 3rd
  and forces the lift)

## Coordination

- **Owner**: whoever drives Tasks V1 implementation (or pairs
  with Stoop owner per PR).
- **Per-PR convention**: every Tasks V1 PR that lifts a Stoop
  file contains both the substrate addition + the Stoop shim
  + Stoop's tests staying green. No half-lifted PRs.
- **Tracking**: cross-link this doc from
  `apps/stoop/README.md` (a one-liner: *"Tasks V1 is lifting
  several `lib/` files into substrates — see [`migration-tasks-v1-lifts-2026-05-08.md`](../../Project%20Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md)"*).
- **Done condition**: when Tasks V1 ships, Stoop has 7 fewer
  `lib/` implementation files (the lifted ones become shims or
  are deleted), and 0 behaviour changes from Stoop's user-
  visible surface.

## Pointers

- [`../Tasks App/advice-2026-05-07.md`](../Tasks%20App/advice-2026-05-07.md)
  — Tasks V1 design.
- [`../Tasks App/coding-plan-2026-05-07.md`](../Tasks%20App/coding-plan-2026-05-07.md)
  — Tasks V1 phase plan; each phase explicitly lists its Stoop
  migration work.
- [`../Substrates/substrate-candidates.md`](../Substrates/substrate-candidates.md)
  — substrate candidate list (the lifts above are marked 🔴
  LIFT NOW).
- `apps/stoop/README.md` — substrate-composition table to
  update post-migration.
