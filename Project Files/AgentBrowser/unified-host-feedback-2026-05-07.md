# Unifying Hub + Browser into one Android "ground-layer" app — feedback (2026-05-07)

> Status: **feedback note from a design dialogue**, not a coding plan.
> Captures an honest read on whether to merge
> [`./design-2026-05-07.md`](./design-2026-05-07.md) (the Browser seed)
> with [`../AgentHub/agent-hub-design-2026-05-05.md`](../AgentHub/agent-hub-design-2026-05-05.md)
> (the Hub seed) into a single Android-only host app, plus creative
> ideas for the functional sketch.
>
> Premise being evaluated: one ground-layer app, Android-only at first,
> that runs any JS app built on the SDK + substrates, exposes a stable
> host API to those apps, and centralises pod login / capability
> management so guest apps don't carry phone-compat concerns.

## The big picture

The merger is more natural than the two seeds suggest. Consider what
each side already needs:

- The **Hub** needs a UI: capability prompts, agent registry, profile
  switcher, audit timeline. That's already 80% of an app shell.
- The **Browser** needs everything the Hub holds: one relay
  connection, one pod credential, scoped capability tokens, identity
  facets, audit emission.

They share the manifest concept; both are now phone-side per the
2026-05-08 update in [`../projects/README.md`](../projects/README.md);
both are heavyweight enough that asking users to install two
ground-layer apps is a tax. **One app — "the place agentic apps live
on your phone"** — is a cleaner story than "install the Hub, then
install the Browser, then install your apps."

So: yes, unify. The design intuition is right. But hear out the costs
before committing.

## Honest concerns

### 1. Trust concentration

This single app holds your pod refresh token, every capability token,
every agent facet's identity material, every app's audit log, and the
relay connection that all your peers route through. Compromise of
this one app = total compromise of your decentralised story.

The Hub doc already names this ("higher-value target"); the Browser
merge amplifies it. Worth designing the recovery flow (encrypted
pod-side backup + re-pair on new device) before the happy path, not
after.

> need MFA or something like that. Also, this holds for many services (like google account for gmail. drive and more), so it is not that weird

### 2. Update lockstep risk

Today, Stoop ships independently of any "platform." Once Stoop is a
guest of the host, every breaking change to the host's runtime API
cascades to every guest. You're trading library versioning for
*platform* versioning.

The mitigation is a versioned `@host` API surface with a deprecation
window, but commit to that contract early — it's much harder to
retrofit later.

> the webversions will keep working, so in that sense it is more platform independent. Also the whole browser app will be opensource, so lightweight/specialized variants can be developed too

### 3. JS-only is a real constraint

Any guest app that needs a native module the host hasn't pre-bundled
is dead in the water. Stoop today imports `react-native-webrtc`,
`expo-sqlite`, `expo-file-system`, `expo-notifications`, etc. — the
host has to ship a *superset* of every guest's native needs, frozen
at host-release time.

The L0-react-native peer-deps matrix (Expo 52, RN 0.76.9,
`react-native-webrtc` 124.0.7, `react-native-get-random-values` ^1.11)
becomes the host's contract; a guest pinning differently can't run.
Fine if disciplined; bites if a guest needs a binding that wasn't
anticipated.

> I think JS already offers a lot of flexibility itself. Next to this, the most important things the browser/hub need to offer are hardware API's and the transport layer + agentic logic. The substrates  (JS) dont need to be included: they are just tools for development. Do you still think this will be heavy? And even if it is heavy: it is a multipurpose app,  potentially covering most of the phone functions that users need, so that could compensate quite a bit. 

### 4. Inter-app cooperation becomes first-class

Once Stoop and Tasks both run inside the host, users will reasonably
expect Stoop's "I need someone for this errand" to be able to spawn
a Tasks chore, and Tasks's "complete" to update Stoop's post.

That's a new design surface (Android-intent-shaped routing, with
capability mediation). Don't pretend it'll emerge from the substrate;
design it into the host from V1 or it gets retrofitted painfully.

> That sounds cool right? :D

### 5. Distribution path is narrow

Play Store will likely reject this — an app that loads and runs other
apps' code is exactly what their policies forbid. F-Droid + sideload
+ APK-from-pod is the realistic distribution.

Fine for the agent-SDK community; rules out viral consumer growth.
Honest framing: a power-user / ideologically-aligned product on
Android, not a mass-market launcher.

> Alright, so the need for separate apps wont cease to exist, which is fine. Im just wondering: what if it really functions as a normal browser too? Wouldnt that be acceptible? But yeah, maybe for the F-droid community it would be cool (as long as it really could be proven to be safe )

## Creative ideas for the functional sketch

### A. The home screen IS the audit timeline, not an app grid

Inverts the Browser doc's "I open Stoop / I open Folio" flow. Top of
screen: live event feed — *"Stoop posted to Buurt-Zuid 3 min ago",
"Tasks claimed a chore for you", "Folio synced to pod"*. Tap a row →
details + revoke-this-capability shortcut. App tiles are a tab away.

Makes the "user empowerment first" framing visible on first launch,
not buried in a settings screen. Concretely reuses L1-L2 of the
monitoring substrate as the home UI, free.

> Nice idea!
### B. Capability badges on every app tile

Each tile shows a 3-dot summary at a glance: 🟢🟢🟡 = (pod write
narrow / hardware none / network 1 declared host). Long-press a tile
→ see the manifest.

Lowers the risk of sleepwalking through "Allow?" prompts; users learn
to read the badges instead.

### C. Personas, not just facets

Top-bar swipe between "the author", "the author-Work", "the author-Anonymous". Each
persona = a bundle of agent facets + a whitelist of enabled apps + a
presence policy. Switch = the whole device shifts who-you-are-online.

Solves the multi-context problem the Hub design's "profiles" open
question gestures at, and gives a  physical metaphor (Android
user profiles are too coarse; this is finer).

> jaaa, cool
### D. Intent registry as a host primitive

Apps declare in their manifest *what intents they receive* and *what
intents they emit*. The host mediates: Stoop emits
`task.create({title, deadline})` → host sees Tasks is registered for
that intent → user gets a one-line "Send to Tasks?" → on accept,
capability-checked dispatch.

Direct app-to-app calls are forbidden; everything goes through the
host. This is the Android intent model at the agent layer, with
capability tokens making refusal trivial.

> exactly!

### E. One foreground-service notification, owned by the host

The Hub doc names this in passing; make it explicit.

Guest apps cannot register their own foreground services. Instead
they declare a "background slice" in the manifest ("I want to wake
on inbound message kind X"), and the host's single FG-service
multiplexes for all of them.

This is exactly the linear-cost problem the original Hub motivation
called out — solved concretely in one stroke.

> i think i dont understand this completely, please elaborate
### F. Apps install from the user's pod, not from a central catalogue

A guest app is a signed `.agentapp` bundle. Where do users find them?
`solid://.../catalogue.json` — a list of
`{name, url, signature, manifest-summary}`.

The user follows curated lists by URL (a friend's, the official Hub
one, a community one). Installing = host fetches the bundle, shows
manifest, asks for consent.

Decentralised app distribution that doesn't need a centralised store
and doesn't need each app to live on its own GitHub. Curators are
just users with a pod-hosted JSON file.

> Yes, it could be from anywhere, the browser should keep it safe (for example: blocking any traffic that is not agreed upon by the user). Same with

## A suggestion before writing the merged design

Two things worth nailing down first:

### 1. The `@host` API surface, in TypeScript-shape, even informally

Two screens of `interface AgentHostAPI { ... }`. Once that's drafted,
the merger is concrete: it's the union of what the Hub-as-broker
exposes + what the Browser-as-runtime exposes, behind one import.

Most of the design dialogue then reduces to "is *this method* on the
host or in the app." That's a productive frame.

### 2. Pick one guest app for V1 and design the host backwards from it

Stoop V2 is the obvious candidate. It's the most mature, it already
runs on phone, and the V3-mobile work is half-done by lifting
`serviceFactory` and `backgroundTasks` (commit `ff07f34`).

"The host runs Stoop V2 unmodified" is a sharper north star than
"the host runs any SDK app."

## Open questions parked for the merged design doc

- **Recovery / re-pair flow** when the user gets a new phone. Pod-side
  encrypted backup of the host's identity material? Paired-device
  hand-off over BLE? Both?
- **Versioning policy for the `@host` API.** SemVer with a deprecation
  window per minor? How long does a deprecated method stay live?
- **Native-binding extension model.** Do hosts ship pluggable native
  modules over time, or is the binding catalogue frozen per host
  release? If pluggable, distribution gets messy fast.
- **Multi-device story.** Laptop + phone is the common case. Does the
  laptop run its own host (Electron / Tauri, deferred per the Browser
  seed), or does it tunnel into the phone's host? Each has costs.
- **Intent registry conflict resolution.** Two apps registered for
  `task.create` — user picks each time, or sets a default? How is the
  default surfaced and revoked?
- **Background-slice contract.** What can a guest's background slice
  actually do? Receive one message and post a notification? Run a
  short skill? Hard limits prevent battery abuse but constrain real
  apps (Tasks's stats roll-up, Folio's sync).

## Sibling docs

- [`./design-2026-05-07.md`](./design-2026-05-07.md) — original Browser seed
- [`../AgentHub/agent-hub-design-2026-05-05.md`](../AgentHub/agent-hub-design-2026-05-05.md) — Hub fundament
- [`../AgentHub/monitoring-design-2026-05-07.md`](../AgentHub/monitoring-design-2026-05-07.md) — audit / monitoring substrate
- [`../projects/README.md`](../projects/README.md) — project-wide Hub-compatibility rules + 2026-05-08 phone-app update
- [`../Substrates/L0-react-native.md`](../Substrates/L0-react-native.md) — RN platform layer that becomes the host's binding catalogue
