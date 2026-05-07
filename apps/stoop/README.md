# @canopy-app/stoop

> **Layer: app.** Composes substrates from `packages/{item-store, skill-match, identity-resolver, agent-ui, notifier, chat-agent, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).

Buurt-skill-app: vragen, aanbod, en lenen tussen buurtgenoten —
prikbord-not-feed, mens en machine-agents naast elkaar, decentraal
via de @canopy agent SDK.

**Status:** V1.5 demo-ready (2026-05-06). This package was
H5 / `apps/neighborhood-v0` until 2026-05-06; renamed in place.
Phases 0–22 of the coding plan have landed:

- 0–10: scaffold, substrate / relay extensions, skill layer,
  local-first cache, prikbord UI, handle UX, onboarding, i18n,
  rotation + push policy + metrics, export + leaveGroup.
- 11: stableId on `core.AgentIdentity`; stableId-keyed mute /
  reveal; MemberMap stableId resolver.
- 12: skills taxonomy + tag-normalisation + multilingual matching.
- 13: UX completeness — finished-button, stale-post nudge,
  duplicate detection, encrypted backup, hop routing.
- 14: peer chat (`respondToItem` / `sendChatMessage` / bilateral
  reveal handshake) over `agent.transport.sendOneWay`.
- 15: cross-device transport groundwork — `persistPath` opt-in
  wires `FilePersist` so state survives Node restarts.
- 16: group ops admin skills — `listGroupMembers`, `postAnnouncement`,
  `editGroupRules`, `removeMember`, `listReports`.
- 17: onboarding polish — one-shot `getMnemonicOnce`,
  `getInviteQrPayload`, gated `redeemInviteWithGate`.
- 18: in-app notification banners + `UsageMetrics` integration +
  `getMetrics` skill for the closed-beta dashboard.
- 19: closed-beta hardening (`CLOSED-BETA-RUNBOOK.md`,
  `web/metrics.html` dashboard, runbook smoke test).
- 20: Solid pod sign-in (`startPodSignIn` / `completePodSignIn` /
  `signOutOfPod`) — OIDC via `@inrupt/solid-client-authn-node`,
  `bundle.cache.attachInner(SolidPodSource)`.
- 21: Web Push scaffold — `WebPushSender`, `PushRegistry`,
  `subscribeWebPush` / `triggerSelfPush` skills, `/sw.js`,
  `/push.html`.
- 22: Layer-2 personal-interest profile — TF-IDF over post bodies
  the user responded to; `scorePostRelevance` combines Layer 1
  (deterministic skills) with Layer 2 (interest cosine).

Current test count: **378** in `apps/stoop` (34 test files).

See [`DEMO.md`](./DEMO.md) for the demo script and
[`CLOSED-BETA-RUNBOOK.md`](./CLOSED-BETA-RUNBOOK.md) for the
operational runbook.

**V2 expansion shipped (2026-05-07).** Phases 23-30 cover the
contact graph (1:1 trust-graded contacts independent of groups),
multi-target posts with grid-snapped distance filtering,
self-creatable groups with rotating membership codes, and full
pod-sync coverage so a recovery phrase + pod sign-in restores
everything on a new device. Mobile (V3 Expo) follows. Source of
truth: [`coding-plan-v2-2026-05-07.md`](../../Project%20Files/Stoop/coding-plan-v2-2026-05-07.md);
design decisions in
[`functional-design-2026-05-06.md`](../../Project%20Files/Stoop/functional-design-2026-05-06.md)
§§ 4e/4f/4g + the **Resolved (2026-05-07)** table at the bottom of
§ 7.

V1 is non-anonymous; cryptographic anonymity (Q-H5) stays parked
for V2 per the threat model in
[`Project Files/Stoop/privacy-and-safety-2026-05-05.md`](../../Project%20Files/Stoop/privacy-and-safety-2026-05-05.md).

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/item-store` (L1b) | Records every Vraag / Aanbod / Te leen as a structured pod-backed item with attribution + audit. Stoop-vocabulary `type: 'ask' \| 'offer' \| 'lend' \| 'report'` slots into existing `Item.type`; lend lifecycle uses the existing `dueAt` field. | Pod write paths + per-field merge are shared with H4/H7; Stoop adds no new substrate fields. |
| `@canopy/skill-match` (L1e) | Pubsub-of-skills broadcast over the closed buurt group + posture flag (`always` / `negotiable` / `humanInTheLoop`) + claim collection. | Pubsub-of-skills + posture is the H4/H7 shared primitive. |
| `@canopy/identity-resolver` (L1h) | Member-WebID map + per-group display config + handle / displayName-on-reveal via the new `Reveals` + `resolve()` primitives (Phase 1B). | Cross-app identity reconciliation; Telegram-style reveal pattern reused by any future social app. |
| `@canopy/agent-ui` (L1d) | Hosts the prikbord UI via `mountLocalUi` — same-origin REST + SSE so the page POSTs to skill endpoints without CORS. | UI host pattern shared with future agent-fronted web UIs. |
| `@canopy/notifier` (L1f) | Push wake when a human needs to decide; lend return-reminders via `scheduleBefore({ dueAt, leadMs, ... })` (Phase 1C). | Scheduling + push channel shared with H4/H7. |
| `@canopy/chat-agent` (L1c) | Pre-connection chat between requester and responder; flips the `identity-resolver` reveal state on bilateral handshake. | MessagingBridge interface; chat is a substrate concern, not an app one. |

Stoop **does not depend on any sibling app**. Per the convention
finalised 2026-05-06, apps must not import from other apps; if two
apps need to share code, extract a substrate.

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `VaultMemory`, `InternalBus`, `InternalTransport`, `MemorySource` | Constructing the per-member agent that the skill-match substrate composes. | No substrate wraps "construct an agent" — that's foundational SDK behaviour. The factory creates `core.Agent` directly so `SkillMatch` has a real agent + transport to subscribe over. |
| `@canopy/core` | `GroupManager`, `Agent.rotateIdentity()` | Issuing / verifying group proofs, scheduled identity rotation (Phase 9 of the coding plan). | Group cryptography + identity rotation are foundational; substrate-of-substrates would be over-abstraction. |
| `@canopy/core` | `Agent.enableSealedForwardFor`, `Agent.enableRelayForward` | Hop / sealed-forward routing (Phase 13.3 + Phase 28). | Routing primitives are SDK-foundational and already substrate-shaped (mesh-demo proves them at scale). Stoop just wraps a UI toggle. |
| `@canopy/core` | `SolidVault`, `SolidPodSource` (lazy-loaded) | Solid OIDC session + pod-backed `DataSource` (Phase 20 sign-in). | Cross-app concern; will likely lift into `@canopy/oidc-session` once a 3rd consumer materialises. Stoop + Folio are the existing 2. |
| `@canopy/core` | `Bootstrap`, `validateMnemonic`, `mnemonicToSeed` | Mnemonic validation + seed derivation for the Phase 30 device-restore flow. | Identity-bootstrap primitives; foundational. |
| `@canopy/relay` | `RelayTransport`, group-publish, `GroupAuthVerifier` config (server-side), Phase-2 quotas + revocation list + bound verification, `PushSender` (extended by `WebPushSender` in Phase 21) | Network transport to the Stoop community relay; group registration; relay-side enforcement of Phase 2 additions; Web-Push delivery shape. | Transport wiring is per-app; the server-side relay extensions live in `@canopy/relay`, not in a substrate. `WebPushSender` is a candidate to lift back into relay alongside `ExpoPushSender` once a 2nd web-push consumer appears. |
| `@inrupt/solid-client-authn-node` (optional dep) | `Session` | Inside `OidcSession`, called via the `_setSessionFactory` test seam. | No substrate wraps Solid OIDC at the right shape yet; Folio + Stoop both do this directly via lifted-`OidcSession.js`. Tracked in `Project Files/Substrates/substrate-candidates.md` as `@canopy/oidc-session`. |
| `web-push` (optional dep) | VAPID-signed Web Push delivery | Inside `WebPushSender`, called when VAPID keys are configured. | Currently the only Web-Push consumer; will lift into `@canopy/relay/push/` when a 2nd consumer materialises. |

## Agent Hub compatibility

**Attachment model:** `standalone`. The Agent Hub does not exist
yet; Stoop embeds substrates + SDK directly. Designed so a future
migration to `hub-attached (lite)` is possible (see
[`Project Files/AgentHub/agent-hub-design-2026-05-05.md`](../../Project%20Files/AgentHub/agent-hub-design-2026-05-05.md)
and the three rules in
[`Project Files/conventions/app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md#template--the--agent-hub-compatibility-section)).

**Agent topology:** spawns one agent per user, per group (Shape A).
Group switcher lets a user belong to N groups (`--groups <gid1>,<gid2>`).

**Capability scope:** subscribe to the user's joined groups;
broadcast vraag / aanbod / lenen items within them; pod writes go
through `item-store`. Each agent's network identity rotates every
30 days via `Agent.rotateIdentity()` (Phase 9).

## Bring it up

```bash
cd apps/stoop
npm install
npm test          # 378 tests across phases 3–30 + integration / web / multigroup / onboarding / testbed

# Single-member quick-start (good for smoke testing the UI shell):
npm run ui -- --actor https://id.example/anne --group block-42

# Multi-group dropdown:
npm run ui -- --actor https://id.example/anne --groups block-42,book-club

# Multi-user testbed — admin + onboarding + spawn-on-redemption.
# Recommended for hands-on multi-user testing:
npm run testbed -- --admin https://id.example/admin

# Pre-seed multiple members from the start:
npm run testbed -- --admin https://id.example/admin \
                   --members https://id.example/anne,https://id.example/bob
```

V2 multi-process bring-up (relay-backed, two devices) is documented
in
[`Project Files/coding-plans/H5-V2-resume.md`](../../Project%20Files/coding-plans/H5-V2-resume.md);
remaining V1 product-item scope is in
[`Project Files/Stoop/coding-plan-v1-2026-05-05.md`](../../Project%20Files/Stoop/coding-plan-v1-2026-05-05.md).

### Settings layout

Stoop V2.5 splits its persisted settings into two pod blobs per the
project-wide convention
([`Project Files/conventions/cross-app-settings.md`](../../Project%20Files/conventions/cross-app-settings.md)):

```
<pod>/stoop/settings/shared.json              user-portable
<pod>/stoop/settings/devices/<deviceId>.json  per-install (local-only)
```

**Field partition** (this app's authoritative table):

| Field | Scope | Why |
|---|---|---|
| `pollIntervalMs` | device | Per-machine UI cadence. |
| `onlineWindow` | device | Mobile-only battery-aware schedule. |
| `allowHopThrough` | device | Hardware decision to relay for others. |
| `broadcastable` | shared | User policy: accept inbound auto-skill-match? |
| `defaultShareLocation` | shared | User preference for new-contact defaults. |

`devices/<deviceId>.json` is local-only — never pushed to the pod
via bulk-sync (Phase 34). The `deviceId` is
[`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js).

**Cross-app shared-defaults (Rule 3 of the convention):** Stoop is
the canonical example for the layout but is currently the only app
with persisted settings. When a sibling app (Folio, Archive,
Household) ships its own settings, it MAY read
`<pod>/stoop/settings/shared.json` to seed first-run defaults for
matching fields. Stoop in turn doesn't currently read sibling apps'
blobs (it predates them) — when it eventually does, the field-mapping
table goes here.

**Pod-layout doc:** [`Project Files/Stoop/pod-layout-2026-05-06.md`](../../Project%20Files/Stoop/pod-layout-2026-05-06.md)
has the cross-app pod-layout convention text in full.

### Localisation

Strings live in `locales/<lang>.json`. Default is `en`; `nl` ships
from V1 per the project localisation convention
([`Project Files/conventions/localisation.md`](../../Project%20Files/conventions/localisation.md)).
Add a locale by creating `locales/<xx>.json` and mirroring the keys
from `en.json`.

**Leaf shape (locked 2026-05-06):** every entry is
`{ "text": "...", "doc": "..." }`. `text` is the translatable string;
`doc` is a context note for translators (where it appears, what tone,
what `{{placeholder}}` means). The runtime `t(key)` returns only the
`.text` field; `doc` is metadata for the translation pipeline. Plain
strings still resolve (back-compat), but new entries must include a
`doc`.

**Browser bridge:** `web/app.js` exports `initI18n()`, `t(key, fallback)`,
and `applyI18n(root)`. Pages declare strings via `data-i18n="key"` (or
`data-i18n-attr="placeholder"` for attributes); the bridge walks the
DOM and substitutes on load.

**No Dutch in code.** Domain terms (`prikbord`, `actief`, `gepauzeerd`,
`gearchiveerd`) belong only in `nl.json` UI strings. Code identifiers,
status enums, function names, comments, log messages, and skill
return codes are English-only.

### Personal-pod URLs do not travel peer-to-peer

Per the project-wide rule
([`Project Files/projects/README.md`](../../Project%20Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages--applies-to-every-agentic-project-here)),
no user pod URL appears inside any Stoop broadcast or chat envelope.
Image / file attachments ship as bytes (resized client-side). The
recipient stores a local copy on receive. There is no
"click → fetch from sender's pod" path; doing that would expose the
sender's pod root and undermine `Reveals` + Phase-35 eviction.

When the SDK gains a shared / group-owned storage namespace,
URL-mode attachments may become possible against THAT namespace —
never against personal pods.

### Local-only mode

Per the project-wide rule
([`Project Files/projects/README.md`](../../Project%20Files/projects/README.md#local-only-mode-is-the-floor--applies-to-every-agentic-project-here)),
Stoop must work fully without an authenticated Solid pod. Pod sync
is an opt-in upgrade for portability and multi-device; not a runtime
prerequisite. Phase 4 of the coding plan covers the local-first
cache + offline behaviour.

## What's in here

```
apps/stoop/
├── README.md                ← this file
├── CHANGELOG.md
├── package.json             ← @canopy-app/stoop
├── vitest.config.js
├── src/
│   ├── Agent.js             ← createNeighborhoodAgent factory wiring substrates
│   ├── cluster.js
│   ├── groupMirror.js
│   ├── index.js
│   ├── onboarding.js        ← issueInvite / redeemInvite skills (composes core.GroupManager)
│   └── skills/
│       └── index.js         ← postRequest / acceptResponder / cancelRequest /
│                              listMyRequests / listOpen / resolveMember
├── bin/
│   ├── stoop-ui.js          ← single-actor CLI launcher
│   └── stoop-testbed.js     ← multi-user testbed launcher (admin + spawn-on-redemption)
├── web/
│   ├── index.html           ← prikbord (current shell from H5; redesigned in Phase 5)
│   ├── mine.html            ← requester-side claim approvals
│   ├── onboard.html         ← admin-issues / member-redeems
│   ├── app.js               ← shared client logic
│   └── style.css
├── locales/
│   ├── en.json
│   └── nl.json
└── test/                    ← phases 3–18 + integration / web / multigroup / onboarding / testbed; 252 tests
```

### Substrate candidates inside this app

Per the project-wide flagging rule
([`Project Files/Substrates/policies.md`](../../Project%20Files/Substrates/policies.md#substrate-candidate-flagging--flag-while-writing-dont-audit-later-locked-2026-05-06)),
the following Stoop-local code is flagged as substrate candidates —
extracted when a second app needs the shape:

- `src/lib/CachingDataSource.js` + `src/lib/SyncCadence.js` → likely `@canopy/local-store` (or extend `@canopy/sync-engine`).
- `src/skills/index.js` `hydrateItem` / `hydrateItems` → likely promoted into `@canopy/identity-resolver`.
- `src/skills/index.js` moderation skill block → likely `@canopy/group-mod`.

Inventory + promotion rule:
[`Project Files/Substrates/substrate-candidates.md`](../../Project%20Files/Substrates/substrate-candidates.md).

## V0 (legacy H5) → V1 (Stoop) → V2

Inherited from H5 V0:
- Non-anonymous closed-group skill matchmaking.
- 6 core skills, in-process testbed, single-group + multi-group support.

V1 (in progress per the coding plan):
- `kind` vocabulary on items (`ask` / `offer` / `lend` / `report`).
- Lend lifecycle (`dueAt` + return reminder via `notifier.scheduleBefore`).
- Moderation skills (`removeMember`, `leaveGroup`, `reportPost`, `mutePeer`, `setMemberRole`, `requestProofRefresh`).
- Handle / displayName-on-reveal UX (composes `identity-resolver.Reveals` + `resolve()`).
- Per-group rate quotas + revocation list at the relay (Phase 2 — landed).
- Identity rotation every 30 days (Phase 9).
- Closed-beta privacy notice + decentralised disclaimer in onboarding.
- Per-group governance `rules.md` from the create-group wizard.

V2 (deferred per the advice doc):
- Cryptographic anonymity (Q-H5 unparked).
- Multi-relay / federation.
- Reputation / trust scoring.
- LLM-mediated request classification (composes L1c + L1j).
- Skill chains / ring-trade matchmaking.
- Buurt-resources as first-class non-person agents.

## Reference

- Design: [`Project Files/Stoop/advice-2026-05-05.md`](../../Project%20Files/Stoop/advice-2026-05-05.md)
- Coding plan: [`Project Files/Stoop/coding-plan-v1-2026-05-05.md`](../../Project%20Files/Stoop/coding-plan-v1-2026-05-05.md)
- Threat model: [`Project Files/Stoop/privacy-and-safety-2026-05-05.md`](../../Project%20Files/Stoop/privacy-and-safety-2026-05-05.md)
- User-empathy: [`Project Files/Stoop/potential-user-complaints-2026-05-05.md`](../../Project%20Files/Stoop/potential-user-complaints-2026-05-05.md)
- Group governance starter: [`Project Files/Stoop/group-governance-starter-2026-05-05.md`](../../Project%20Files/Stoop/group-governance-starter-2026-05-05.md)
- Original H5 design: [`Project Files/projects/02-neighborhood-app/README.md`](../../Project%20Files/projects/02-neighborhood-app/README.md)
- Mockup: [`Project Files/Stoop/shareskills_app_mockup.html`](../../Project%20Files/Stoop/shareskills_app_mockup.html)
- Brainstorm: [`Project Files/Stoop/Stoop - brainstorm.txt`](../../Project%20Files/Stoop/Stoop%20-%20brainstorm.txt)
