# 06 — Proof of Location

**Use-case:** privacy-preserving proof-of-presence for situations
where an app or another agent needs to know you're really at a
particular place, without you handing over exact coordinates or
trusting a single source.

**Status:** scope sketched.  Active research area, several
existing projects to watch, no clean turnkey solution.  No code
yet.

---

## User's framing (verbatim, two prompts)

> Are there any open source initiatives to help prove (to some
> app) in a privacy-safe way, that you really are at a specific
> location?

And, on multi-signal approaches:

> I thought, maybe the combination of nearby wifi-networks,
> maybe photos of the user (verified with weather info), maybe
> even parked license plates or even locally distributed,
> regularly updated qr codes could help for this goal.  Any
> initiatives on that?

## In one paragraph

Proving "I am physically here" to an app or peer is genuinely
hard because two separate problems have to be solved at once:
**(1) cryptographically hide the exact coordinates** while still
proving you're inside a region, and **(2) prevent the user from
simply lying** about where they are.  Most existing projects
solve one well and the other less well.  The most credible path
forward is *multi-signal* — combining several weak signals
(rotating-QR beacons, signed GPS readings, witness peers, WiFi
fingerprints, content-credentials photos) into one composite
proof, where forging all of them at once is much harder than
forging any single one.  The most tractable starting point for
*this* project is **signed rotating-QR beacons** plus a
**witness-network skill** that reuses #2's neighborhood-
matchmaking primitives.

---

## The two pieces of the puzzle

### Privacy layer — Zero-Knowledge Proofs

Prove "I am inside region X" without revealing exact
coordinates.  The maths is solid and increasingly practical.

| Project | Status | Notes |
|---|---|---|
| **ZKLP (Zero-Knowledge Location Privacy)** | Academic + working impl | Discrete Global Grid System (hexagonal cells), ZK circuits IEEE-754-compliant.  Sub-second proximity proofs.  ([IACR paper](https://eprint.iacr.org/2024/1842.pdf), [arXiv](https://arxiv.org/abs/2404.14983)) |
| **OLP Protocol (Open Location Proof)** | Active | Pedersen commitments + Bulletproofs.  Inclusion-in-area without revealing coordinates.  ([olpprotocol.com](https://olpprotocol.com/)) |
| **POLP** | Open-source on GitHub | snarkjs circuits, on-chain interop intent.  ([GitHub repo](https://github.com/BoddepallyVenkatesh06/POLP-Blockchain)) |
| **zk-PoL** | Academic protocol | Trusted access point issues a location certificate; user generates ZK proofs at chosen privacy level.  ([arXiv](https://arxiv.org/html/2406.18389v1)) |

These projects all do the *math* of "prove inside a region"
well.  None of them solve the next problem.

### Authenticity layer — preventing spoofing

The harder problem.  A malicious prover can falsify a GPS
reading; the ZKP proves the math, not that the underlying
sensor reading is real.  Solutions in the wild:

| Approach | Project | Notes |
|---|---|---|
| **Radio beacon networks** | **FOAM** | Open protocol for location proof on Ethereum, BFT clock-sync over a radio-beacon network, time-of-flight positioning.  Real deployments but niche.  ([overview](https://collectiveshift.io/foam/), [whitepaper](https://res.cloudinary.com/token-froundry/image/upload/v1531686083/FOAM-Techincal-Whitepaper-Draft.pdf)) |
| **Witness networks** | Recent academic work | "Fault-tolerant witnessing zones" combining distributed signatures, distance bounding, and consensus over nearby trusted devices.  ([NIH paper](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12141446/)) |
| **Trusted hardware** | Apple Secure Enclave / Android StrongBox / signed-GNSS chips | Hardware signs raw GPS before the OS sees it.  Used in the vehicle-subsidy ZK-PoL work.  ([Springer chapter](https://link.springer.com/chapter/10.1007/978-3-032-00642-4_20)) |

The combination people are converging on:
**trusted hardware signs raw position data → ZKP circuit proves
"this signed reading falls inside region X" → app receives only
the proof.**  Witness networks or radio beacons can replace or
supplement the trusted-hardware piece.

---

## The user's multi-signal idea — what's been explored

The user's instincts (WiFi networks + photos + license plates +
rotating QR codes) map directly onto active research and
deployments.  Per-signal honest read:

### WiFi network fingerprinting

Established for indoor positioning (Google's, Apple's location
services already use this).  Privacy-preserving variants exist
in academia using Paillier homomorphic encryption
([Springer](https://link.springer.com/chapter/10.1007/978-3-319-44524-3_13)).
Channel State Information fingerprinting can re-identify a
person across locations even without a phone
([The Register](https://www.theregister.com/2025/07/22/whofi_wifi_identifier/))
— powerful but a double-edged privacy sword.

**The hard part:** WiFi BSSIDs and signal strengths can be
**replayed**.  An attacker can wardrive a target location,
capture the BSSID set, and replay it later.  Defenses exist
(rotating challenges, physical-layer fingerprinting), but no
fully open-source "WiFi proof of presence" stack exists yet.
The closest thing in practice is corporate WiFi-based access
control, which assumes a trusted network.

### Photos verified against weather / contextual data

Closest to **C2PA / Content Credentials**, plus a verification
layer on top.

What exists:
- **C2PA** — open standard backed by Adobe, Arm, BBC, Intel,
  Microsoft, Truepic.  Embeds a signed manifest in files,
  cryptographically tying location, time, device, authorship.
  Now in Leica M11-P, Sony Alpha, Pixel 10, Adobe Firefly,
  DALL·E.  ([metadataview.com](https://metadataview.com/c2pa))
- **Truepic** — verified time / date / device / location with
  detection for synthetic visuals.  Used in insurance and
  inspection workflows.  ([truepic.com](https://www.truepic.com/))

The honest gap (what the user's weather idea addresses): C2PA
does not verify whether the *original scene* is authentic.  An
AI-generated image photographed with a C2PA-enabled Leica gets
valid credentials and undeserved trust
([VAARHAFT](https://www.vaarhaft.com/post/c2pa-under-the-microscope-what-can-the-standard-do-and-what-are-its-limitations)).
Cross-referencing photo content against external signals
(weather, sun angle, visible street furniture) is the right
idea, but no published open-source project does this in a
structured cryptographic-proof way.  OSINT researchers
(Bellingcat-style geolocation) do it ad-hoc.  **Real
opportunity here.**

### License plates / street furniture

Same OSINT category — heavily used in human verification of
geotagged content but no serious privacy-preserving open-source
initiative.  Privacy issues around scanning others' license
plates are also significant under EU/Dutch GDPR.

### Rotating QR codes (the strongest of the user's ideas)

Effectively **TOTP for places**, and there's real work here.

- **Commercial deployments**: time-limited QR codes prevent
  proxy attendance.  QR-based check-in is widely used by
  universities (Qwickly et al.).  ~7-second per-student
  check-in.  ([overview](https://www.verifyed.io/blog/qr-code-attendance))
- **Patent literature** describes machine-readable codes that
  rotate during a verification session, with the server
  validating against the rotating token
  ([USPTO](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12530553)).
- **NHS COVID-19 Venue Check-In** (now retired) used signed
  venue QR codes with published source.
- **Proof-of-Attendance Protocols (POAP)** on Ethereum — event-
  specific codes but mostly without strong replay protection.

The robust protocol: a beacon (display, ESP32, NFC tag) signs
`(location_id, timestamp, nonce)` with its private key,
rotating every few seconds.  The user's app captures it,
optionally combines it with a ZK proof of identity, and
submits.  Replay is bounded to the rotation window.

**No maintained, general-purpose "signed rotating beacon"
open-source library exists.  This feels like a gap worth
filling.**

---

## Multi-signal architecture

Where the research is heading: **combine weak signals into a
strong one.**  No single channel is forge-proof.  Requiring
`WiFi fingerprint + signed rotating QR + C2PA photo + GPS
attestation` and verifying internal consistency raises the
spoofing cost enormously.  Recent work formalizes exactly this
composition — distributed signatures + distance bounding +
consensus across multiple "witnessing" sources
([NIH](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12141446/)).

For *this* project specifically, the natural decomposition is:

1. **Beacon layer** (signed rotating QR / NFC / BLE) — cheap
   ESP32 hardware, well-understood crypto (Ed25519 + TOTP-like
   rotation), genuine replay resistance.  Best starting point.
2. **Witness layer** (nearby agents co-sign attestations) —
   maps onto **use case #2's neighborhood matchmaking with a
   particular skill**.  An agent registers `attest-presence` as
   a skill; the requester broadcasts a presence challenge over
   the relay; nearby agents respond with co-signed attestations
   if they observe the prover.  Reuses pubsub-of-skills + group
   governance from #2.
3. **Sensor layer** (signed GPS / WiFi fingerprint / photo with
   C2PA credentials) — best-effort, works only on capable
   hardware.
4. **Privacy layer** (ZKP that "all of the above proofs come
   from inside region X" without revealing exact coordinates) —
   composes the above into a single privacy-preserving claim.

**Recommended starting point: layer 1 (signed rotating QR
beacon) + layer 2 (witness-network skill).**  Skip layer 3 for
v1.  Add layer 4 (ZK composition) only when you have something
real to compose.

---

## How this fits with the project

This use case sits at the **intersection of #2 and #4** with a
new privacy-cryptography wing:

- **Witness networks ARE skill matchmaking** with `attest-
  presence` as the skill.  Reuses pubsub-of-skills primitive
  from #2.  Reuses role-aware groups from #4 for
  trust-tier-based weighting of witness signatures.
- **Beacon signing reuses Ed25519 / capability-token
  infrastructure** from the SDK.  A beacon is conceptually an
  agent with a device-only identity that issues short-lived
  capability-tokens of the form *"holder of this token was
  present at <location_id> within the last <window>"*.
- **Proof-of-location is a composable verification primitive**.
  Other use cases consume it: #4 ("you can claim the
  garden-watering task only if you can prove you were at the
  garden"), #2 ("matchmake with neighbors I can prove are
  actually nearby"), or future ones (delivery, voting,
  attendance).

So the SDK additions are mostly things already on the table for
other use cases:

- Pubsub-of-skills (already in the table for #2 and #4) — used
  to broadcast presence challenges.
- Role-aware groups (already on the table for #4) — used to
  weight witness signatures by trust.
- Capability tokens (already in `permissions/CapabilityToken.js`)
  — used as the base of presence-attestation credentials.
- Mobile push (on the table for #2 and #4) — used to wake
  witnessing agents when their attestation is requested.

What's *new* here:

- A **signed-beacon skill registration pattern** — an agent
  represents a physical beacon and issues short-lived signed
  presence claims.  Could be a small SDK addition or fully
  app-level.
- A **proof-composition library** for combining multiple weak
  signals into one composite proof.  Almost certainly
  app-level / its own package, not in the SDK.

---

## Open questions

1. **Beacon hardware scope.**  Build for ESP32 with e-ink
   display (cheap, deployable in cafés / venues / community
   centers)?  Or rely on phone-to-phone NFC / BLE ranging?
   ESP32 is more durable; phone-to-phone is more available.
2. **Trust model for beacon operators.**  Who vouches that
   a beacon with `location_id = 'cafe-main-square'` is really
   at the main-square café?  Probably the same governance
   model as #2's closed-group invitation system — beacons are
   "members" of a location-context group.
3. **Witness incentives.**  In what scenarios will nearby
   agents bother to co-sign?  Mostly altruism (closed-group
   neighborhood); in larger contexts may need explicit
   incentives.  Out of scope for v1.
4. **What level of ZKP composition is realistic for v1?**
   Honest answer: probably none.  Ship layer 1+2 in plaintext-
   with-signatures form first; add ZKP composition (layer 4)
   only if there's a concrete use case demanding it.
5. **Privacy of the witness graph.**  If alice's app knows
   that bob co-signed her presence at the café, alice now
   learns that bob was at the café at that time too.
   Is that acceptable?  Anonymity for witnesses (sign with
   ephemeral keys; reveal only on aggregated challenge) is the
   defensible answer but adds protocol weight.
6. **Anti-Sybil for witnesses.**  In a closed-group neighborhood
   the relay's allowlist provides this for free.  In open
   contexts the witnessing model needs proof-of-personhood
   (out of scope for v1; #2's anonymity-with-mutual-consent
   protocol — when un-parked — is partly relevant).
7. **GUI considerations.**  Same shape as #5: defer.  But the
   beacon-signing flow ("tap your phone here to prove you're
   here") is a UI concern that needs *some* thought even at
   the API stage.

---

## Suggested staging

When this thaws into actual work:

1. **Investigation week.**  Read FOAM whitepaper, ZKLP paper,
   one of the rotating-QR-beacon patents.  Decide: are we
   building or watching?
2. **Skill design.**  `attest-presence(challenge)` → witness-
   side; `request-presence-attestations(location, window)` →
   prover-side broadcast over the relay.  ~1 week.
3. **Beacon firmware.**  ESP32 + e-ink display + Ed25519
   signing + TOTP rotation.  ~2 weeks for one developer.  Out
   of scope of the JS SDK; lives in its own subproject.
4. **Phone-side capture.**  Mobile app reads the rotating QR /
   NFC / BLE; submits to a verifier agent (via this project's
   skill APIs).  ~1 week.
5. **Composer / verifier.**  Skill that aggregates beacon-sig
   + witness-sig + (optional) sensor data into one composite
   attestation token.  ~1 week.
6. **Use in #4.**  "Claim this task only if presence-attested
   at <location>" wired through the task ledger.
   Demonstrates composition.

---

## Honest take

This is a real research-and-engineering area with active prior
art but no clean turnkey solution.  **Don't try to solve all
four layers at once.**  The leverage move is: ship the beacon-
signing + witness-skill layers, demonstrate them for one or two
use cases (claiming a location-bound task; verifying
neighborhood-only matchmaking), and let the cryptography piece
mature in academia until there's a clear need to compose it in.

The user's instinct that **rotating-QR beacons + multi-signal
fusion** is the most tractable starting point matches what the
literature concludes.  The unique angle for this project is
**witness networks via the existing skill-broadcast / closed-
group machinery** — not because it's the strongest signal
alone, but because the infrastructure for it is *already going
to exist* for use cases #2 and #4.  A presence-attestation
service that piggybacks on those primitives is much cheaper to
build than one that ships its own peer-discovery / group-
governance / pubsub stack.

**Verdict:** real, novel, distinct from the other use cases,
strongly leveraged by the SDK primitives already on the table.
Worth keeping on the list; not a blocker for the first wave of
apps; well-positioned to land once #2 and #4's infrastructure
exists.

---

## Related work in the repo

- `packages/core/src/permissions/CapabilityToken.js` — token
  format that beacon signatures and witness attestations would
  reuse.
- `packages/core/src/protocol/pubSub.js` — broadcast primitive
  for presence-challenge dissemination.
- `projects/02-neighborhood-app/` — the witness-network is the
  same skill-matchmaking pattern, with `attest-presence` as
  the skill.
- `projects/04-tasks-app/` — first natural consumer of presence
  attestations (location-bound task claims).
- `Design-v3/` — protocol-level designs.  This project sits
  *above* these, composing existing primitives.

---

## External reading order

When this thaws, in priority:

1. **FOAM whitepaper** — the most concrete real-world
   deployment of decentralized location proof.  Architecture
   is dated (2018-era Ethereum) but the principles transfer.
2. **ZKLP paper** (arXiv 2404.14983) — current state-of-the-art
   on the privacy / ZKP layer.
3. **C2PA spec** — the photo-credentials standard, plus the
   VAARHAFT critique of where it doesn't address scene
   authenticity.
4. **Rotating-QR-beacon patent literature** (USPTO 12530553)
   for the protocol mechanics.
5. **NIH witness-network paper** (PMC12141446) for the formal
   model of multi-signal composition.
