# L1h (identity-resolver) — member-webid + cross-source identity

| | |
|---|---|
| **Package** | `@canopy/identity-resolver` |
| **Status** | sketch — Phase A |
| **Driven by** | H4 (tasks — member-webid map) primary; H7 (archive — cross-source Person records) secondary |
| **Pattern source** | H7's identity-reconciliation section in `projects/05-archive-app/README.md`; H4's member resolution in `track-H-app-tasks.md` |
| **RN variant?** | Probably no — pure data layer |
| **Phase B priority** | Step 7 |

---

## What it is

A substrate for **identity resolution and reconciliation**:

- **Member-webid map** (H2 / H4 / H5 use case): given a Telegram
  uid / display name / app-internal id, return the corresponding
  webid; given a webid, return display name + role.
- **Cross-source Person records** (H7 use case): the same person
  appears as `alice@example.com` in Gmail, `+31 6 12345678` in
  WhatsApp, `alice@icloud.com` in iCloud, and a `@canopy` pubkey.
  Substrate links these into a single Person record.

Both are "map identifiers between systems" — a single substrate
covers both at different complexity levels.

---

## Consumer specs driving the design

- **Primary: H4 (tasks).**  Members have webid + display name + Telegram uid.  Task attribution writes webid; UI renders display name; bot resolves Telegram uid → webid on incoming message.
- **Secondary: H7 (archive).**  Person records aggregate identifiers across sources; queries (`archive.search({person: 'alice'})`) match all of them.

H5 (neighborhood) consumes the lighter version (member-webid map);
H8 (presence) does too (witness identification).

---

## Public API shape

### Member-webid map (primary use case — H2/H4/H5)

> **Updated 2026-05-04 (Phase 4.1):** `MemberMap.fromPodConfig(...)`
> shipped as the canonical pod-backed factory; runtime-injected
> `podClient` (no peer-dep). Schema: `{members: [{webid, displayName?,
> pubKey?, externalIds?, role?}, ...]}`. The `pubKey` slot is required
> by L1e (`@canopy/skill-match`) — pubsub subscribes peer-by-peer.
> Apps that don't use skill-match-over-pubsub may omit it.

```ts
import { MemberMap } from '@canopy/identity-resolver';

// New canonical factory — pod-backed, NOT_FOUND-tolerant via fallback.
const members = await MemberMap.fromPodConfig({
  podClient,                                                // duck-typed: { read(uri, opts?) }
  configUri: 'https://test.example/h2-household/config.json',
  fallback:  [],                                            // [] = empty roster on first boot
});

// Legacy in-memory factory (still works):
//   const members = new MemberMap({ initial: [...] });

// Add member during onboarding
await members.addMember({
  webid:       'https://id.inrupt.com/anne',
  displayName: 'Anne',
  pubKey:      'ed25519-pubkey-base64',                   // for skill-match pubsub
  externalIds: {telegramUid: '12345', email: 'anne@example.com'},
  role:        'member',                                  // SNAPSHOT — see role-snapshot note in MemberMap.js JSDoc
});

// Resolve
await members.resolveByExternalId('telegramUid', '12345');
// → {webid, displayName, pubKey, role, ...}

await members.resolveByWebid('https://id.inrupt.com/anne');
// → {webid, displayName, pubKey, role, externalIds, ...}

await members.list();
// → all members

// Remove (with key-rotation hook)
await members.removeMember('https://id.inrupt.com/anne');
// triggers `member-removed` event; app handles group-key rotation
```

### Person records (cross-source — H7)

Larger surface; ships as a separate sub-package or class:

```ts
import { PersonGraph } from '@canopy/identity-resolver/person-graph';

const graph = await PersonGraph.open({
  podClient,
  rootContainer: 'https://test.example/archive/people/',
});

// Add identifier observation
await graph.observe({
  identifier: {kind: 'email', value: 'alice@example.com'},
  observedIn: {source: 'gmail', sourceId: 'msg-abc'},
});

// Auto-link rule: same email across sources → same person
await graph.observe({
  identifier: {kind: 'email', value: 'alice@example.com'},
  observedIn: {source: 'icloud', sourceId: 'mail-def'},
});
// graph automatically merges into one Person

// Manual link (UI-driven)
await graph.link(
  [
    {kind: 'email', value: 'alice@example.com'},
    {kind: 'phone', value: '+31612345678'},
  ],
  {confidence: 'user-asserted'},
);

// Query
await graph.findByIdentifier({kind: 'email', value: 'alice@example.com'});
// → Person (with all known identifiers)

await graph.findByName('alice');
// → Person[] (substring match across display names)
```

---

## Dependencies

- **L0 (`@canopy/pod-client`)** — for storing member config + Person records.

---

## RN variant

**Probably none needed.**  Pure data layer.  Same reasoning as L1b.

---

## Open questions

1. **Where does the member-webid map live?**  Per-app pod (H2's `/household/config.json`) or a shared @canopy-wide pod?  Lean: per-app for V0; substrate operates on whatever pod URI you give it.
2. **Display-name rendering snapshot vs live.**  When an audit log records "Anne added bread", does it persist `displayName: 'Anne'` (snapshot) or just the webid?  Lean: snapshot at write time (per L1b's design); resolver provides a live lookup for current name.
3. **Identifier confidence levels.**  Auto-linked (same email) vs user-asserted vs system-suggested-then-user-confirmed.  Substrate should track confidence; H7's UI surfaces it.
4. **Privacy concerns for the Person graph.**  H7 builds a cross-source graph of one user's contacts.  This is sensitive data; encryption at rest matters.  Lean: encrypted to the user's own key (per Track A's encryption-by-ACL pattern, where applicable).
5. **Identifier kinds — extensible enum.**  `email | phone | webid | telegram-uid | apple-id | ...`.  Lean: open enum; substrate doesn't enforce a closed set.

---

## Pattern sources

- **H7's `projects/05-archive-app/README.md` § "Identity reconciliation"** — the cross-source Person graph requirements.
- **H4's `track-H-app-tasks.md` § "Roles + governance"** — the member-webid map requirements.
- **H2's `track-H-app-household-v2.md` § "Q-H2.21 Member-webid mapping"** — the onboarding-time map population.

---

## Out of scope for V0

- Cross-app identity unification (each app owns its own Person graph in V0).
- Privacy-preserving identifier matching (homomorphic / ZK) — V1+ if a real demand surfaces.
- Identifier-changes-over-time (someone changes phone number) — V0 supports re-linking via UI; auto-detection is V1+.
- Handling multiple-people-with-same-name disambiguation — V0 punts (H7 spec already defers to V2).
