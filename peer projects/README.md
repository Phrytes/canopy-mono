# peer projects/

Comparison notes on projects in adjacent space — what's similar,
what differs philosophically, what to learn from their progress
or failure modes.  These are NOT dependency / integration notes;
those go in `Design-v3/` (for protocol-level integrations) or
`projects/*` (for app-level ones).

The intent of this folder: keep an honest, ongoing read of where
the broader ecosystem is, so we can borrow ideas, avoid repeating
mistakes, and recognize potential partners or upstream projects.

## Per-project deep-dives (one file each)

| File | Project | Why it's relevant |
|---|---|---|
| [`holochain.md`](./holochain.md) | Holochain | Closest philosophical neighbor — agent-centric not data-centric, anti-platform.  Strong overlap on principles; bets differently on substrate.  Verdict: kindred spirit, useful prior art, not a competitor or upstream. |
| [`dxos.md`](./dxos.md) | DXOS | Most actively-developed peer.  Local-first, JS/TS-native, "Decentralized Operating System."  HALO + ECHO + KUBE; Composer as flagship app.  Verdict: track and bridge, don't adopt as foundation. |

## Candidates for future deep-dives

In rough order of how much they'd reward attention:

- **Local-First Software movement / Ink & Switch** — research
  agenda since ~2019; Automerge / Cambria / hypermerge.
  Defines the principles aligning ~80% with this project.
- **Hypercore / Holepunch / Pears** — peer-to-peer hypermedia,
  real-time sync, append-only logs.  Closest on the *technical
  building blocks* for collab docs.
- **Spritely Goblins** (Christine Lemmer-Webber) —
  capability-based distributed protocol designed to succeed
  ActivityPub.  Strong on capability security.  Early stage.
- **Solid (Tim Berners-Lee)** — already a hard dependency; worth
  a "what is and isn't in Solid" note for the team.
- **Matrix** — federated chat with E2EE + room-based governance.
  Architecturally similar in many ways even though the focus
  differs.  Good prior art on closed-group governance.
- **Secure Scuttlebutt (ssb)** — gossip-based social network,
  agent-centric, anti-platform.  Less active now but has
  published a lot on what works/doesn't in P2P social.
- **Briar / Berty / Jami** — P2P messaging with multi-transport
  (BT, internet, Tor).  Closest on the *multi-transport mesh*
  technique.
- **A2A** (Google's Agent-to-Agent protocol) — already
  integrated; the standard-protocol agent-interop play.
- **MCP** (Model Context Protocol, Anthropic) — different shape
  (AI agents calling tools/data) but blowing up in adoption;
  potential later integration target.

## How to write a peer-project deep-dive

A useful entry has four parts:

1. **Their core ideas** — principle/philosophical, not
   technical.  What's their one-line position?  What's their
   theory of change?
2. **Current progress and adoption** — honest read.  Real users?
   Active development?  What's shipping vs. promised?  What's
   the team size + funding posture?
3. **Where you align — and where you don't** — both
   philosophically and tactically.  Where's the resemblance
   strong?  Where do you diverge?  Are the divergences
   intentional?
4. **What to take from them** — framing, prior-art, failure
   modes to avoid, community to engage with.

End with an honest take on whether they're a kindred spirit, a
competitor, a possible partner, or a cautionary tale.

The point isn't to be encyclopedic — it's to give a future-you
or a future-collaborator enough context to make a decision in
five minutes.
