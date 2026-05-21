# Group governance starter — wizard text + admin guidelines (2026-05-05)

> Starting point for Stoop's create-group wizard. **Goal:** make
> creating a group feel like setting up an *agreement* between
> people, not configuring an app. Six questions, all answerable in
> 5–10 minutes by a thoughtful admin.
>
> Text is bilingual NL / EN; both ship in V1 per the i18n
> convention. Tone: warm, plain, slightly formal Dutch / direct,
> non-corporate English.

## Why this exists at all

Decentralised projects have no central support desk. When something
goes wrong inside a group, the *group itself* is the unit that has
to handle it. Pretending otherwise leaves admins unprepared and
members without recourse. The wizard is the moment to make the
admin think before clicking "create".

The wizard's outputs are saved to the group's pod-side `rules.md`
(or equivalent) and shown to every member at join time. They aren't
enforced by code; they are written down, agreed at join, and
referable when conflict hits.

## The six questions

### 1. Wat heet deze groep en waar is hij voor? / What's this group called and what's it for?

> **NL:** "Geef de groep een naam die buurtgenoten herkennen en
> schrijf in twee zinnen waar de groep voor bedoeld is."
>
> **EN:** "Give the group a name buurtgenoten will recognise, and
> say in two sentences what it's for."

Examples to show:

- *"Oosterpoort skills — buurtgenoten in Groningen-Oosterpoort die elkaar willen helpen met klusjes, lenen en weten wat er speelt."*
- *"Familie Jansen — gezamenlijke huishoudelijke afspraken, boodschappenlijst, klusjes."*
- *"Klusclub Helpman — alleen technische skills, geen kletspraat."*

The "what it's for" sentence is the most important field — vague
groups dilute fast.

### 2. Wie is admin? / Who's an admin?

> **NL:** "Wie zorgt er voor de groep? We raden aan om minstens
> twee admins te hebben — één persoon is een single point of
> failure."
>
> **EN:** "Who looks after this group? We strongly recommend at
> least two admins — one person is a single point of failure."

The wizard insists on listing the WebID(s) of co-admin(s); skipping
this is allowed but produces a warning: *"Eén admin betekent dat de
groep stopt als die admin niet meer bereikbaar is."* / *"With one
admin the group stops working when that admin is unreachable."*

### 3. Wat zijn de afspraken? / What's the deal?

> **NL:** "Schrijf op wat er in deze groep wel en niet kan. Denk
> aan: welke posts horen erbij, welke taal, hoe ga je met elkaar
> om, wat is de toon."
>
> **EN:** "Write down what fits in this group and what doesn't.
> Think: what kinds of posts belong, what language, how members
> treat each other, what tone."

Suggested prompts (pre-filled, editable):

- *"Welke posts horen erbij?"* (vragen, aanbod, lenen, anders)
- *"Voertaal?"* (Nederlands, Engels, beide)
- *"Toon?"* (vriendelijk, kort, geen reclame, geen politiek)
- *"Wat doen we niet?"* (oproepen tot acties, doorverkopen, …)

The output is the group's "house rules". Visible at join.

### 4. Wat als er gedoe is? / What if there's conflict?

> **NL:** "Hoe lossen jullie meningsverschillen op? Stoop heeft
> geen klantenservice — als er iets misgaat, is dat tussen jullie."
>
> **EN:** "How do you resolve disagreements? Stoop has no support
> desk — if something goes wrong, it's between you."

Three options to pick (or combine):

- *"Admin beslist."* / "Admin decides." (simple, autocratic)
- *"Een gesprek tussen betrokkenen, admin als getuige."* / "A conversation between those involved, admin as witness." (mediation-style)
- *"Stemmen onder de leden."* / "Members vote." (slow, requires quorum, more democratic)

Whatever's chosen, the admin commits to it in writing.

### 5. Wie mag erbij? / Who can join?

> **NL:** "Bepaal hoe mensen lid worden."
>
> **EN:** "Decide how members join."

Three options:

- *"Op uitnodiging — admin geeft een QR aan iedereen persoonlijk."*
  ("Invite-only — admin hands out a QR in person.")
- *"Via een doorgegeven link — leden mogen anderen toevoegen."*
  ("Via shared link — members can add others.")
- *"Op aanvraag — iedereen kan vragen, admin keurt goed."*
  ("Request-and-approve — anyone asks, admin approves.")

Plus three optional dials:

- Maximum aantal leden / max members (default: geen / none).
- Verloop van uitnodiging / invite expiry (default: 7 dagen / 7 days).
- Eénmalig per uitnodiging / single-use invite (default: aan / on).

### 6. Hoe ga je weg? / How do you leave?

> **NL:** "Wat gebeurt er als iemand de groep verlaat — blijven hun
> posts staan of verdwijnen ze?"
>
> **EN:** "What happens when someone leaves — do their posts stay
> or disappear?"

Two options:

- *"Posts blijven staan, naam verdwijnt."* — *"Posts stay, name disappears."* (default; preserves group history)
- *"Alles van die persoon verdwijnt."* — *"Everything from that person disappears."* (clean break; loses context for the group)

This is a real choice with no obviously right answer. Document the
trade-off; let the group decide.

## What the wizard produces

Output (stored in the group's pod-side `rules.md` + shown to every
member at join):

```markdown
# <group-name>

## Waarvoor / What this is for
<paragraph>

## Admins
- @<handle1> (<webid1>)
- @<handle2> (<webid2>)

## Afspraken / House rules
<list>

## Conflict
We lossen meningsverschillen op via: <gekozen optie>
We resolve disagreements via: <chosen option>

## Lidmaatschap / Membership
- Toegang: <gekozen optie> / Access: <chosen option>
- Maximum: <n>
- Uitnodiging vervalt na: <n> dagen / Invites expire after <n> days

## Vertrek / Leaving
<gekozen optie> / <chosen option>

## Verantwoordelijkheid / Responsibility
Stoop heeft geen klantenservice. Deze groep is een afspraak tussen
de leden — niet een dienst van een bedrijf. Conflicten worden
opgelost zoals hierboven beschreven; daarbuiten kan iedereen ervoor
kiezen de groep te verlaten.

Stoop has no support desk. This group is an agreement between
members — not a service from a company. Conflicts are resolved as
described above; beyond that, anyone may choose to leave the group.
```

## Onboarding hand-off

When a new member redeems an invite, **before** they join:

1. They see the `rules.md` of the group, full text, in their
   language.
2. A clear "Akkoord — sluit me aan" / "Agree and join" button.
3. A subtle "Niet akkoord, ga terug" / "Don't agree, go back".

Joining is an act of agreement, not a button-click. This is also
the moment to display the decentralised disclaimer (per
[`Project Files/projects/README.md`](../projects/README.md#decentralised-disclaimer--every-agentic-project-ships-with-one)).

## Admin onboarding

When the wizard finishes, the admin sees:

- A summary of what they've just decided.
- A note: *"Je bent nu verantwoordelijk voor deze groep. Dat
  betekent: je bent het eerste aanspreekpunt voor leden, je beheert
  uitnodigingen, en je beslist (binnen de afspraken) over
  conflicten. Lees de admin-richtlijnen."*
- A link to the **admin guidelines** (next section).

## Admin guidelines (separate document)

A short (1-page) handbook every admin reads at create-time, with
practical rules of thumb. Sketch:

1. **Tweede admin is geen luxe.** Single-admin groups break when the
   admin gets sick, busy, or disengaged. Recruit a co-admin in the
   first week.
2. **Reageer of zeg waarom niet.** When a member reports something,
   the admin responds within a reasonable time (say, a week). "I'll
   look at it" is a valid response. Silence is not.
3. **Pas op met je eigen positie.** As admin, your posts have
   implicit authority. Don't use the group as your personal soapbox.
4. **Laat de groep ademen.** Don't over-curate. Most "is this
   appropriate?" questions resolve themselves if you wait a day.
5. **Wees eerlijk over je grenzen.** If a conflict is too big for
   you to handle, say so — recruit help, ask the members to step in,
   or suggest the group split.
6. **Een groep kan kleiner worden.** It's OK for a group to shrink
   to its actual interested members. Quality over quantity.
7. **Loslaten mag.** Stepping down as admin is fine if you do it
   transparently (announce, hand over). The worst outcome is a
   ghost-admin who's unreachable.

## What the wizard explicitly does NOT do

- It does not enforce the rules. The rules are an agreement, not
  code. A member can violate them; the group's conflict process
  handles the response.
- It does not create the relay group bucket / `acceptedGroups`
  entry — that's the admin's separate operational step (see the
  Stoop coding plan).
- It does not validate the language / spelling of the rules. People
  write what they want; the wizard saves it.

## V2 / future ideas (out of V1 scope)

- Multi-admin coordination flows (vote-to-demote, soft-veto).
- Member appeals process for removal.
- "Group split" wizard (when a group gets too big or fractures).
- Translation suggestions for rules (LLM-assisted "say this in
  Dutch / English / Arabic").
- Annual "ritual review" — once a year, members are asked if the
  rules still match what they want.

These are real but deferred. V1's job is to make the *first* group
governance moment honest and complete enough to ship.
