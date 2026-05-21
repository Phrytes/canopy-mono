# Stoop — privacy & safety threat model (2026-05-05)

> Companion to `advice-2026-05-05.md`. Captures the leakage and
> abuse risks of a closed-beta Stoop deployment, with mitigations
> and an explicit closed-beta-acceptable / public-launch-blocker
> split.

## TL;DR

- For a **closed beta** with friendly testers and an honest privacy
  notice: acceptable.
- For a **public launch**: the items marked **🚫 blocker** below
  must be addressed first.

## What's protected today

| Concern | Mechanism |
|---|---|
| Message contents in transit | E2E `nacl.box` envelope encryption via SDK `SecurityLayer` |
| Group access | Admin-signed `GroupProof`s verified at the relay; outsiders rejected |
| Forwarder content blindness | `sealedForward` for hop-routing |
| Transport security | TLS at the relay perimeter (Caddy + Let's Encrypt) |
| Pod data | User-controlled ACPs |
| Invite token integrity | Admin signature + expiry |

## What leaks / risks

### High-impact, address before public launch

#### ⚠ Stable WebID enables long-term de-anonymisation (partially mitigated in V1)
The pod WebID is stable by necessity (it anchors the data). What
*can* rotate is the agent's network identity (Ed25519 pubKey the
relay sees). `Agent.rotateIdentity()` is shipped in core (Group
FF), with grace-period broadcasts. **V1 mitigation:** rotate the
network identity every 30 days; pod WebID unchanged. Reduces the
correlation window for an observer scraping relay traffic.

What this does NOT solve:
- Pre/post-rotation correlation by traffic-shape analysis (timing, volume, reply graphs).
- Pod-side correlation: anyone with read access to the user's pod sees a stable WebID. Pod ACPs are the defence; rotation is not.

**V2 still required for full unlinkability** (anonymous credentials, single-use proofs, cover traffic). See `advice-2026-05-05.md` § "Identity rotation" for the V1 implementation details + the small `GroupAuthVerifier` change needed to accept rotation proofs during the grace period.

#### 🚫 Pod ACP misconfiguration exposes private data publicly
The classic Solid footgun. A wrong ACL on a skill artifact, profile,
or photo makes it world-readable. **Mitigation:** thorough manual
testing of the "bekijk als publiek" path before any external user
joins; automated ACP-correctness checks in V2; default-deny ACP
templates shipped with the app.

#### 🚫 No quotas — single member can DoS a group's relay
A misbehaving (or compromised) client can flood a group's
`group-publish` channel and exhaust the relay's per-group buffer
budget. **Mitigation: in V1.** Per-group rate limit + connection
count, on top of the existing `GroupAuthVerifier`. Tracked in the
advice doc's Phase 1.

### Medium-impact, document for the closed beta

#### Metadata visible to the relay operator
The relay sees: who is connected, who sends to whom, when, message
sizes, group IDs. Encrypted *content*, plaintext *graph*. For a
buurtgenoot-run relay this is acceptable; for a hostile operator it
is the entire social graph. **Mitigation:** trusted operator + honest
disclosure. The closed-beta privacy notice must say this explicitly.

#### Push tokens identify devices
Expo / APNs / FCM tokens are stored on the relay (so it can wake
offline recipients). The push provider can correlate tokens to
devices. **Mitigation:** acknowledge in the privacy notice; consider
making push opt-in; rotate tokens on session reset.

#### Group admin private key is a high-value target
A single device holds the admin private key for a group. If
compromised, the attacker can issue valid invites until the
admin re-keys. **Mitigation:** short proof TTLs (hours or days),
not weeks. Admin re-key flow before V2. True revocation (CRL or
short-TTL re-issuance loop) deferred per the advice doc.

#### Invite QRs are bearer tokens
Photographed, screenshotted, or forwarded QR codes can be redeemed
by anyone until expiry. **Mitigation:** short single-use TTLs;
device-key binding (the redeemer's device key gets baked into the
issued proof — already supported by `GroupManager`); user
education in the issue-invite UI.

### Lower-impact, document and move on

#### mDNS / BLE local broadcast announces presence
On a Wi-Fi or Bluetooth network, the SDK's local-discovery
transports announce the agent's presence. Anyone with a scanner in
range knows the app is running. **Mitigation:** document; consider
a "discreet mode" toggle that disables local discovery when away
from trusted spaces.

#### Default pod provider risk
A flaky community pod can make a user's data unreachable.
**Mitigation:** default to `login.inrupt.com` (same as folio-mobile);
periodic backup nudges via `notifier`.

#### Relay-side log retention
Even a benign operator may keep server logs that contain metadata
(connection times, message sizes, group IDs). **Mitigation:** ship
the community relay with conservative defaults (no access logs to
disk; metrics in-memory only); document the recommended log
configuration in the Stoop Relay Kit.

#### Onboarding-honesty tension
The brainstorm's "decentralisatie als gevoel, niet als architectuur"
is right for adoption but risks under-informing users about where
their data lives. **Mitigation:** in the privacy notice and the
"Profile" screen, a one-tap "Where is my data?" explainer that names
the pod provider and links to the pod URL.

## Personal-pod URLs do not travel in peer-to-peer messages (locked 2026-05-07)

Stoop honours the project-wide rule in
[`../projects/README.md`](../projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages--applies-to-every-agentic-project-here):
no user pod URL — and no URL under it — appears inside any broadcast
post, chat message, claim, reveal, contact-add hint, or other
peer-to-peer envelope. Concretely for V2.5 attachments:

- Image / file attachments ship as **bytes inside the envelope**,
  shrunk client-side. The sender stores the full blob locally; the
  recipient stores a copy locally on receive. Neither side ever
  references the other side's pod by URL.
- Profile photos are sent as resized thumbnails on the MemberMap
  entry (bytes, not URLs).
- The "click for full image" interaction reads from the recipient's
  own local cache — never re-fetches from the sender's pod.

When a shared / group-owned storage namespace ships in a future
phase, URL-mode attachments may be reconsidered for that namespace
specifically. The user's personal pod stays out of the peer-broadcast
path either way.

## Closed-beta privacy notice — required content

Any user signing up for a Stoop closed beta must see, in plain
language:

1. **What's encrypted:** message contents.
2. **What's visible to the relay operator:** who connects, who
   talks to whom, when, message sizes, group IDs.
3. **Who runs the relay** (named operator, not "Stoop").
4. **Where their data is stored** (the pod provider URL).
5. **What this is:** a research preview, not a production service.
6. **What not to put in it:** medical, financial, sensitive personal
   info.
7. **How to leave:** sign-out, delete-pod, revoke-group steps.

A draft of this notice should ship with V1.

## Open issues (for design, not for V1 code)

- **Push opt-in vs opt-out.** Opt-in is more privacy-friendly but
  hurts the "agent wakes the user" UX. Decide for V1.
- **Local-discovery default state.** On in trusted contexts, off
  elsewhere — but how does the app know which is which?
- **Per-group log policy.** Should an admin be able to configure
  "the relay must not log my group's metadata"? Useful, hard to
  verify externally.
- **Backup of the admin private key.** Lose it = lose admin powers
  forever (with current code). Vault-backup story for admins.

## V2 explicit dependencies on this document

The V2 phase in `advice-2026-05-05.md` references this document for:
- Cryptographic anonymity protocol (replaces V1 social anonymity)
- ACP-correctness automated tests
- Admin re-key + revocation flow
- Push-token rotation

These items must be designed against the threat model captured here.
