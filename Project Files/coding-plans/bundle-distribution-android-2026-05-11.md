# Bundles on Android — distribution + runtime collaboration sketch (2026-05-11)

> **Status: merged + superseded, 2026-05-11.** This sketch has
> been merged into
> [`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md)
> — its content lives in §II.13 (destination shape, expanded with
> sub-headers for distribution, IPC surface, rendering modes,
> cross-bundle data, F-Droid future track), §I.5.10–§I.5.13 (new
> user journeys), §III.B (substrate inventory updates), and §III.C
> (risk updates). See the standardisation plan's 2026-05-11
> changelog entry for the merge details.
>
> The "shrinkage" thread discussed during this sketch's authoring
> (tiered standalone APKs, dropping BLE/mDNS from standalone apps,
> lite/full APK variants) was **deliberately not merged.** Per
> design call: don't shrink pre-emptively; revisit only when real
> users complain about install size.
>
> This file is kept as a historical artifact. The canonical content
> lives in the standardisation plan; this sketch is preserved
> verbatim for audit / decision-trail purposes.
>
> ---
>
> *Original sketch status (pre-merge):* sketch, non-binding.
> Captured the 2026-05-11 design discussion about how the "apps
> as bundles" idea from the brainstorm ships through Google Play
> and how bundles collaborate with the Hub at runtime once
> installed.
>
> **Scope expanded from the morning's draft.** The original doc
> only covered distribution. This restructure adds runtime
> collaboration — rendering, bundle ↔ Hub influence, cross-bundle
> data sharing — because the design questions are entangled.
>
> **Companion docs:**
> [`play-store-risk-2026-05-07.md`](./play-store-risk-2026-05-07.md)
> (the binding constraint),
> [`AgentHub/hub-functional-sketch-2026-05-07.md`](./AgentHub/hub-functional-sketch-2026-05-07.md)
> (the existing Hub design),
> [`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md)
> (the surrounding plan).

---

## 1. Why this doc exists

Two ideas pull in different directions, and a third question
emerges once you reconcile the first two.

**The brainstorm vision.** "Apps as bundles" — lightweight
plugins that register types, interfaces, and protocols with a
Hub-shell; the user installs the Hub once, then adds bundles
like browser extensions. The infrastructure (auth, transport,
pseudo-pod, inbox) is shared; bundles are small.

**Play Store reality.** The existing
[Play Store risk audit](./play-store-risk-2026-05-07.md) rates
the "Agent Host" pattern — a Hub that loads JS from URLs with
bridges to native APIs — as **🛑 blocked-as-designed** under
Google's Device and Network Abuse policy. The prohibited
language is "webview with added JavaScript Interface that loads
untrusted web content or unverified URLs obtained from
untrusted sources." The carve-out for interpreted JS only
applies when there's no native-API bridge — which would lose
the SDK's value entirely.

**Once distribution is settled, runtime collaboration becomes
the next question.** If bundles are separately-installed APKs
(rather than dynamically-loaded JS), how do they:

- Render flexibly without each renderer ballooning to handle
  every embedded type?
- Influence the Hub's behaviour (polling cadence, foreground-
  service stickiness, wake-on-event latency) when their needs
  differ?
- Search and embed data items across each other, with sane
  permission semantics?

This doc answers all four threads in one place.

---

## Part I — Distribution

## 2. The runtime-adaptation pattern

Each app ships as a full standalone Android APK through Play
Store. On launch (and on subsequent re-checks via
`PackageManager`), the app detects whether the Hub is installed.
Two runtime modes:

**Hub absent → standalone mode.** The app runs with its own
embedded substrate set: own pseudo-pod, own OIDC handling, own
inbox view, own transport. Functionally equivalent to today's
Tasks-mobile. The user gets a complete app.

**Hub present → registered-bundle mode.** The app registers
with the Hub on launch via Android IPC (bound `Service` or
`ContentProvider`), then defers heavy infrastructure to the Hub:

- No own relay socket — the Hub holds it; the app subscribes via IPC.
- No own OIDC flow — the Hub brokers authenticated fetches.
- No own pseudo-pod — the Hub hosts the device-wide one.
- No own foreground-service slot — the Hub multiplexes.
- No own inbox view — the Hub renders the unified inbox.
- No own BLE/mDNS scanners — Hub does it.

What stays in the app's process either way: the bundle's own UI
(task detail, supply-offer composer, calendar item viewer), the
substrates that shape its data domain (item-store contracts,
role policy, DAG logic), and the locale strings.

The pattern is a familiar Android idiom — Tasker + AutoApps,
some launcher integrations, F-Droid's client itself — and is
free of Play Store policy concerns because:

- No remote code is downloaded and executed (the bundle code is
  shipped in the APK, vetted by Play).
- IPC between separately-installed apps is a standard Android
  primitive.
- Each bundle has its own Play listing, permissions, update
  cycle.

## 3. What actually shrinks

Honestly mixed. Precise picture:

| Dimension | Standalone mode | Hub-present mode (same APK) | Hub-only APK (hypothetical lite) |
|---|---|---|---|
| APK download size | full | **full** (one APK contains both modes) | small (~3–5× smaller) |
| Disk footprint after install | full | full | smaller |
| Memory at runtime | full | **smaller** — unused substrates loaded but not running | smaller |
| Battery cost | high | **low** — Hub absorbs always-on work | low |
| Background processes per device | N (one per app) | **1** (the Hub) | 1 |
| Network footprint | N relay sockets | **1 shared via Hub** | 1 shared |
| Cross-app coordination cost | nil | free (Hub mediates) | free |

Under the single-APK + runtime-adaptation model: **install size
doesn't shrink**, but **everything else gets materially better
when the Hub is present.** The user sees a lighter system in
practice; the install footprint stays the same.

The "lite-only" path (separate APK for Hub-required users)
would shrink the install size — see §4 Option 3 for the
trade-offs.

## 4. Distribution options for V1

Four realistic shapes. They differ in install footprint,
maintenance cost, and Play policy risk.

| Option | Install size with Hub | Codebase cost | Play risk | Recommended |
|---|---|---|---|---|
| **1. Single APK + runtime detection** | full | low (one APK per app) | zero | **V1** |
| 2. Hub-mandatory lite-only | smallest | low | medium-high | no |
| 3. Full + lite variants per app | smallest (lite) | high (2× APKs) | low | revisit post-V1 if size complaints surface |
| 4. Android Dynamic Feature Modules | smaller | medium | low | post-V1; specialised |

### Option 1 — Single APK with runtime adaptation (recommended)

Each app ships one Play Store APK that works standalone AND
upgrades itself to a registered bundle when the Hub is
detected.

- **Pros:** Play-safe (no judgement calls). One APK per app to
  maintain. Works for users who don't know the Hub exists.
  Users can install in any order. Uninstalling the Hub doesn't
  break apps.
- **Cons:** Install size stays full per app. Some duplicate
  infrastructure shipped in every APK even though it sits idle
  when the Hub is present.

### Option 2 — Hub-mandatory APKs

Small APK; explicitly requires the Hub; non-functional without
it.

- **Cons:** Risk of Play rejection under "minimum functionality."
  Google has historically been hostile to apps that are
  non-functional without another specific app; policy tightened
  2024–25. Some categories survive (Wear OS companions); needs
  Play Console pre-review to know.

### Option 3 — Full + lite variants

Two APKs per app: "Tasks" (full standalone) and "Tasks Lite"
(Hub-required). Precedent: Facebook + Facebook Lite, Spotify +
Spotify Lite.

- **Cons:** Two APKs per app to maintain; doubled CI/release
  surface; user confusion at Play ("which one?"); marketing
  burden.

### Option 4 — Android Dynamic Feature Modules

One Play listing per app; the "standalone" capabilities live in
a feature module downloaded only if the Hub isn't detected.

- **Cons:** Play Asset Delivery restrictions; feature modules
  fiddly to author for general-purpose code; complexity is real.

**Recommendation: Option 1 for V1.** If install size becomes a
real complaint, revisit Option 3 or 4. Don't introduce the
overhead pre-emptively.

---

## Part II — Runtime collaboration

Once a bundle is installed and registered with the Hub, three
collaboration questions arise. They're independent of
distribution but tightly entangled with each other.

## 5. Two-mode rendering — flexible items without interface chaos

The risk: if anything can reference anything (a chat message
embeds a task, a task embeds a calendar item, a calendar item
embeds a neighbourhood-job), each renderer can balloon to handle
every possible embedded type.

The fix: **every type's registered interface ships two
rendering modes.**

- **Compact mode (preview / chip / inline).** A small
  fixed-shape card: title + status pill + one or two metadata
  fields + an "open" affordance. Used when this item appears
  *inside* another item — as a link in a chat message, as an
  attachment to a task, as a row in a search result. Bounded
  size, bounded layout, predictable.
- **Full mode (detail view).** The complete UI for the item.
  Used when the user opens it directly.

This is how Slack / Discord / Telegram / Notion render embedded
links: a small unfurled card inline; a full page when you click
through. The taxonomy of compact modes is small (chip, card,
row); the taxonomy of full modes is one-per-type.

A chat-message renderer doesn't have to know how to render a
task — it just asks the interface registry for "render this ref
in compact mode" and the registered task renderer handles it.
Bounded responsibilities; no per-renderer combinatorial
explosion.

**Substrate consequence.** The interface registry's contract
requires *both* modes from any bundle that registers a type. A
bundle shipping only a full-mode renderer either falls back to a
generic compact (the Hub provides a default chip "<Type>:
<title>") or fails to register the type. Bundles can register
multiple compact variants if useful — `compact/chip`,
`compact/row`, `compact/card` — but at minimum one compact mode
is mandatory.

## 6. Declarative IPC — how bundles influence the Hub

Bundles have different runtime needs. A chat bundle needs
notifications within seconds; a task bundle is fine with
5-minute polling. The Hub can't get its behaviour dictated by
each bundle's specific demands — but it does need to know what
the installed bundles need so it can pick the tightest schedule
that satisfies all of them.

The pattern: **bundles declare requirements on registration;
the Hub aggregates and adjusts.**

A registration message includes a declarative capability-needs
section, roughly:

- `polling`: minimum cadence the bundle needs for its
  notifications.
- `wakeOnEvents`: list of event-kinds the bundle wants to be
  woken for.
- `foregroundSlot`: whether the bundle's activity expects to
  hold a foreground-service slot when active (and for how
  long).
- `socketRetention`: whether the bundle needs persistent
  relay-socket connections vs occasional polling.

The Hub computes the union: tightest polling, longest-lived
sockets, slot ownership. Re-declarations on bundle activity
change (user opens the chat bundle's activity → "I'm
foreground now, keep the slot warm" → Hub upgrades; user
backgrounds it → "fine to relax" → Hub downgrades).

**Why declarative rather than imperative.** Imperative ("force
the Hub to poll every 30 seconds") gives bundles too much
power and creates a race ("multiple bundles fighting for the
schedule"). Declarative ("I need notifications within 30
seconds") lets the Hub mediate — pick the tightest declared
requirement, apply it, share the cost.

**Why not "one giant app."** It's the obvious alternative —
no IPC, no version drift, no separate listings. But one-app:

- Contradicts the brainstorm's vision of bundles you opt into.
- Forces every user to download every feature, even unused
  ones.
- Loses clean install/uninstall granularity (the user wants
  Folio but not Stoop — can't, it's all one app).
- Concentrates the maintenance and review burden.

Declarative IPC keeps bundles independent while letting them
shape the system's runtime behaviour.

**Substrate consequence.** The `agent-registry` substrate (or
the binding-protocol substrate, depending on where this lives)
gains a "capability requirements" field on registration. The
Hub's scheduler reads the union of installed bundles'
requirements and applies it.

## 7. Cross-bundle data — search, embed, permissions

Three small but related capabilities:

**Cross-pod search.** A bundle composing a message wants to
embed a task. The user taps "embed item"; the substrate
searches across the user's pods + the group/project pods they
participate in; the user picks; a ref is inserted.

**Substrate role:** `pod-search`. Lives inside the pseudo-pod
(cache makes the common case fast; falls through to upstream
pods on miss). Exposed via the bundle ↔ Hub IPC surface.

**Embed-by-ref.** Apps insert a typed ref into their own items
(`{type: 'task', ref: 'https://anne.solid/.../tasks/t-42'}`).
No copy; just a URI + the type label so the renderer knows
which compact-mode to invoke.

**Substrate role:** part of the `item-types` taxonomy — every
item type's schema explicitly allows embedded refs to other
items via a standard `embeds: [{type, ref}, …]` field. Renderer
contract: walk the embeds array, render each in compact mode,
let the user tap through to full mode.

**Graceful permission failure on receive.** Send the ref; let
the recipient handle missing permission gracefully — same
pattern Google Docs / Notion / Linear use.

- The sender doesn't pre-check the recipient's permissions
  (brittle: ACPs change; trust costly: requires querying the
  recipient's view).
- The recipient's renderer attempts the fetch; on 403 / 404,
  the interface registry's default placeholder kicks in:
  "🔒 You don't have access to this `<type>`" with an
  optional "request access" affordance.
- The sender can optionally tick a "grant <recipient> access
  to this resource" box at send time. The substrate writes an
  ACP update to the referenced resource as a side effect.
  **Opt-in, not automatic** — most of the time the user
  doesn't want to widen ACPs just because they pasted a link.

**Why send-anyway-then-fail-gracefully is right.** Pre-check
creates false confidence (ACPs can change between check and
fetch); pre-check costs trust (sender needs privileged view of
recipient's permissions); graceful failure is the
industry-standard pattern users already understand.

**Substrate consequence.** The interface registry ships a
default "permission-denied" rendering for each type that
bundles can override. The `pod-routing` substrate handles the
"share access on send" side-effect when the sender opts in.

---

## Part III — Stories + forward

## 8. User stories

Concrete journeys tying distribution and runtime collaboration
together.

**§8.1 — User installs an app before the Hub.** Anne installs
Tasks from Play Store. She uses it standalone for a few weeks —
her own pods, her own relay socket, her own inbox. Later she
discovers the Hub, installs it, OIDC-auths her WebID. The Hub
announces itself; Tasks re-checks on next launch, sees the
Hub, declares its capability requirements (5-minute polling
on task-change events; no FG-slot needed; relay-socket-poll
acceptable), and switches to registered-bundle mode. Anne
notices: less battery drain, one foreground-service
notification instead of one per app, a unified inbox in the
Hub aggregating Tasks items alongside everything else.

**§8.2 — User installs a chat bundle.** Anne installs the
chat bundle from Play Store. On launch, it registers with the
Hub, declares tight requirements: 30-second polling on
chat-message events; persistent relay socket; FG-slot while
the chat activity is foregrounded. The Hub's scheduler
upgrades (it was on Tasks's 5-minute cadence; now it's on the
chat bundle's 30-second). When Anne backgrounds the chat
bundle, it re-declares "I'm fine with relaxed polling now,"
and the Hub downgrades back.

**§8.3 — Embedding a task in a chat message.** Anne is in the
chat bundle. She types a message, taps "embed item," sees a
search UI showing her recent + relevant items across her pods.
She picks "Paint the fence (task)." The chat message goes out
with `{embeds: [{type: 'task', ref: 'https://anne.solid/.../tasks/t-42'}]}`
in its body. Bob's chat renderer receives it; for the embed,
it asks the interface registry for "task in compact mode";
the task bundle's registered compact renderer fetches the
task from Anne's pod and renders a small chip with title +
status pill + "open" affordance.

**§8.4 — Embedded ref without permission.** Same scenario as
§8.3 but Bob isn't a member of Anne's crew. The compact
renderer's fetch returns 403. The interface registry's default
permission-denied rendering kicks in: a small chip showing
"🔒 You don't have access to this task" + a "request access"
button. Bob clicks it; the substrate sends an access-request
to Anne's pod; Anne sees a notification in her inbox.

**§8.5 — User uninstalls the chat bundle.** Anne uninstalls
the chat bundle. The Hub notices, re-aggregates capability
requirements without it (back to Tasks's 5-minute polling),
relaxes its schedule. No reboot needed; no orphaned sockets.

**§8.6 — User uninstalls the Hub.** Anne uninstalls the Hub
for some reason. Each of her installed bundles re-checks on
next launch, finds the Hub gone, and falls back to standalone
mode: each app starts running its own relay socket, its own
inbox, its own foreground-service slot. Nothing breaks; the
system gets heavier per the table in §3. The user can
re-install the Hub at any time and the bundles re-register.

## 9. F-Droid / sideload future track

The brainstorm's truly-tiny-plugins dream — paste a URL, get a
new bundle running — isn't dead under this plan; it's just
**not Play-distributable**.

F-Droid (and direct sideload) operate outside Google's Device
and Network Abuse policy. A Hub variant distributed through
F-Droid could allow the dynamic-bundle-loading shape Google
prohibits, with the same JS-sandbox + signature-verification
machinery the brainstorm envisaged.

This is a **separate distribution channel** for users who opt
in to the looser policy. The default Play-shipped Hub stays
strict; the F-Droid Hub adds dynamic bundle loading on top.
Same codebase; different feature flags.

**Not in this plan.** F-Droid track is tracked as a long-arc
distribution-channel addition; concrete work waits until V1
ships and we see what the Play-side Hub looks like in
practice. The standardisation plan should mention it under
"non-goals for V1" so it stays visible without committing to
a date.

## 10. Implications for the standardisation plan

If we accept this sketch's recommendations, here are the
edits the standardisation plan would need (the list to react
to tomorrow):

### Distribution (from Part I)

1. **§II.13 destination shape.** Clarify that a bundle on
   Android is a separately-installed Play Store APK that
   registers with the Hub via IPC. The manifest is in the
   APK's metadata, not in downloaded JS.
2. **§II.9 mobile-independence + Hub split.** Add a subsection
   on "with-Hub vs without-Hub runtime modes." Apps detect;
   behaviour adapts.
3. **§II.12 developer experience.** The scaffolder CLI
   generates a single APK with runtime adaptation, not a JS
   bundle + Android wrapper. Capacitor / Expo lineage rather
   than browser-extension lineage.
4. **Non-goals.** Add: "Bundles as remote-loaded JS modules
   (browser-extension-style installation) — not
   Play-distributable under current Google policy. Tracked as a
   future F-Droid / sideload distribution channel, not
   committed to a date."

### Runtime collaboration (from Part II)

5. **§II.13 destination shape — interface registry contract.**
   Every registered type's interface ships two rendering modes:
   compact (chip/row/card) and full (detail view). At least one
   compact mode is mandatory.
6. **§III.B substrate inventory.** `interface-registry`
   substrate's role description expands to include the
   two-mode contract and the default permission-denied
   rendering. `agent-registry` (or the binding-protocol
   substrate) gains a "capability requirements" field on
   bundle registration. A new role `pod-search` lives inside
   the pseudo-pod for cross-pod search.
7. **§II.13 destination shape — declarative IPC.** Bundles
   influence the Hub via declarative requirements on
   registration (polling cadence, wake-on-event subscriptions,
   foreground-service expectations). The Hub aggregates and
   picks the tightest schedule.
8. **§II.13 destination shape — embed-by-ref.** Every item
   type's schema explicitly allows an `embeds: [{type, ref}, …]`
   field. Renderers walk the embeds array and call the
   interface registry for each in compact mode.
9. **§II.13 destination shape — send-anyway permissions.** No
   pre-check on send; recipient's renderer handles 403/404
   gracefully via the registry's default permission-denied
   rendering. Optional opt-in "grant access on send"
   side-effect via `pod-routing`.

### Risks

10. **§III.C risks — drop.** "Interface registry conflict UX"
    (resolved by Android's "default app for type" picker at
    the OS level, not by Hub-internal settings).
11. **§III.C risks — add.** "Bundle ↔ Hub IPC version drift"
    (apps and Hub update on separate cycles; IPC surface
    needs versioning). "ACP edge cases on cross-pod refs"
    (already partly tracked; gets sharper given the embed +
    cross-bundle flows).

### User stories

12. **§I.5 user journeys.** Revise §I.5.1, §I.5.2, §I.5.6 per
    Part I §8.1 + §8.2 + §8.4. Add three new journeys: §I.5.10
    (chat bundle changes Hub schedule), §I.5.11 (embed a task
    in a chat message), §I.5.12 (embedded ref without
    permission renders as locked-chip with request-access).

## 11. Open questions

1. **IPC surface versioning.** Apps and the Hub will update on
   separate cycles. The IPC surface needs a versioning story so
   a stale app can still talk to a new Hub (graceful
   degradation) and vice versa.
2. **Permissions on the IPC surface.** Each app that registers
   with the Hub gets access to some Hub-mediated capabilities
   (pod fetches, inbox writes, etc.). What's the granularity?
3. **Standalone-mode coherence.** When apps run standalone, do
   they each get their own OIDC session against the same WebID,
   or do they delegate to a per-app secondary identity? The
   identity model (§II.8 in the plan) anchors on the WebID; the
   practical UX of repeated OIDC flows across N standalone apps
   is unpleasant. Worth a sub-decision.
4. **Migration when the Hub becomes available.** A user who's
   been running Tasks standalone for months has built up local
   state in Tasks's own pseudo-pod. When the Hub arrives,
   migrating Tasks's state into the Hub's pseudo-pod is a
   non-trivial one-time op. Worth a P5 sub-task.
5. **Bundle discovery without remote loading.** The user only
   knows about bundles that have a Play listing. The Hub could
   show a "recommended bundles" list with Play deep-links — but
   who curates? Is this a project-run page, federated,
   community-maintained?
6. **Capability-requirements default values.** When a bundle
   doesn't declare any requirements, what's the Hub's default
   schedule? Conservative (5-minute polling, no socket) vs
   permissive (always-on socket)? Conservative is safer for
   battery; permissive is friendlier for chat-style bundles
   that forget to declare.
7. **Compact-mode taxonomy.** Is it just chip/row/card, or do
   we need more (banner, hero, miniature)? Pinning this at
   substrate authoring time avoids fragmentation; expanding it
   later is cheap if needed.
8. **Embed depth limits.** Does the renderer allow nested
   embeds (a chat message embeds a task that embeds a calendar
   item)? Each level adds rendering cost + fetch cost. Probably
   limit to 1 level of nesting for now, expand if real use
   cases trip.

## 12. Source

Discussion thread on 2026-05-11 in the chat session that
authored this doc. Builds on
[`play-store-risk-2026-05-07.md`](./play-store-risk-2026-05-07.md)
(the binding policy constraint) and
[`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md)
(the plan this work threads back into).

The Dutch brainstorm that originally proposed the apps-as-bundles
idea — and that this doc reconciles with Play policy + runtime
collaboration patterns — is preserved verbatim in the
standardisation plan's source thread.
