# Stoop V2 — Web functional design (2026-05-11)

> What the **web/desktop** version of Stoop does for a user,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Mobile companion: [`v4-mobile-functional-design-2026-05-11.md`](v4-mobile-functional-design-2026-05-11.md).
>
> V1 baseline is the 2026-05-06 V1.5 demo-ready release of
> `apps/stoop` (Phases 0–22, 378 tests, 34 test files). V1's
> functional design lives at
> [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md);
> V2 inherits that surface unless this doc overrides it.

## 1. Pitch

Stoop is a **buurt-prikbord**: ask / offer / lend with the
people around you (neighbourhood, sports club, building,
family), with skill-based matchmaking, gated group membership,
and a privacy-first two-sided reveal flow. V2 keeps everything
V1 did and adds **standardised storage** — group state lives
on Solid pods when the crew has them, lives across member
pseudo-pods when it doesn't — plus **cross-pod refs** so a
supply offer can link to a Tasks task ("borrow X to do Y") or
a Folio note ("see my plant care guide").

The user experience for **no-pod crews** doesn't change from
today: group state still replicates eagerly across member
devices, the way `groupMirror` does in V1. The substrate work
that delivered `groupMirror` moves into `notify-envelope` +
`pseudo-pod` (§II.6 + §II.7 of the standardisation plan); the
no-pod capability is preserved as §II.2's fourth crew policy.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Storage adapts to crew policy.** Each crew (buurt /
   sports club / building / family) picks one of four §II.2
   policies. Default for new crews is **no-pod / pseudo-pod-
   replicated**, mirroring V1's experience. Crew creator can
   upgrade later via the crew settings page.
2. **No-pod crews keep working unchanged.** The substrate's
   pseudo-pod replication-ring mode reproduces `groupMirror`'s
   user-perceived latency + durability.
2a. **Connectivity-loss is first-class (locked 2026-05-11).** Crew
   policies are *preferences* with graceful degradation. Even
   pod-having buurts keep functioning when individual members are
   offline (no internet, pod provider down): the substrate falls
   back to pseudo-pod-replicated eager fan-out for that write, and
   the writer's pending-pod-upload queue drains to the buurt's pod
   on reconnect. Stoop doesn't branch on connectivity; the
   substrate handles it per-write. See plan §II.6 graceful-
   degradation block + substrates §4.4.5a. Upload-on-behalf
   (another buurt member uploading an offline writer's content)
   is **open V2 work** — particularly relevant for Stoop because
   buurts often include tech-shy members who never provision pods;
   questions documented in plan §II.6 + substrates §4.4.6 for
   later resolution.
3. **Web shell stays the desktop reference codebase.** Pages
   at `web/` (prikbord, chat, contacts, group settings,
   profile, push, privacy, metrics). Mobile mirrors via
   `src/ui/` re-exports.
4. **Lifts from V1's `src/lib/`** (per
   [`migration-tasks-v1-lifts-2026-05-08.md`](migration-tasks-v1-lifts-2026-05-08.md))
   continue: helpers move into shared substrates with `export *`
   shims left as re-export stubs.
5. **stableId-keyed identity** carries forward unchanged (Phase
   11). Mute / reveal / member-map all keyed on stableId.
6. **Pod sign-in is optional.** V1 Phase 20 lands the OIDC
   flow; V2 makes it the path users take when the crew picks a
   pod-having policy. Local-only-by-default stays.
7. **All persistent ledger writes route through `notify-
   envelope`** post-P1 — the substrate picks pod-primary mode
   or pseudo-pod-replicated eager fan-out based on the crew's
   policy. App code at the call sites stays the same.
8. **The `groupMirror` substrate retires by P3.** Its work
   moves into `notify-envelope` + `pseudo-pod` for pod-having
   crews, into the pseudo-pod replication ring for no-pod
   crews. Dual-run during P3 transition.
9. **Hub-track is separable.** The web app stays standalone
   through P3 + non-Hub-P5. Hub attachment lives in the web
   console (P5 Hub portion).

## 3. Core capabilities (carried from V1)

Stoop V1's full surface stays. Headlines (each preserved
unchanged in V2):

- **Identity + profile.** handle, displayName, avatar, skills,
  holiday-mode, location.
- **Group membership.** Codes rotate (default 30-day cadence;
  Phase 35 auto-evict on expiry). Redemption via
  `redeemInviteWithGate` (privacy + house-rules gates).
- **Browse + post.** Prikbord with kind chips (ask / offer /
  lend); broadcast via `skill-match`; mirror via the substrate
  (was `groupMirror` in V1).
- **Respond + coordinate.** 1:1 chat threads, claim flow,
  bilateral reveal handshake.
- **Lend lifecycle.** `notifier.scheduleBefore` reminders.
- **Contacts + lists.** Trust levels (bekend / vertrouwd);
  per-contact flags (shareLocation, hopThrough, autoMatch);
  per-contact tags; contact-list management (create / rename
  / delete / drag-into-list).
- **Auto-eviction filter.** Phase 35 — expired-code holders
  drop out of group view.
- **Picture attachments.** Bytes-in-message for chat photos
  (CHAT_PRESET); separate-blob with thumbnail for prikbord
  photos (PRIKBORD_PRESET).
- **Holiday-mode.** Suppresses notifications + skill-match.
- **Layer-2 personal-interest profile.** TF-IDF over post
  bodies the user responded to; `scorePostRelevance` combines
  Layer 1 (deterministic skills) with Layer 2 (interest
  cosine).
- **Skill-match auto-suggest.** Phase 22 — agent picks high-
  relevance posts in the crews the user belongs to + among
  hop-discovered peers + contacts.
- **Web Push.** `WebPushSender`, `PushRegistry`,
  `subscribeWebPush`, `/sw.js`, `/push.html` — desktop wakeup
  path.
- **Closed-beta runbook + metrics dashboard.** `/metrics.html`
  + Phase 19 hardening unchanged.
- **Group ops admin skills.** `listGroupMembers`,
  `postAnnouncement`, `editGroupRules`, `removeMember`,
  `listReports`.
- **Pod sign-in.** `startPodSignIn` / `completePodSignIn` /
  `signOutOfPod`. OIDC via `@inrupt/solid-client-authn-node`
  (V1 Phase 20). V2 makes this the path for pod-having crews.

## 4. What's new in V2

### 4a. Crew creation picks a §II.2 storage policy

V1 crews ran on `groupMirror`'s shape implicitly. V2 makes the
policy explicit in `createGroupV2`, with four options:

- **No-pod** (default for new crews) — pseudo-pod-replicated
  eager fan-out across members. Identical UX to V1's
  `groupMirror`; no pod required from anyone.
- **Centralised** — group state on a group pod. The group pod
  URI can be:
  - A freshly-provisioned dedicated buurt pod (admin picks
    a provider).
  - An admin's existing personal pod (their pod becomes the
    de-facto host; ACPs grant the crew access).
  - A shared household pod where the admin already has
    write access.
- **Decentralised + cross-pod refs** — each member's items on
  their own sharing-container; refs cross. Best for
  neighbourhood-scale crews (50–500 mixed members) where
  forcing a central pod has trust + bandwidth costs.
- **Hybrid** — canonical ledger on group pod; member drafts on
  own containers.

The create-group wizard explains the trade-offs in plain
language: "You can keep this group on phones only (default),
or set up a Solid pod for stronger privacy + persistence."

### 4b. Cross-pod refs in supply offers + neighbourhood-jobs

`postRequest` accepts an `embeds: [{type, ref}, …]` field. A
supply offer can link to:

- A Tasks task ("borrow this ladder to fix the bench" — task
  on the buurt's Tasks crew).
- A Folio note ("see my plant care guide").
- Another Stoop item ("part of a series of offers").

On the prikbord, embedded refs render as a small chip in the
post card (title + type pill). Tap-through opens the right
page in the right app (locally; cross-app Hub-mediated routing
is P6).

### 4c. Pod attach / detach in crew settings

A new section in `/group.html` per crew shows the crew's
current storage policy + a one-click "upgrade this group's
storage" affordance. Upgrade wizard provisions a group pod or
points at an existing pod (per §4a) and lazily migrates
content. Downgrade ("return this group to no-pod") is
explicitly **not** offered — once a pod-having crew always a
pod-having crew (data already lives on the pod).

`/profile.html` gains a "My Solid pods" section showing the
user's pod-attach status with a one-click "split into two pods
(recommended for stronger isolation)" preset. Full storage-
mapping editor lives in the Hub-web-console (P5 Hub portion).

### 4d. Standardised inbox shape

V2's inbox items carry the new `item-types` taxonomy types
(`supply-offer`, `demand-offer`, `lend-request`, `chat-message`,
`announcement`, `reveal-request`, `eviction-warning`, …).
Cross-app inbox aggregation still happens in the Hub (P4 / P6);
the per-app inbox now uses canonical type strings.

### 4e. groupMirror retires; substrate-mediated mirror lives on

V1 ships with the `groupMirror` substrate. V2 retires the
separate substrate; its work moves into
[`notify-envelope`](../Substrates/substrates-v2-functional-design-2026-05-11.md#§4.4-—-notify-envelope)
+ [`pseudo-pod` replication-ring](../Substrates/substrates-v2-functional-design-2026-05-11.md#§4.1-—-pseudo-pod).
The replication-mirror behaviour for no-pod crews is
preserved. P3 dual-runs both during transition; the flag
flips per-crew after parity tests pass.

## 5. User journeys

Six representative flows. The first five are the V1 V1-spec
journeys, lightly re-cast on V2 storage; journey 6 is new.

### Journey 1 — First run, joining a buurt

1. Open Stoop (web). Land on `/welcome.html`.
2. Pick "I have an invite link" → paste link.
3. Privacy + house-rules gates → handle picker → join.
4. See the prikbord, filled with the buurt's recent posts.
   (Group is no-pod by default; the user's pseudo-pod just
   received the full group state via the substrate's
   replication-ring mode.)
5. Optional: "Save your recovery phrase" prompt.

### Journey 2 — Posting a vraag with a photo

1. Tap "+" → post form.
2. Pick kind (ask / offer / lend) + audience picker (groups +
   contacts).
3. Type the question. Attach photos.
4. Submit → `postRequest` → substrate writes; envelope or
   eager fan-out per the buurt's policy.
5. Returns to prikbord with the new post pinned.

### Journey 3 — Responding to someone else's post

1. The user sees Anne's "Wie kan helpen met fietsband
   plakken?" matching their `cycling-repair` skill.
2. Tap "Ik help" → chat thread opens.
3. Type a reply, attach a photo of "the patch kit I have" →
   send.
4. Counterparty receives push (web push if their session is
   active; pseudo-pod replication ensures their offline
   devices catch up).

### Journey 4 — Bilateral reveal of real names

1. In a chat thread, tap "Connect" → confirmation prompt.
2. `requestReveal` ships through the substrate.
3. Counterparty's session: notification → can accept (mutual
   reveal) or decline.

Identical skill flow as V1; storage policy doesn't affect the
reveal handshake.

### Journey 5 — Lend lifecycle

1. Anne posts "Te leen — ladder t/m vrijdag" with a photo.
2. Bob taps "Ik wil dit lenen" → claim recorded via
   substrate.
3. Friday morning, both get a push: "Ladder weer terug bij
   Anne vandaag."
4. Bob taps "Teruggebracht" → item marked complete.

### Journey 6 — Buurt upgrades to a Solid pod

1. The buurt's admin decides the group should have a pod
   (privacy + persistence + maybe export-to-CSV).
2. From `/group.html` → storage section → "Upgrade this
   group's storage."
3. Wizard: provision dedicated buurt pod / use admin's
   personal pod / point at an existing shared pod. Picks a
   provider if going dedicated; runs OIDC if admin doesn't
   have a pod yet.
4. Substrate lazily migrates content; refs rewrite via
   per-user redirect map.
5. Other members' next read fetches from the new pod (cache
   warms on first hit). Their UX doesn't break; they don't
   need pods themselves (the group's pod is sufficient for
   centralised policy).

## 6. Pages

V2 ships these pages (V1's set + new ones in **bold**):

| Page | What's on it |
|---|---|
| `/index.html` (prikbord) | Feed with kind chips + filter + FAB-post + **embed-ref chips on cards** |
| `/chat.html` | Thread list |
| `/chat.html?thread=…` | Single thread, inline photos, reveal CTA |
| `/mine.html` | Own posts + claim management |
| `/contacts.html` | List + add via QR / manual + trust-level picker + per-flag toggles |
| `/profile.html` | Avatar + handle + skills + holiday + location + recovery + **"My Solid pods" section** |
| `/group.html` (per crew) | Members + code rotation + eviction banner + admin tools + **storage-policy section** |
| `/create-group.html` | 6-question wizard + **storage-policy picker** |
| `/settings.html` | Per-device (`pollIntervalMs`, `onlineWindow`, `allowHopThrough`) + shared (`broadcastable`, `defaultShareLocation`) |
| `/sign-in.html` | Pod OIDC sign-in |
| `/auth-callback.html` | Bulk-sync progress after pod sign-in |
| `/push.html` | Web Push opt-in + test |
| `/privacy.html` | Privacy notice (nl + en) |
| `/metrics.html` | Closed-beta dashboard |
| `/onboard.html` | Invite redemption |
| `/welcome.html` | New / Restore / Have invite |

No page is removed. The new explicit affordances are on
`/group.html` (storage-policy section) and `/profile.html`
(My Solid pods section); the embed-ref chips appear inline on
existing post cards.

## 6a. Implementation status (refreshed 2026-05-14)

V1 (Phases 0–22) ships today. V2 work is the standardisation
transition. Substantial substrate adoption shipped 2026-05-14;
the table is refreshed accordingly.

| Phase from plan | Stoop-specific work | Status (2026-05-14) |
|---|---|---|
| P0 | plan-tracking convention | **shipped 2026-05-14** — `Project Files/conventions/plan-tracking.md` |
| P1 | crew creation gains storage-policy picker; route writes through `notify-envelope` per policy; embed-refs in `postRequest`; `/group.html` + `/profile.html` storage sections | **shipped 2026-05-14** — substrate side: pseudoPod V0 + pod-routing + notify-envelope + Q-A canonical vocabulary + Q-B substrateMirror. App side: A4 embeds + chip rendering, A3 storage-policy picker on `/create-group.html` (four §II.2 policies; default `'no-pod'`), A5 `/group.html` storage section with admin-only one-way upgrade (`setCrewStoragePolicy` skill), A6 `/profile.html` "My Solid pods" section (status + sign-out; two-pod preset placeholder for V3) |
| P2 | adopt `item-types` for `supply-offer`, `demand-offer`, `lend-request`, `chat-message`, `announcement` | **shipped 2026-05-14** — Q-A canonical-vocabulary cut-over; Stoop posts now route through `canonicalAdapter` |
| P3 | **`groupMirror` substrate cut-over** | **shipped 2026-05-14** — Phase 52.9.2 retired `wireGroupBroadcastMirror` cleanly (no dual-run; clean break since no production users). Substrate path is now load-bearing for Stoop posts |
| 52.14 (Q-D) | Lamport `_v` conflict resolution on Stoop post writes | **shipped 2026-05-14** — substrate side + Stoop's `'stale-peer'` auto-heal subscriber in `wireSubstrateMirror` (publishes the local fresher copy back to the stale peer; silent auto-heal). `'concurrent-write'` UI affordance still pending (deferred to V3 unless real divergence shows up in field testing) |
| 52.15 | Solid-auth consolidation (`createSolidAuthNode` + `KNOWN_ISSUERS` on `/sign-in.html`) | **shipped 2026-05-14** — Phase 52.15.1-52.15.8. Stoop web sign-in already uses the consolidated path |
| 52.16 | Sharing v2 (ACP/WAC grant via `createClientSharing` when buurt moves to pod-having policy) | **substrate ready; app wiring pending** — when the storage-policy picker offers `centralised`/`hybrid`, the wizard should grant member access via `createClientSharing` (cap-token fallback for non-ACP pods) |
| 52.2.x | peer-fetch gates (Q#2 hybrid `groupCheck` + `capCheck`) | **shipped 2026-05-14** — `attachSubstrateMirror` registers `fetch-resource` on every bundle's agent with `groupCheck(uri, ctx) ⇒ mirror.getPeers().has(ctx.from)`. Defensive — closes the gap forward of envelope-only mode + cross-app embed-fetches. Eviction-aware sub-filtering is a V3 follow-up |
| P5 | adopt `agent-registry`; canonical app skeleton alignment (`src/lib/` shims) | **shipped 2026-05-14** — `attachSubstrateMirror` registers the agent via `createAgentRegistry({pseudoPod, deviceId})` (idempotent CAS upsert; soft-fail; opt-out via `agentRegistry: false`). 6/6 tests in `apps/stoop/test/agentRegistryWiring.test.js`. `src/lib/` shims already lifted per `migration-tasks-v1-lifts-2026-05-08.md` |
| P4 (Hub) | `hub-discovery` hook (no-op when Hub absent) | **deferred** (Hub track direction-only) |
| P6 (Hub) | register `chat-message` / `supply-offer` / `demand-offer` / `neighbourhood-job` interfaces; neighbourhood-job as protocol | **deferred** (Hub track direction-only) |
| P7 (Hub) | bundle refactor (Stoop second, after Tasks proves the pattern) | **deferred** (Hub track direction-only) |

The P3 cliff cleared 2026-05-14 (groupMirror retired). The
remaining V2 web work is the **app-level UX surface** that
exposes the now-shipped substrate capabilities to users:
storage-policy picker, embed-refs, `/group.html` +
`/profile.html` storage sections, `'stale-peer'` event handler,
and the `groupCheck` wiring on `fetch-resource`.

Cross-references:
- Substrate-side phase list:
  [`../Substrates/substrates-v2-coding-plan-2026-05-11.md`](../Substrates/substrates-v2-coding-plan-2026-05-11.md)
- Cross-app residuals + priority:
  [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Standardisation residuals"
- Coding plan with adoption track:
  [`coding-plan-v2-2026-05-07.md`](coding-plan-v2-2026-05-07.md)
- Q-D design (conflict resolution):
  [`conflict-resolution-design-2026-05-14.md`](conflict-resolution-design-2026-05-14.md)

## 7. Locales

V2 reuses `apps/stoop/locales/{nl,en}.json`. New keys for the
storage-policy picker, the "My Solid pods" profile section,
embed-ref chip labels, and any group-pod-related copy
(provider list, migration progress). The `{text, doc}` leaf
shape applies unchanged.

The Stoop locales remain the canonical buurt-tone Dutch
voice + English equivalents; mobile inherits via the locale
resolver substrate.

## 8. Open questions

- **Default policy for new crews — no-pod or
  user-picks-during-wizard?** Recommendation defaults to
  no-pod; the wizard surfaces a one-sentence "you can
  upgrade later" affordance. Pin during P1.
- **Two-pod upgrade UX for users with sensitive buurt data.**
  How prominently to surface in `/profile.html`? Defaults:
  banner during first-run, then dismissable; lives in profile
  thereafter.
- **`groupMirror` cut-over signalling to users.** Should
  pod-having crews see a "you've been upgraded" toast? Or
  just-invisibly-happen? Pin during P3.
- **Embed-ref UX on post cards.** Inline chip with limited
  preview, or full unfurled card? Pin during P6 with the
  interface registry contract.
- **Cross-buurt visibility.** Today's V1 design says "buurt
  belongs to a buurt." Cross-buurt requests (a contact in
  another buurt sees a request) is partial in V1 (`flag_share
  _location` per contact). V2 doesn't extend this; tracked
  separately.

## 9. Non-goals

- **Bundle refactor pre-P6.** Stoop ships as a normal app
  through P3 + P5 (non-Hub portion); the bundle shape is
  P6/P7 territory.
- **Hub-attachment in the web app.** The Hub-Android is the
  binding surface, not the web. Lost-phone recovery goes
  through the Hub-web-console (P5 Hub portion).
- **Cross-buurt unified feed.** V1 keeps per-buurt feeds; V2
  doesn't aggregate cross-buurt automatically. Cross-buurt
  posts via the audience picker (V1) carry forward.
- **Voice posts / video.** V3 territory.
- **Anonymity protocol.** Parked since pass-3 design; not in
  V2 scope.
- **Activities / hobbies variant of the app** (future product
  fork — tracked separately).

## 10. Phases

Phasing is the standardisation plan's §III.A; Stoop-specific
work mirrors §IV.2 of the transition doc. No new phase numbers
in this doc — V2 work is the standardisation work applied to
Stoop.

The `groupMirror` cut-over (P3) is the load-bearing risk and
the longest single sequencing step. Per the transition doc:
two weeks of dual-path runtime + parity tests + per-crew flip
once tests pass for both pod-having and no-pod crews.

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Stoop consumes the
  keypair + dual-auth + WebID-discovery surface.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Stoop-relevant sections: §4.1
  pseudo-pod (incl. replication-ring mode that absorbs
  `groupMirror`); §4.3 pod-routing (four crew policies);
  §4.4 notify-envelope (per-write mode picker); §4.5
  item-types (`supply-offer`, `demand-offer`,
  `chat-message`, `neighbourhood-job`); §4.6
  agent-registry; §5.4 notifier (legacy-path retirement at
  P3 — Stoop's `groupMirror` is the load-bearing case).
- V1 functional design:
  [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md).
- V1 (current) implementation: [`apps/stoop/README.md`](../../apps/stoop/README.md).
- V1 demo script: [`apps/stoop/DEMO.md`](../../apps/stoop/DEMO.md).
- V1 closed-beta runbook:
  [`apps/stoop/CLOSED-BETA-RUNBOOK.md`](../../apps/stoop/CLOSED-BETA-RUNBOOK.md).
- Mobile companion:
  [`v4-mobile-functional-design-2026-05-11.md`](v4-mobile-functional-design-2026-05-11.md).
- Privacy + identity model:
  [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md).
- Pod layout: [`pod-layout-2026-05-06.md`](pod-layout-2026-05-06.md).
- Migration lifts inventory:
  [`migration-tasks-v1-lifts-2026-05-08.md`](migration-tasks-v1-lifts-2026-05-08.md).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
