# Stoop — potential user complaints (2026-05-05)

> Companion to `advice-2026-05-05.md`. Things real users will
> probably say after using a closed beta. Each one notes whether
> the cause is a fixable design choice, an honest constraint to
> communicate, or a deeper philosophical issue.
>
> **Purpose:** anticipate, design for, or transparently disclose.
> Not a roadmap; an empathy doc.

## Onboarding & first use

### "I tried to install it but I don't know what a Solid pod is."
Default pod issuer (login.inrupt.com) hides the choice; the word
"pod" should not appear in onboarding copy at all. Reserve it for an
"Advanced" / "Where is my data?" screen for those who want to know.
Cause: **fixable copy choice**.

### "I scanned the QR but nothing happened."
QR scan flow has multiple failure modes: expired invite, wrong
group, network down, redeem-time crypto mismatch. Generic "something
went wrong" is the killer; need specific copy ("invite expired —
ask Anna for a new one"). Cause: **fixable error UX**.

### "It took me 10 minutes to get started."
The 3-minute brainstorm goal is aspirational. Real onboarding will
land at 6–10 minutes initially. **Measure with real testers as a V1
metric.** Cause: **honest constraint**, surface progress and reduce
where possible.

### "I don't have a Dutch buurt that's already on it."
The chicken-and-egg problem. Empty groups are the #1 product
killer. No fix in code — needs a recruitment / pre-seed strategy
before anyone real opens the app. Cause: **deeper issue**, address
operationally not technically.

## Daily use

### "I posted a vraag and nothing happened."
Silence ≠ broken, but it feels broken. UI must show: "delivered to
N members of Oosterpoort", "X have it open right now", "Y received
a push". Even with no replies, the user should see their post
landed. Cause: **fixable feedback UX**.

### "Anna keeps posting boring stuff — how do I mute just her?"
Already in V1 moderation: `mutePeer(peerWebid)` is a local-only
filter. UX needs a "..." menu on each post with "mute Anna"
visible. Cause: **fixable, already in V1 scope**.

### "I joined the wrong group and don't know how to leave."
`leaveGroup()` skill is in V1 moderation; the UX path is from
Settings → Groups → swipe-to-leave with a confirmation that says
what stays on the pod and what gets deleted. Cause: **fixable,
needs careful confirmation copy**.

### "I want to lend my drill but I'm worried it'll get damaged."
This is the lend/borrow lifecycle frustration. V1 punts on dispute
resolution. **Reframe at the app level:** Stoop is a
neighbour-introduction tool, not an insurance product. The
disclaimer (per Project Files/projects/README "Decentralised
disclaimer") should explicitly say: *"Stoop helpt je je
buurtgenoten vinden — afspraken maak je samen."* Lend agreements
(deposit, photo before, return-by date) are the user's
responsibility, recommended by the app, not enforced.
Cause: **honest constraint**, reframe as feature.

### "I posted something embarrassing — can I delete it?"
Deleting a post on Stoop = removing it from the user's pod (own data,
controllable) and broadcasting a "tombstone" so other members'
local caches drop it. Other members might still have a screenshot
or remembered it. Be honest: "We can remove the post; people who
already saw it have already seen it." Cause: **honest constraint**,
copy.

### "Why does the app feel so quiet?"
By design — prikbord-not-feed, no scroll-engagement loops, no like
counters. Some users will read this as "the app is dead". Cause:
**deliberate design choice** that needs framing in onboarding:
*"Stoop opent als je het nodig hebt, niet de hele dag."*

## Push & attention

### "It notifies me too much."
V1 default is conservative: only `humanInTheLoop` matches, ≤ 3 /
day, batched into digests. Per-user opt-out exists. Per-group admin
dial. Plus: feedback-loop metrics inform V1.5 retuning. Cause:
**fixable via the engineering feedback loop in advice doc**.

### "It doesn't notify me when I want it to."
Same loop, opposite end. Some users want every match; others want
silence. Per-user dials are the answer. Cause: **fixable**.

### "A notification interrupted me at a bad moment."
Push is real-time and dumb to context. Quiet hours per-user is a
small addition; "agent on holiday" mode (don't notify, queue for
later) is brainstorm's "stille modus". V1 should ship at least
quiet-hours. Cause: **fixable scope addition**.

## Identity & privacy

### "I don't want my real name on the buurt prikbord."
V1 ships handle-as-primary. Real name is opt-in per group / per
peer. Cause: **fixable, V1 scope**.

### "I'm being stalked / I have an abusive ex / I'm scared of being found."
This is where V1 is genuinely insufficient. Social anonymity
(handle hides name) does not protect against a determined adversary
correlating relay metadata + handle over time. The privacy doc is
honest about this; the *user-facing copy* needs to be too.
Recommend: a clear "If you have safety concerns, this app is not
right for you yet" disclaimer in onboarding for V1. Cause:
**deeper issue**, communicate honestly.

### "Why does this app know where I am?"
Local-discovery (mDNS / BLE) only triggers on Wi-Fi / Bluetooth, not
GPS. UI should make this explicit: *"Op dezelfde wifi: 5 mensen.
Stoop ziet geen locatie."* Cause: **fixable copy**.

### "I deleted the app — where's my stuff?"
Pod has it; agent vault is gone. To return, the user signs in to
the pod again from a fresh install, the agent regenerates from
mnemonic if they kept one. Without the mnemonic, they're locked
out. **V1 needs a clear "save your recovery phrase" moment in
onboarding** (Folio mobile already does this). Cause: **fixable
onboarding step**.

### "Who runs the relay and what do they see?"
The relay operator sees who connects, when, who messages whom (not
content). For the closed beta this is named (e.g. *"the author draait
deze server in 2026"*). For wider deployment: per-group operator
choice, and the relay operator's commitments are spelled out in a
"Wat ziet de server?" page, linked from the group's settings.
Cause: **honest constraint**, requires named-operator UX.

## Decentralisation friction

### "There's nobody to complain to when something goes wrong."
This is THE structural issue with decentralised apps. No support
desk, no abuse team, no central trust authority. Stoop's answer:
**groups are responsible for themselves**. Group admins are the
first line; failing that, members leave / form a new group.
Reframe in app copy: *"Een groep is een afspraak tussen leden,
geen dienst van Stoop."* Cause: **deeper issue**, project-wide
disclaimer + admin guidelines.

### "My buurtgenoot doesn't have a smartphone."
Stoop is a smartphone-and-laptop app. Some buurtgenoten won't be
reachable through it. Don't pretend otherwise; treat the offline
member as a known constraint and recommend that admins handle
inclusion in person ("vraag het Marie zelf, ze heeft geen
smartphone"). Cause: **deeper issue**, copy + cultural framing.

### "What if my group's admin starts being weird or abusive?"
V1: admins are not absolute. Members can `leaveGroup()`, post
publicly elsewhere, recruit a new group. **No appeal mechanism
within Stoop in V1.** Document this as part of the
"groups-are-agreements" framing. V2 design idea: multi-admin
groups, soft-veto, member-vote-to-demote — but loaded with
governance complexity. Cause: **honest constraint** for V1,
**design space** for V2.

### "What if the pod provider goes away?"
The brainstorm-recommended Inrupt is a real company that could one
day shut down or change terms. Mitigation: pod export skill (dump
all your Stoop data as a `.zip`), import-on-restore, encourage
periodic export via `notifier`. Cause: **fixable export plumbing**,
also **honest disclosure**.

## Day-to-day annoyances

### "It drains my battery."
Single agent + foreground-only sync (per the Folio decisions
applied here) keeps battery low. Watcher off by default. mDNS / BLE
only when in foreground. **Measure with real users; flag if real.**
Cause: **likely fixable, monitor**.

### "It doesn't work on my old phone."
React Native + Expo 52 floor sets a real OS-version requirement.
Some buurtgenoten will be priced out. No fix; document the floor
and accept some users won't be reachable. Cause: **honest
constraint**.

### "I'm already on WhatsApp groups for my buurt — why this too?"
The killer "why" question. Stoop's value over WhatsApp:
- Skill matchmaking (machine + human) you don't get in chat
- Borrowing without "wie heeft een ladder" 30-message threads
- Privacy (your buurt-data isn't on Meta's servers)
- Mens-en-machine agents (a buurtweerstation can be a member)
This needs to be the homepage pitch, not buried in features.
Cause: **fixable positioning** + **honest constraint** that some
users will say "WhatsApp is enough".

### "I want to try it before I commit to a group."
Demo group? Browse-mode? V1 doesn't have this. Onboarding currently
assumes you have an invite. Recommend: a "demo Oosterpoort" with
fake skills + a few mock members for first-run feel. Cause:
**fixable scope addition** (small, charming).

## Social / cultural

### "I'm anxious about being judged for not knowing things."
The brainstorm flagged this: blank "wat kun jij?" is paralysing.
Stoop's UX leans on vragen-eerst rather than aanbod-eerst, which
helps. Reinforce in onboarding copy: *"Je hoeft niets te kunnen om
mee te doen — beginnen kan met één vraag."* Cause: **fixable
onboarding copy**.

### "I'd rather just do this in person — why does there need to be an app?"
Honest constraint: Stoop is for the buurtgenoot you don't know
yet, not the one across the hallway. Don't oversell. Cause:
**honest constraint** that limits market reach.

### "I have skills but I don't want to be 'the bike repair person' for everyone."
Posture flag (`negotiable`) lets the user say no. UX needs a
"vakantiestand" / "even niet beschikbaar" toggle (brainstorm's
stille modus). Cause: **fixable scope addition** for V1.

### "I'm anxious about chatting with strangers from my buurt."
Pre-connection chat is anonymous-by-handle. UI should soften the
"start chat" affordance — *"stuur een korte vraag, geen verplichting"*.
Cause: **fixable copy**.

### "I posted a vraag and got 5 over-helpful responses I didn't ask for."
Social skill problem; tech can help by surfacing "first responder
gets the slot, others see 'Anna heeft een match'", which is already
the skill-match flow. Cause: **fixable UX surfacing**.

## Operator-side complaints (V2 / Stoop Relay Kit territory)

### "Running my own relay was harder than I thought."
Phase 2 deliverable. Document the recommended hosting target
(Hetzner Cloud €4.50/month or Fly.io free tier) + pre-built
Caddy config. Cause: **planned**, V2.

### "Storage / bandwidth costs more than I expected."
With per-group quotas (V1 addition) admins can see their cost.
Default low quotas + opt-in to raise. Cause: **fixable via V1
quotas + V2 admin GUI**.

## What's NOT a complaint anyone will have

A few things people will *not* spontaneously say but you should
ship anyway because the absence of a complaint is the goal:

- "It's good that the relay can't read my messages" — invisible
  win; most users won't think about it; ship it as table stakes.
- "I love that I can rotate my network identity" — nobody will
  notice, but the next-time-you-check-relay-logs benefit is real.
- "I appreciate the privacy notice" — most won't read it; the few
  who do are the most influential testers.
