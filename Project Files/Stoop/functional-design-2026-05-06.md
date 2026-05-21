# Stoop — Functional design sketch (2026-05-06)

> What the app *does* for a user, in their words.  Anchors the next
> round of coding-plan revision.  Technical architecture is in
> [`advice-2026-05-05.md`](advice-2026-05-05.md); the mockup with
> visual cues is in `shareskills_app_mockup.html`.  Privacy /
> identity model is in
> [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md).
>
> This doc is intentionally **not** a screen mockup or a screen
> inventory.  It describes *capabilities* + *journeys* + *the
> information the user touches*, in the language a buurtgenoot
> would use, so the coding plan that follows can be checked
> against "does the user actually want this?"

## 1. The 30-second pitch

Stoop is a buurt-prikbord. You join via a QR from someone you
already know.  You see what others in your buurt are asking,
offering, or willing to lend.  You can post your own.  When
something matches, you have a short private chat to coordinate.
Names stay hidden until you both agree to reveal them.  Your data
lives on your own pod, not on a company server.  Stoop opens when
you need it; it does not buzz at you.

## 2. Capabilities the app must offer (V1)

Grouped by what a user would say, not by technical module.

### A. Identity + profile

- A1. Pick a **handle** (`@oosterpoort-bird-23`) — primary public identifier, lowercase, visible to everyone in the group by default. Per-group unique (no two members in one group share a handle); cross-group I can use different handles for the same identity. Validation rules in `apps/stoop/src/lib/handle.js`.
- A2. Optionally set a **real name** — only revealed via the bilateral reveal handshake (D5).
- A3. Optionally add a **short bio** + **skills list** with per-skill availability / radius / capacity tags. Each skill picks a category from a fixed taxonomy + free-text tags (see § 3 "Skills taxonomy").
- A4. Optionally add an **avatar photo**.
- A5. See **how others see me** in the current group ("Anderen zien: @oosterpoort-bird-23").
- A6. Toggle **stille modus / vakantie**: my skills temporarily become "even niet beschikbaar"; new vragen don't reach me.
- A7. **Profile + skills auto-persist.** Local-only when no pod is signed in; mirrored to the pod when one is configured. No "save" button — every field change is debounced-persisted.
- A8. Each user has a **`stableId`** (opaque, generated once at first run, persisted in the vault, survives identity rotation). Hidden from UI by default; load-bearing for mute / report / ban / peer-cache resolution. Lives at the SDK level (`@canopy/core/identity/AgentIdentity`).
- A9. **(V2)** Optional **coarse location** — `{cell, label, source: 'gps' | 'geocode' | null}`. On mobile (V3): GPS. On web (V2): user types a place name or postcode → `geocode` skill calls OpenStreetMap Nominatim → coords → coarse-grain cell (default 500m). The label is human-readable ("Oosterpoort, Groningen"), never an exact street address. Privacy notice on the form: *"Je zoekopdracht wordt naar OpenStreetMap gestuurd om coördinaten op te halen."* Sharing it with anyone is opt-in per contact (see § 4e).
- A10. **(V2)** A **Settings** screen exposes cadence (§ 4g), the global hop-through toggle, and the default share-location flag for new contacts. All settings sync to pod when one is attached.

### B. Group membership

- B1. **Join a group** by scanning a QR (preferred) or pasting an invite link.
- B2. Read the group's **rules** before joining; tap "Akkoord" to confirm acceptance.
- B3. **Switch between groups** I'm in (one-tap).
- B4. **Create a new group** I'm admin of, by walking the six-question wizard (purpose, admins, house rules, conflict policy, access policy, leave policy).
- B5. **Issue an invite** for someone I trust — produces a QR + link (single-use, short TTL).
- B6. **Leave a group**, with an explicit choice: keep my posts visible / remove all my posts.
- B7. **(V2)** Anyone can **create a group** and becomes admin automatically. Admins can later promote co-admins or coordinators.
- B8. **(V2)** Groups have a **rotating membership code**, refreshed every 30 days. Two modes pickable at group creation:
   - *Alleen admins delen de code uit* — admins generate the new code and hand it to members personally.
   - *Iedereen mag de code doorgeven* — every member can pass the code to a newcomer.
   In both cases the code is exchanged **out of band** (WhatsApp, paper, in person). Whoever doesn't get the new code drops out after 30 days. The app helps with "tap to copy current code" but never sends it through Stoop's own network.
- B9. **(V2)** Members get a soft prompt 3 days before the rotation: *"De code wordt over 3 dagen vernieuwd; admin / medeleden geven je de nieuwe door."*

### C. Browse + post

- C1. Open the app → see the **prikbord** of the active group: vragen, aanbod, te leen, mixed.
- C2. **Filter** by kind (Vragen / Aanbod / Te leen) or "Alles".
- C3. Each post shows: kind chip, body text, author (handle by default), timestamp, optional skills tags, optional return-by date for lends.
- C4. **Post something new** with a kind picker (Vraag / Aanbod / Te leen), optional skills tags (auto-suggested from text via the keyword dictionary — see § 4 "Matching philosophy"), optional return-by date (lend only).
- C5. Optional toggle: **"Naam verbergen tot connectie"** (default on) — others see my handle, not my real name. Honestly labeled with what the relay operator can still see.
- C6. **See delivery feedback** — "geleverd aan 14 leden, 3 zijn online".
- C7. **Near-duplicate-post warning**: if my new post text is very similar to one of my last 5 posts in the same group, soft-warn before submit (*"Lijkt op je eerdere post 'X' — toch posten?"*). Not blocking.
- C8. **(V2)** Post-composer **target picker** — multi-select dropdown: my groups + my lists + my tags + "Alle bekenden" / "Alle vertrouwden" (see § 4f). Active group is the default. Last choice is remembered per kind for the next post.
- C9. **(V2)** **Distance picker** — preset values 1 / 2 / 5 / 10 / 25 km, hidden if I haven't set my location (§ A9).
- C10. **(V2)** Post detail page shows the targets in plain language: *"Vraag in Oosterpoort skills + Bekende contacten ≤ 5 km"*.

### D. Respond + coordinate

- D1. Tap a post → see the **post detail** + a button: **"Ik help"** / **"Ik wil dit lenen"** / **"Ik bied dit aan"** (label depends on kind).
- D2. Tapping the response button opens a **1-on-1 chat thread** with the post author, pre-loaded with a reference to the post.
- D3. Type a first message ("Hoi, ik heb een fietsenwerkplaats achter") and send.
- D4. The post author gets a **notification** + the thread shows up on their /mijn-posts. They can reply in the same thread.
- D5. Either side can tap **"Connectie accepteren"** in the thread → flips their local "show real name for this peer" flag AND sends a hint to the other side. When **both** have tapped, both sides see each other's real names from then on.
- D6. Either side can tap **"Markeer als afgerond"** → the post closes (for vragen / aanbod) or the lend gets marked returned.
- D7. **Stale-post nudge.** If a post sits open with no claim for ~30 days, the author gets a soft prompt: *"Nog steeds open? Heropen / verwijderen / klaar?"*. Default action when the user ignores the nudge: nothing — the post stays. Goal is to reduce "post-and-forget" stale prikbord clutter without making the app naggy.

### E. Lend lifecycle (variant of D)

- E1. **Post a te leen** with a return-by date.
- E2. When someone wants to borrow, the chat opens (D2) and we coordinate.
- E3. When I hand it over, I tap **"Uitgeleend"**. The post stays visible on the prikbord but shows the "Uitgeleend" chip — the borrower's handle is **not** shown publicly (privacy first; the lend record is between us in the chat thread).
- E4. The day before the return-by date, **both of us** get a soft reminder.
- E5. On return, either of us taps **"Teruggebracht"**. Post closes; reminder cancels.
- E6. Damage / dispute is **not handled by the app** (per the privacy / disclaimer doc — Stoop is not a trust intermediary). The chat thread is the record; the buurtgenoten work it out themselves.

### F. Local-magic discovery

- F1. When my phone is on the same Wi-Fi or in Bluetooth range as another Stoop user (in the same group), **a small hint** appears: "5 mensen in de buurt". No configuration.
- F2. Tap → see who they are (`@<handle>` only; no GPS).
- F3. **Discreet mode** (vital): an all-or-nothing toggle that silences the phone's local-broadcast (mDNS + BLE) advertisement. Default *off* (advertising on, since the magic-moment is part of the appeal). When on: I can still receive locally-broadcast presence, but I do not announce mine. Setting persists across sessions.
- F4. **Future compatibility note (not V1):** a separate proof-of-location app (`Project Files/projects/06-proof-of-location/`) will reuse the same local-broadcast surface for cryptographic presence proofs. Stoop's discreet-mode toggle should not preempt that app's identity model — both apps consume the same `@canopy/react-native` `MdnsTransport` / `BleTransport` cleanly.

### G. Profile of others + privacy controls

- G1. Tap a handle anywhere → see the peer's **public profile** in the current group: handle, real name (if revealed), bio, skills, "start chat" button.
- G2. From the chat thread, manage **per-peer reveal state** (show / hide their real name to me).
- G3. From settings, **mute** a peer (their posts hidden from my prikbord; pure local). **Mute is keyed by the peer's `stableId`** — handles can change, network pubkeys rotate, WebIDs only exist for pod users; only `stableId` survives all three. UI shows "Mute @oosterpoort-bird-23 (Anne van Dijk)" so the user knows which person they're muting; the ID stored under the hood is the stableId.
- G4. From settings, **unmute** + **see currently muted** (rendered with current handles, but stable across renames).
- G5. From a post's "..." menu, **report** the post → goes to the group admin (all admins of the group; § 3 J1).

### H. Notifications

- H1. Receive a **push** when:
   - Someone responds to my vraag / aanbod / te leen (default: yes, max 3/day, quiet hours apply).
   - A lend is due (default: yes).
   - A reveal is requested by the other side of a chat (default: yes).
   - Admin sends a group-wide message (default: yes, opt-out).
- H2. Per-user **opt-out** + **quiet hours** + **per-group "louder / quieter"** dial.
- H3. **In-app banner** when a notification arrives while the app is open (no push needed).
- H4. **(V2)** **Auto-skillmatch on loose contacts** — a post that arrives via the broadcast graph from someone I haven't trusted yet only fires a notification when its body intersects my skills profile (Layer 1). No match → silent (the post still lands on my prikbord, but no buzz).

### I. Privacy + data control

- I1. From the **Privacy** screen, see: relay operator name, relay URL, my pod URL, what's encrypted vs visible.
- I2. **Export my data** as a download (JSON snapshot of profile + own posts + audit + chat threads I'm in).
- I3. **Delete my account** — leaves all groups, optionally removes all posts, deletes pod data, signs out.
- I4. See and **save my recovery phrase** during onboarding (one-time; never re-shown — security best-practice).
- I5. **Encrypted-backup file** (replaces email-based recovery): at any time, generate `stoop-backup-<date>.json.enc` encrypted with a passphrase the user picks. The user mails it to themselves, drops it in their cloud, saves on a USB stick — Stoop never sees the file. Restore: drop the file in + passphrase → state restored on a new device. No central infra; no phishing magnet.
- I6. **Privacy notice** is shown on first run + always reachable from settings.
- I7. **(V2)** **Full pod-sync coverage**. With a pod attached, *all* user-touching state mirrors to the pod and back: identity (mnemonic + key), profile (handle, displayName, avatar, skills, location), MemberMap entries (group members + contacts + lists + tags + per-contact settings), Reveals, settings (cadence, hop, broadcastable), interest profile (Phase 22), push subscriptions, and the full post + chat history. The mechanism is the existing `CachingDataSource` write-through path — V2 wires the missing entities (Reveals, settings, interest, push subs) onto it.
- I8. **(V2)** **Device restore.** On a new device: enter recovery phrase → `core.Bootstrap.fromMnemonic` rebuilds the same identity → log into pod → cache pulls all state back → ready. No import file, no manual migration. The encrypted backup file (I5) remains for the offline / no-pod fallback.

### J. Group governance + moderation

- J1. As **admin**, see incoming reports → for each, options: ignore, message the reporter, message the reportee, remove the reportee.
- J2. As admin, **remove a member** → triggers their relay-side revocation; their existing posts become "removed member" placeholders.
- J3. As admin, **edit group rules** → pushes a new version visible to all members.
- J4. As admin, **issue and revoke invites**.
- J5. As member, **see who else is in the group** (handles + revealed names).

### K. Resilience

- K1. App **opens and works without internet** — I see what I had cached, my draft posts queue.
- K2. App **opens and works without a pod signed in** — local-only mode; I can sign in later and the app migrates.
- K3. Pod outage: **banner appears** ("Pod offline — wijzigingen worden bewaard"), nothing breaks.
- K4. App **survives kill / restart** — handle, posts, threads, mute list persist.
- K5. **Migrate to a new device** by signing into the same pod — local cache rebuilds from the pod.

## 3. User journeys (the seven flows that matter)

### Journey 1 — First run, joining a group

1. Anna installs Stoop, opens it.
2. Sees a one-screen welcome: *"Stoop is een buurt-prikbord. Geen feed, geen reclame, jouw data blijft van jou."*
3. Tap "Begin" → asked for a **handle** ("anne-23"). Validated client-side. Saved.
4. Asked: "Wil je nu inloggen op je pod, of later?"
   - "Later" → Anna lands in local-only mode (everything works; sync-to-pod queued).
   - "Nu" → OIDC sign-in flow → CachingDataSource attaches the pod source.
5. **Recovery phrase** is shown — Anna confirms she's saved it.
6. Asked: "Heb je een uitnodiging?"
   - Anna scans the QR Bob handed her at the buurt-BBQ.
   - Group's **rules.md** is rendered; Anna reads, taps "Akkoord".
7. Anna lands on the prikbord of "Oosterpoort skills".
8. **First post hint**: *"Ben je benieuwd wat er speelt? Scroll naar beneden. Wil je iets posten? Tap op +"*

**Time target:** under 5 minutes from open to seeing the prikbord.
**Failure modes:** invalid handle (told why); QR expired (told to ask Bob for a new one); no internet (local-only mode, banner says "synced when online").

### Journey 2 — Posting a vraag

1. Anna taps "+ Iets vragen".
2. Sees the post form: kind picker (Vraag / Aanbod / Te leen — Vraag pre-selected), text field, optional skills, optional date (only visible if kind=Te leen), advanced section (claim cap / hide-name).
3. Anna types "Iemand handig met fietsen? Achterwiel slingert na een val."
4. Submits.
5. Form clears; she sees her post at the top of the prikbord with chip "Vraag" + "geleverd aan 14 leden".
6. (Wait.)
7. Push: *"@klusclub-bob heeft op je vraag gereageerd."*
8. Anna taps the push → opens directly into a chat thread with Bob.

### Journey 3 — Responding to someone else

1. Bob opens Stoop, sees Anna's vraag.
2. Taps the post → post detail expands.
3. Taps "Ik help".
4. A small overlay appears: *"Stuur een eerste bericht aan @oosterpoort-bird-23 — bv. 'Hoi, ik woon vlakbij'."*
5. Bob types, sends.
6. Anna gets the push.
7. They chat back and forth in the thread.
8. At any point either taps "Connectie accepteren" → the bilateral reveal handshake (see Journey 4).

### Journey 4 — Bilateral reveal of real names

1. Mid-chat, either side taps **"Connectie accepteren"** → small confirmation: *"Hiermee zie je elkaars echte naam. Doorgaan?"*
2. On confirm → my local Reveals flag for the peer flips → I now see their displayName.
3. A hint message is sent in the chat thread: *"@klusclub-bob heeft 'Connectie accepteren' getapt. Wil je hetzelfde doen?"*
4. The other side sees the hint. They can tap their own confirm or ignore.
5. When **both** have flipped, both sides see real names from then on. Asymmetric reveal (only one side flipped) means: I see their name, they don't see mine.
6. Reveals can be **un-flipped** later (back to handle-only).

### Journey 5 — Lend lifecycle

1. Carl posts a "te leen" for his aanhanger, return by Sunday.
2. Bob taps "Ik wil dit lenen" → chat opens. Coordinates pickup.
3. They meet. Carl taps **"Uitgeleend"** in his /mijn-posts. The post still shows on the prikbord but with the "Uitgeleend" chip — no borrower handle is publicly visible.
4. Saturday evening: both Carl and Bob get a push reminder.
5. Sunday: Bob brings it back. Either taps **"Teruggebracht"** in the thread.
6. Post closes. Done. No public review.

### Journey 6 — Group create + admin work

1. New admin Maria taps "Nieuwe groep starten".
2. Six-question wizard. She fills in name, purpose, admins (herself + Joris), house rules, conflict policy, access policy, leave policy.
3. The wizard generates a `rules.md` — she reviews + saves.
4. She gets a QR + invite-link to hand to her first members.
5. As people join, she sees them on the **leden-tab**.
6. Someone reports a post — she sees a small badge on the **rapporten-tab**. She reads the post, the report reason, and either: ignores, messages the reporter, messages the reportee, or removes the reportee.
7. If she removes someone, they cannot post in the group anymore (relay-side enforced). Their old posts become anonymized placeholders.

### Journey 7 — Leaving / data control

1. Anna decides she wants out. Goes to **Instellingen → Privacy & data**.
2. Two top buttons: **"Exporteer mijn data"** (downloads a JSON file with her profile, posts, threads, audit), **"Verwijder mijn account"**.
3. Tapping "Verwijder mijn account" → confirmation flow with three options:
   - Verlaat groepen, behoud posts (default — preserves group context).
   - Verlaat groepen, verwijder mijn posts (clean break).
   - Verwijder ook mijn pod-data (radical: removes everything Stoop has stored about her).
4. After tapping confirm, app signs out + clears local state.

## 4. Information model the user touches

(In the user's words; not technical schema.)

### My profile

- Handle (lowercase, e.g. `@oosterpoort-bird-23`).
- Optional real name.
- Optional short bio.
- Optional avatar.
- Optional skills list. Each skill: text + tags + availability + radius + status (actief / gepauzeerd / gearchiveerd).
- (Hidden) WebID / pod URL.
- (Hidden) Stoop-internal id.

### A group

- Name (e.g. "Oosterpoort skills").
- Purpose (two sentences).
- Admins (list of handles).
- House rules (free text, plus the wizard's policy choices).
- My role in the group (lid / admin).
- (Hidden) groupId, admin pubkey, accepted-on-relay status.

### A post

- Author (handle by default, real name if revealed).
- Kind (Vraag / Aanbod / Te leen).
- Text body.
- Optional skill tags.
- Optional return-by date (Te leen only).
- State (open / vervuld / verwijderd / uitgeleend).
- Time it was posted.
- Group it belongs to.

### A chat thread

- The two participants (handles or real names per Reveals state).
- Linked post (optional but typical).
- Messages in chronological order.
- A reveal-state pill (handle-only / one-sided / mutual reveal).
- A "Markeer als afgerond" button (when applicable).

### A notification

- What it's about (response / reminder / reveal request / admin announcement / report).
- When it fired.
- One-tap action (open the relevant thread / post).
- Dismissible.

## 4b. Identifier model (who is "this person")

Stoop touches three different identifier shapes; treat each one as
load-bearing for a specific purpose, never substitute one for
another.

| Identifier | Lifetime | Visible | Used for |
|---|---|---|---|
| **`stableId`** | forever (set once at first run; survives rotation, device migration via vault recovery, pod-add later) | hidden from UI; load-bearing under the hood | mute, ban, report, peer-cache index, "this is the same person" linking |
| **Network pubKey** | rotates every 30 days | hidden | per-message signing, transport addressing, group proofs |
| **Handle** (`@oosterpoort-bird-23`) | mutable; per-group unique | the default rendered name in the UI | what users say to each other ("@bob heeft gereageerd") |
| **`displayName`** (real name) | mutable; opt-in | only visible after a bilateral reveal handshake | private intimacy / once-trust-is-built |
| **`WebID`** (Solid pod URL) | stable when present; *absent* for pod-less users | hidden (visible from the user's own "Where is my data?" screen) | pod data location, OIDC identity for the data layer |

Two consequences worth being explicit about:

- **`stableId` is the SDK-level "person" key.** Lives in
  `@canopy/core/identity/AgentIdentity`: generated at first run,
  persisted in the vault, untouched by `Agent.rotateIdentity()`. Apps
  use it for any "track this person across rotations / handle
  changes / pod changes" need. Stoop's mute / ban / report all key on
  it.
- **WebID is not the user identifier.** It's *one piece* of a user's
  profile (their pod location). Pod-less users have no WebID;
  Stoop must still work for them. So no app-level concept (mute,
  ban, etc.) takes WebID as input.

## 4c. Skills taxonomy

A small fixed list of top-level categories + free-text tags. Every
skill the user adds picks one category; tags are free.

```
- klusjes              (reparaties, doe-het-zelf)
- tuin                 (planten, snoeien, hovenierswerk)
- vervoer              (rijden, bezorgen, fietsreparatie)
- kinderopvang         (oppassen, lessen, vervoer)
- eten-en-koken        (samen koken, maaltijden, recepten)
- tech                 (computer, telefoon, internet, devices)
- administratie        (belasting, brieven, formulieren)
- lichaam-en-zorg      (boodschappen voor zieken, gezelschap, vervoer)
- creatief-en-handvaardig  (naaien, breien, lijmen, knutselen)
- anders
```

Each category has a multilingual label set (NL + EN + future
locales) loaded via the i18n wrapper:

```json
"skills": {
  "categories": {
    "klusjes":       { "nl": "Klusjes",       "en": "DIY / odd jobs" },
    "tuin":          { "nl": "Tuin",          "en": "Garden" },
    "vervoer":       { "nl": "Vervoer",       "en": "Transport" },
    ...
  }
}
```

Free-text tags are normalised through a small **multilingual
dictionary** so cross-language matching works:

```json
"tag-normalisation": {
  "fiets":     "bicycle",
  "fietsen":   "bicycle",
  "bike":      "bicycle",
  "bicycle":   "bicycle",
  "vélo":      "bicycle",
  "belasting": "tax-admin",
  "tax":       "tax-admin",
  ...
}
```

V1 ships ~500 hand-curated entries covering NL + EN + 1–2 other
local languages. V2 may extend via LLM-as-agent (see § 4d).

## 4d. Matching philosophy

How does the right help find the right person without spamming
everyone?

V1 stays purely on-device and uses three layered approaches:

**Layer 0 — manual skill tagging (already shipped).**
The poster optionally tags categories/skills on their post.
SkillMatch broadcasts; only members whose own skills profile
intersects the tags AND whose posture allows it get prompted.
Privacy: relay sees encrypted envelopes only; matching happens
client-side on each member's agent.

**Layer 1 — keyword auto-suggestion (V1 must-have).**
When the user types a post body, the form runs the body through a
small JSON keyword→category dictionary (~500 entries; multilingual)
and proposes tags. User accepts → Layer 0 logic applies. No
inference; pure dictionary lookup; cost: <1ms per keystroke.
Hits ~80% of cases.

**Layer 2 — personal interest learning (V1.5 nice-to-have).**
Each member's agent silently observes which posts the user
*responds to* over time and builds a small per-user interest
profile (bag-of-words, TF-IDF, normalised against the user's
skills profile). Posts the keyword filter would otherwise drop
are still surfaced if they match the user's pattern. Pure
on-device; per-user data never leaves the device.

**Layer 3 — LLM-as-agent (V2 territory; opt-in per buurt).**
A single LLM agent runs on a community-shared machine (admin's
home server, buurthuis Pi, opt-in VPS). It joins the buurt as
*another agent* — same network shape as the "Buurtwerkplaats"
non-human agent in the mockup. Members opt in to share their
post text with it. The LLM matches across languages + reads
context cues a dictionary can't, then sends targeted *"this might
be for you"* hints via `chat-agent`'s `MessagingBridge`. Members
who don't opt in get Layers 0–2 only.

This pattern composes existing substrates: `@canopy/llm-client`
(LLM API), `@canopy/chat-agent` (LLM-as-agent shape), Stoop's
own skill-match. Different buurten can pick different LLM
providers; some pick none. The mockup's "mens en
machine-agents naast elkaar" principle is exactly this.

**Why not relay-side matching?** Two reasons: (1) the relay would
need to learn everyone's skills + post topics, which dissolves the
"relay sees only encrypted envelopes + group IDs" privacy model;
(2) it would lock buurten to whichever relay implementation has
the matching logic. Local + opt-in-LLM keeps the relay dumb, the
user smart, and operator-trust low.

## 4e. Contact graph (V2)

A **contact** is a 1:1 relation, separate from group membership.
You can trust someone without being in a group with them, and you
can be in a group with someone without ever adding them as a
contact. Contacts give you a richer addressing model for posts
(see § 4f) and let you decide who can hop traffic through your
device.

```
Contact = {
  webid,
  pubKey,                     // network identity, last known
  handle,                     // how they appear in my UI
  trustLevel:    'bekend' | 'vertrouwd',
  shareLocation: bool,         // only meaningful at 'vertrouwd'
  allowHopThrough: bool,       // may this person relay through me?
  allowAutomatching: bool,     // accept inbound auto-skillmatch hints?
  tags:          string[],     // my own free labels: 'koor', 'buurmoeders', …
  addedAt:       ms epoch,
}

ContactList = {
  listId,
  name,                        // 'Vrienden', 'Werk', 'Schoolouders', …
  contactWebids: string[],     // hand-picked
}
```

**Adding a contact:**
- QR contact-share (one-shot token, base64url payload — same
  encoding as group invites in Phase 17).
- Manual: paste WebID + pubKey.
- Promote from group member list: tap a member → "Toevoegen aan
  contacten".

**Removing / muting** is local-only. No "ontvriend"-notification
fires (per privacy design).

**Asymmetric** (per § 4 of the same Stoop principle as the reveal
handshake): when Anna marks Bob `vertrouwd`, Bob is not
automatically reciprocated. Bob gets a notification *"Anna wil je
toevoegen als vertrouwd contact; aanvaarden?"* and chooses
independently.

**Hopping has two switches** (both default *off*):
- **Global** in Settings (`§ 4g`). When off, my device never
  relays for anyone — overrides any per-contact opt-in.
- **Per-contact** (`allowHopThrough`). Only relevant when global
  is on.

**Tags** are personal free labels (`koor`, `buurmoeders`, `werk`).
**Lists** are hand-picked groupings (`Vrienden`, `Schoolouders`).
Tags and lists are independent — a contact can carry several tags
and appear in several lists. Both are local-to-me; the contact
themselves doesn't see how I label them.

## 4f. Targeting (V2; extends § C "Posten")

A post in V2 has a list of `targets` plus optional
`maxDistanceKm`:

```
Target =
  | {kind: 'group',     groupId}
  | {kind: 'contacts',  minTrust: 'bekend'|'vertrouwd'}
  | {kind: 'tag',       tag:    'koor'}
  | {kind: 'list',      listId: '01KQ…'}

Post = {
  ...,
  targets:        Target[],            // at least one
  maxDistanceKm:  1|2|5|10|25 | null,   // snapped to grid; null = no cap
}
```

The post composer shows a multi-select dropdown of: my groups +
my lists + my tags + "Alle bekenden" / "Alle vertrouwden". I can
combine any number. The active group is the default for back-compat
with V1.

**Filter chain** (no central server):

1. **Sender filter** (my agent, before broadcast). Resolve every
   target to a recipient set; drop recipients whose last-known
   geo-cell is beyond `maxDistanceKm` (when I know their
   location); drop recipients I muted. Saves bandwidth and
   reduces metadata leakage to relays / hops.
2. **Receiver filter** (peer's agent, on arrival). Drop if I
   muted the sender; drop if my current cell moved beyond
   `maxDistanceKm`; drop if my `broadcastable: false`; drop if
   this came in via the auto-skillmatch path (loose contact)
   AND the body doesn't intersect my skills profile (Layer 1).
3. **User notification** fires only when both filters let it
   through. Posts that pass filter #1 but not #2 still land
   silently on the prikbord — the user finds them when
   scrolling, but no buzz.

**Distance grid.** `maxDistanceKm` snaps to the same grid the
location itself uses (default 500m cells). The post composer
offers preset distances `1 / 2 / 5 / 10 / 25 km` — no free slider
that would expose finer granularity than the location grid
warrants.

## 4g. Cadence + battery awareness (V2 desktop, V3 mobile)

Settings the user can tune (synced to pod):

| Setting | Meaning | Default desktop | Default mobile (V3) |
|---|---|---|---|
| `pollIntervalMs` | how often I pull open posts when foreground | instant (live) | 5 min |
| `onlineWindow.everyMinutes` / `.durationSec` | when my agent connects to relay / NKN | always-on | every 60 min, 2 min on |
| `broadcastable` | accept inbound auto-skillmatch hints from loose contacts? | true | true |
| `allowHopThrough` (global) | may my device relay for any contact? | false | false |

These live on `/settings.html` and write through the same
cache → pod path as everything else (see § I7).

V2 web honours `pollIntervalMs` and `broadcastable` /
`allowHopThrough`; `onlineWindow` is recorded but has no runtime
effect on web (always-on). V3 mobile reads all four and binds
`onlineWindow` to `expo-task-manager`.

## 5. Privacy + identity model (the user's view)

The bargain Stoop is offering:

- **What's protected:** message contents, real names by default.
- **What's *not* protected:** your account is visible to the relay operator; your handle is visible to other group members; mDNS/BLE local broadcast announces your presence to anyone in radio range.
- **Network identity rotates** every 30 days — invisible to you, but it caps long-term tracking.
- **Real name** is opt-in, per-peer or per-group. The reveal is symmetric: each side independently consents.
- **Pod data** is yours — relay operator never sees it; pod provider does (gated by your ACPs, which Stoop sets up safely by default).
- **There is no platform support desk.** Conflicts are between members; admin is the first line.

The privacy notice on first run states all of this in plain Dutch.

## 6. What is *not* in V1

To keep the scope honest:

- ❌ Cryptographic anonymity (relay can still correlate handle ↔ network identity).
- ❌ Multi-relay / federation.
- ❌ Skill chains / ring-trade matchmaking.
- ❌ Public ratings or stars (intentional design choice).
- ❌ Rich media beyond a profile avatar (no photo galleries on posts; V2).
- ❌ Multi-admin coordination (vote-to-demote, soft-veto).
- ❌ Buurt-resources as autonomous agents (a shared aanhanger that posts itself).
- ❌ Damage / dispute resolution mechanics.
- ❌ Calendars, reservations, time-slot booking on lends.
- ❌ Stoop Relay Kit (admin GUI for running your own relay — separate deliverable).

Stoop V1 is a buurt-prikbord with a chat layer and an honest privacy
model.  It is not a marketplace, not a social network, and not a
trust intermediary.

**V2 expansion (planned for the V2 coding plan, 2026-05-07):**
contact graph (§ 4e), multi-target posts with distance filtering
(§ 4f), cadence + battery awareness (§ 4g), self-creatable groups
with rotating membership codes (B7–B9), profile photo + holiday
mode UI (A4, A6), full pod-sync coverage + device restore (I7,
I8). Cryptographic anonymity, multi-relay, ratings, and dispute
resolution **stay parked** beyond V2 — they remain anti-goals.

## 7. Open questions

### Resolved (2026-05-06)

| Question | Decision |
|---|---|
| **Skills tagging** | Fixed top-level taxonomy (10 categories) + free-text tags, with multilingual normalisation dictionary. Form suggests via Layer-1 keyword matcher. |
| **"Uitgeleend" chip** | Just the chip — no borrower handle visible publicly. |
| **Reports visibility** | All admins of the group. |
| **Handle uniqueness** | Per-group unique (no two members share a handle in one group). Cross-group, the same user can pick different handles. |
| **Recovery phrase** | One-time show during onboarding, never re-displayed. **Encrypted-backup-file** pattern (passphrase-protected JSON, user keeps it themselves) replaces the email-based recovery idea. |
| **"Bedankt" notes** | Dropped. Replaced by the existing **"Markeer als afgerond"** + a 30-day stale-post nudge. |
| **Group-wide announcements** | Admin-only. |
| **Discreet mode** | All-or-nothing toggle. Default *off*. Vital for V1. Compatible with future proof-of-location app. |
| **Mute identifier** | `stableId` (SDK-level, lives in `@canopy/core/identity/AgentIdentity`). Survives handle changes, network rotations, pod-less users, pod migrations. |
| **Hop routing** | Use `agent.enableSealedForwardFor(groupId)` on every Stoop agent so any agent that becomes a hop bridge sees opaque blobs only. Set in the agent factory. |
| **Profile + skills persistence** | Auto-persist to local cache always; mirror to pod when signed in. No "save" button. |
| **Matching strategy** | V1 = local-only Layers 0–2 (manual tags, keyword auto-suggest, personal interest learning). LLM-as-agent (Layer 3) is V2 territory and opt-in per buurt. No relay-side matching. |

### Resolved (2026-05-07, V2 expansion)

| Question | Decision |
|---|---|
| Trust levels per contact | Two: `bekend` and `vertrouwd`. Plus existing `mute`. No third "intiem" level — distinction was unclear and would have overcomplicated the UI. |
| Contact reciprocity | Asymmetric — each side opts in independently (same shape as the bilateral reveal handshake). No automatic symmetry. |
| Location source | GPS on mobile (V3); on web (V2) the user types a place / postcode and the `geocode` skill calls OpenStreetMap Nominatim. Privacy notice shown at input time about the Nominatim query. |
| Location granularity | Coarse-grain cell (default 500m). `maxDistanceKm` snaps to the same grid; UI offers preset distances 1 / 2 / 5 / 10 / 25 km — no free slider. |
| Group key rotation modes | Two, picked at group creation: *alleen admins delen* and *iedereen mag doorgeven*. Codes always exchanged out-of-band (WhatsApp, paper, in person). |
| Multi-target posts | Yes. `targets` is a list of `{kind, …}` entries: group / contacts-by-trust / tag / list. Active group is the default for back-compat. |
| Hopping toggle layers | Two: global on/off in Settings (default off) + per-contact opt-in (default off, only relevant when global is on). |
| Filter chain | Sender-side first (saves bandwidth + metadata), receiver-side second (final user-protection layer). User notification only when both let it through. |
| Pod-sync scope | All persistent state. One mnemonic + pod sign-in restores everything on a new device. Phase 29 wires the missing entities (Reveals, settings, interest profile, push subs); Phase 30 wires the device-restore flow. |
| Hobby variant | Future fork (`apps/stoop-hobby/` template). Not in V2 scope. Substrate boundaries already support it; just architectural intent. |

### Still open (emerged 2026-05-06; not blocking the next coding-plan revision)

1. **Buurt-LLM deployment shape (V2).** When the LLM-as-agent direction is taken up, who deploys it per buurt? the author's home server as a default? A small "deploy-to-Hetzner" button in the future Stoop Relay Kit? An admin-runnable Pi container? Decided when V2 is on the table, not now.
2. **Tag-normalisation dictionary curation.** ~500 entries hand-curated for V1. NL + EN + which other languages? Probably French + Arabic + Turkish for typical Dutch buurten — but that's an editorial call, not a tech one. Defer to whoever runs the closed beta; the JSON is hot-swappable.
3. **Stale-post nudge timing.** 30 days is a guess. Could be 14, could be 60. Tunable; first real testers will tell us.
4. **Encrypted-backup-file UX.** Where does it download (which folder)? How obvious is the passphrase prompt? Specifics for the V1 onboarding screen polish, not blocking the design.
5. **Relay-deployment kit (later).** the author's idea of a relay-package with general tools (LLM, identity, admin GUI) bundled — flagged in `Project Files/TODO-GENERAL.md` for relay-development roadmap. Out of V1 scope.

## 8. What success looks like

If a buurtgenoot installs Stoop, gets onboarded in 5 minutes, posts
a vraag, and within a week has had one real-life exchange with a
neighbor — Stoop V1 is working.

If a group of 5–10 buurtgenoten use the app for a month and the
admin reports "no real moderation issues, people are using it" —
Stoop V1 is good.

The goal is not engagement.  The goal is: low-friction, occasional,
useful neighbor-to-neighbor exchanges.  The app should be
forgotten between uses, not opened as a daily habit.
