# WiFi + on-LAN-agent: the lightweight v0 path

**Investigation note for project #6.**  Companion to
[`README.md`](./README.md), which lays out the broader 4-layer
architecture for proof-of-location.  This note explores one
specific *combination* of layers that is unusually low-friction
because it falls out of the SDK's existing transport stack
without any new hardware or cryptography.

**the author's framing:**

> Add an option to be 'local' after connecting to an agent within
> one of the associated wifi networks.  So you need to be both
> connected to that network and this particular agent (maybe
> exposing some unique key).
>
> When you store wifi-network information only on privately owned
> devices, it sounds to me like GDPR is not so applicable.

---

## The mechanism

A two-factor "I am physically here" claim:

1. **Factor A — WiFi context.**  The user's device is connected
   to a WiFi network the user has previously associated with a
   location (e.g. `home`, `office`, `community-cafe`).
2. **Factor B — on-LAN agent.**  A specific agent that lives at
   that location is reachable via direct LAN (mDNS / BLE / local
   sockets) — *not* via the internet relay.  That agent has a
   stable signing key tied to the location.

Both must be true *simultaneously*.  The agent then issues a
short-lived signed attestation: "user X was on my LAN at time Y;
the network they joined had SSID/BSSID Z."

## Why it's stronger than either factor alone

| Factor | Alone (weak) | Combined (stronger) |
|---|---|---|
| WiFi BSSID match | Replayable.  An attacker wardrives the target network, captures the BSSID set, and replays from anywhere. | Replay still gets the BSSID, but the attacker also has to talk to the *home agent* — and the home agent only listens on its own LAN. |
| Connected to a specific agent | Reachable from anywhere via internet relay if the agent is online. | The home agent's location-attestation skill rejects requests that arrive via relay; only LAN-direct requests qualify. |

**The combined attack** would require the attacker to be on
your LAN AND to talk to your home agent over LAN-direct.  At
that point they're effectively physically present (or have
already deeply compromised your home network — which is a
different threat model entirely).

## Why this is unusually cheap to build

The SDK already does most of it:

- **mDNS / BLE / relay routing:** Group EE's `agent.routeFor()`
  returns both the chosen transport *and* its name.  The home
  agent can introspect the inbound request and reject it if the
  transport isn't a LAN-direct one.
- **Signed capability tokens:**
  `packages/core/src/permissions/CapabilityToken.js` already
  produces short-lived signed tokens.  The location attestation
  is just a CapabilityToken with a `location_id` claim and a
  short expiry.
- **Skill registration:** the home agent registers
  `attest-location(location_id)` as a normal skill.  Anyone
  authorized AND connected via LAN-direct gets back a signed
  attestation; everyone else gets nothing.
- **Multi-device personal vault:** the user's devices already
  share an identity pool (via #06 / FF — KeyRotation + vault
  history).  No new key-management story for the
  user-side.

What's *new* is small:

- A convention for the `location_id` namespace (probably
  user-scoped: `home/main`, `home/office`, `community/cafe-X`).
- The transport-introspection check (a one-liner in the
  `attest-location` skill: reject if the request's transport
  name is `relay` or `default`).
- Optional: a list of "associated WiFi networks" stored on
  device, used to label attestations with a hint about which
  network was active.  But this is decoration — the real
  evidence is the LAN-direct connection itself.

## Compared to the four-layer architecture in the README

The README's 4 layers were:

1. Beacon (signed rotating QR / NFC / BLE) — needs hardware.
2. Witness (nearby agents co-sign) — requires multi-agent
   coordination.
3. Sensor (signed GPS / WiFi fingerprint / C2PA photo) — needs
   trusted hardware to be strong.
4. ZKP composition — needs cryptography.

This WiFi+agent variant is a **hybrid of layer 1 and layer 2**:

- The home agent *is* the beacon (layer 1) — it issues signed
  presence tokens.  No separate hardware needed because the
  home agent itself is hardware (a Raspberry Pi, an old
  laptop, a phone left at home).
- The home agent *is* a one-witness witness network (layer 2)
  — it co-signs your presence with its own key.

Skipping layers 3 and 4 trades:

- Loss of strong replay resistance against a sophisticated
  on-LAN attacker.
- Loss of privacy of exact coordinates (but this protocol
  doesn't reveal coordinates anyway — only "yes/no inside
  location_id").

For the **household / friend-circle / small-group** scope where
location-bound functionality is most useful (use case #4's
location-bound task claims; use case #2's hyperlocal
matchmaking), the trade is fine.  Save layers 3 + 4 for
high-stakes scenarios.

## Threat model and mitigations

| Threat | Mitigation |
|---|---|
| Attacker on your LAN (e.g. compromised IoT device) wants to attest as you | The attestation is bound to *your agent's pubkey*.  An on-LAN attacker would need to compromise your phone/laptop, not just your network. |
| VPN-tunnel attack — outsider VPNs into your home network, looks like LAN | The home agent rejects requests not arriving via mDNS-direct or BLE-direct.  A VPN'd peer arrives via TCP routed through the VPN — observable, but distinguishing from native LAN can be tricky.  Mitigation: prefer BLE-direct (which a VPN can't fake) when available; otherwise require mDNS direct-discovery freshness. |
| Stolen phone with location credentials | Short attestation lifetime (minutes to hours, not days) + device unlock required to issue new attestations. |
| Compromised home agent issues attestations from anywhere | Same as any compromised key.  Mitigation: rotate the home agent's location key on a regular schedule (Group FF — KeyRotation already handles this). |
| User connects to attacker's "evil twin" WiFi with the same SSID | The attestation is bound to a specific home-agent pubkey, not just the SSID.  Even if the user joins a fake network with the same name, they won't reach the *real* home agent through it.  Attestation simply fails to issue. |
| Fake "associated network" registration — user is tricked into adding a public WiFi as "home" | Out of scope; this is a UX problem, not a protocol problem.  Same class as "user clicks malicious link." |

## What the SDK needs

Almost nothing new beyond what's already on the table:

- A standardised **transport-name introspection** API on
  inbound skill calls.  Already implicit in Group EE; just
  needs a cleaner ergonomic so a skill handler can check
  `ctx.transport === 'mdns'` without reaching into private
  fields.
- A small **location-attestation pattern** doc in the SDK or
  the project folder showing how to compose CapabilityToken +
  transport-introspection into a presence claim.  Documentation,
  not code.
- (Optional, later) **A signed-beacon helper** that lets a
  user-side agent advertise itself as a "location anchor" with
  a stable per-location key separate from the agent's main
  identity.  Useful when one device hosts multiple location
  anchors.

What's app-level (lives in `projects/06-proof-of-location/`):

- The user-side flow for "associate this WiFi with this
  location."
- The verifier-side logic that consumes a presence
  attestation in another app (use case #4's
  location-bound task claim, for example).
- Optional UI for "I'm at home now; do you want to issue a
  presence token to <app>?"

## GDPR analysis

the author's intuition is correct: **for the case described —
WiFi info stored only on the user's own devices, used for the
user's own proof-of-location — GDPR essentially doesn't
apply.**

### The relevant rule

GDPR Article 2(2)(c), the **household exemption**: GDPR does
not apply to processing of personal data "by a natural person
in the course of a purely personal or household activity."

Your phone remembering which WiFi networks you've connected
to, and using that list to decide whether your phone is "at
home" — textbook household activity.  No controller, no
processor, no obligations.

### Where it gets nuanced

| Scenario | GDPR status |
|---|---|
| Your phone stores SSIDs of networks YOU have joined | Household — fine |
| Your phone shares the list with your home agent (also yours) | Still household — fine |
| Your phone uses the list to attest location to another of your apps | Still household — fine |
| You let your friend's agent verify location against your WiFi list | Edges out of "purely personal" but probably still household-adjacent |
| You run a service where your home WiFi is a "trusted anchor" for neighbors | **Out** — you're now a controller of *their* attestation data |
| Your phone scans + stores BSSIDs of *other people's* WiFi (passive) | Murky — case law treats systematically-collected BSSIDs as personal data (Google Street View case, NL 2010) |
| Other people's phones note that they connected to *your* WiFi | Their personal use of their own data + your public SSID broadcast — fine |

### Practical bottom line for the design

- Store the list on the user's devices: ✓ household, no GDPR.
- Sync across the user's own devices: ✓ household, no GDPR.
- Use it to issue location attestations to apps run by the
  same user: ✓ household, no GDPR.
- Issue attestations *for other users* based on your WiFi
  list: enters GDPR territory.  You'd be processing claims
  about their location.

### Other legal angles

Narrower than GDPR but worth knowing:

- **Dutch Telecommunications Act** prohibits intercepting
  communications, but doesn't prohibit observing public beacon
  broadcasts (SSIDs/BSSIDs are broadcast in the clear and
  seeing them is normal device behavior).
- **ePrivacy Directive** governs electronic communications —
  relevant for commercial data flows, not personal-use WiFi
  memory.
- The **Google Street View case** (NL DPA, 2010) was about
  Google *systematically scanning* WiFi for a commercial
  mapping product.  Personal household use is a different
  posture and not covered.

### Future-proofing precautions

Even within the household exemption, *good practice* is to
apply data-minimization principles.  If the project later
grows beyond purely household use, you don't want to refactor
data shapes under GDPR pressure.  Two cheap precautions worth
adopting now:

- **Store SSIDs/BSSIDs hashed** rather than plaintext where
  possible.  You only need to compare, not display.  Hashed
  identifiers are weaker as personal data under GDPR
  classification.
- **Make the list device-local by default**; opt-in for
  cross-device sync.  Reduces blast radius if the device is
  compromised.

These don't change the legal posture today (still household
exemption), but they keep options open.

---

## Why this is the recommended v0

Pulling it together: this approach gives you a meaningful
proof-of-presence with:

- **No new hardware** (uses devices already at the location).
- **No new cryptography** (uses existing CapabilityToken).
- **No third-party trust** (user owns both ends).
- **No GDPR friction** (household exemption).
- **No protocol design work** (composes existing SDK
  primitives).
- **Strong enough for the household / friend-circle / small-
  group scope** that #2 and #4 mostly target.

It is *not* strong enough for adversarial scenarios with
nation-state attackers or major financial incentives to spoof
location.  For those, the README's 4-layer composition with
ZKPs + witness networks + trusted hardware remains the
direction of travel.

But for the realistic v1 of #6 — "let me prove I'm at home so
my Solid pod unlocks the household task list, or my
neighborhood matchmaking shows me only locally-relevant
skills" — this is sufficient and ships much faster.

## Suggested next step

When #6 thaws, the v0 milestone is:

1. **Add transport-name introspection to `ctx`** in skill
   handlers.  ~half day.  L0 SDK addition.
2. **Build the `attest-location(location_id)` skill** as a
   reference implementation that issues a CapabilityToken if
   transport is LAN-direct.  ~1-2 days.  Lives in
   `projects/06-proof-of-location/` until promoted.
3. **Wire it into one consumer** (use case #4's location-bound
   task claim, or use case #2's "show me only neighbors I can
   prove are nearby").  ~1 day.

Total ~1 week to a working demo.  Layers 3 (sensors) and 4
(ZKPs) get added later as needed.
