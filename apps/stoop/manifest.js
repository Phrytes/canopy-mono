/**
 * stoop — app manifest (Slice D.1 DRAFT, 2026-05-20).
 *
 * Authored per `PLAN-gui-chat-uplift.md` Slice D.1 — owner-locked
 * direction is **slash-only first, then evaluate LLM tool-calling on
 * top**.  Every user-facing op declares both `surfaces.slash.command`
 * (the live D.1 surface) and `surfaces.chat.hint` (forward-compat
 * declaration for the D.2 LLM tool-calling layer; no LLM integration
 * in D.1).
 *
 * Op set (~14): mined from `src/skills/index.js` via
 * `AUDIT-stoop-folio-surfaces.md`'s "primary flows" recommendation.
 * Stoop has 110 `defineSkill()` definitions in total; this manifest
 * deliberately surfaces only the chat/slash-callable core
 * (post + browse + claim + lifecycle + moderation + profile).
 *
 * Admin-only flows (`createGroupV2`, `editGroupRules`, `removeMember`,
 * `rotateMyGroupCode`, `postAnnouncement`) and plumbing
 * (`encryptedBackup`, `getMnemonicOnce`, `startPodSignIn`, attachments,
 * push subscription, contact-QR exchange, …) stay un-manifested in D.1
 * — they are not slash-natural and the chat surface doesn't need
 * them.  They can be added in a follow-on D.x slice if the LLM layer
 * (D.2) wants tool-call access.
 *
 * F-SP1-a — every stoop itemType is app-local (`ask`/`offer`/`lend`/
 *           `report`/`group-rules`/`rules-accept`/`group-leave`/
 *           `request`) — none are canonical in `@canopy/item-types`.
 *           Permitted by `validateManifest`.
 * F-SP1-e — non-canonical verbs used here: `report`, `mute`, `set`,
 *           `tree`.  Each is annotated inline.
 *
 * Slash-grammar choice: bare names selected to **minimise collisions
 * with household's `/add /list /done /remove /help /task /tasks
 * /claim /register`**.  Stoop's commands are bulletin-/peer-prefixed
 * (`/post`, `/bulletin`, `/mine`, `/respond`, `/lend-assign`,
 * `/lend-return`, …).
 *
 * Owner DECIDE markers resolved 2026-05-21 (this commit) — see commit
 * message for the resolution table.  Naming choices favour English
 * (open-source convention); Dutch synonyms (`buurt`, `prikbord`,
 * `mijn`, `reageer`, `intrekken`, `teruggebracht`, …) are kept as
 * `match.verbs` aliases.
 *
 * Hints come verbatim from each `defineSkill({description})` string
 * (one source — no fresh prose).  Where the description was terse,
 * a brief clarifier is added in parens.
 *
 * Complex array/object params (`embeds`, `targets`, `attachments`,
 * `skills[]`, `rules{}`) are intentionally NOT modelled in the slash
 * surface — slash is line-oriented.  They remain reachable via the
 * skill registry directly (web/mobile forms today; LLM tool-calls in
 * D.2).  This mirrors the tasks-v0 V0 approach.
 *
 * `surfaces.slash.match` is provided for ops whose body is a single
 * scalar (text/itemId/reason); ops requiring two-arg bodies
 * (`assignLend({itemId, borrowerWebid})`,
 * `setPeerReveal({peerWebid, showDisplayName})`) declare the slash
 * `command` only (no `match` parser); they remain reachable as
 * pure-command shells that surface the form / picker in the consumer.
 *
 * `surfaces.slash` is INTENTIONALLY present without a fully wired
 * `match` block for every op in this DRAFT — the renderSlash matcher
 * tolerates `command`-only entries (used purely for the
 * setMyCommands menu listing); per-op characterization corpus + match
 * filling will land in the D.1 follow-up commit per
 * PLAN-gui-chat-uplift.md.
 */

const STR_NONEMPTY = { schema: { minLength: 1 } };
const ID_NONEMPTY  = { schema: { minLength: 1 } };

// Stoop's full item-type vocabulary (from `src/lib/itemTypes.js`).
// All app-local — none are canonical in `@canopy/item-types` (F-SP1-a).
const ITEM_TYPES = [
  'ask',
  'offer',
  'lend',
  'report',
  'group-rules',
  'rules-accept',
  'group-leave',
  'request',  // legacy V0 — preserved for back-compat
];

// The trio that renders on the prikbord (ask / offer / lend) — used as
// the enum for `postRequest({intent})` and `listOpen({intent})`.
const PRIKBORD_INTENTS = ['ask', 'offer', 'lend'];

/** @type {import('@canopy/app-manifest').__types__} */
export const stoopManifest = {
  app:       'stoop',
  itemTypes: ITEM_TYPES,

  operations: [
    // ── Post + browse ───────────────────────────────────────────────
    {
      id:   'postRequest',
      verb: 'add',
      // No `appliesTo.type` — postRequest dispatches across ask/offer/
      // lend based on the `intent` arg, so it spans three types.
      params: [
        // `intent` picks one of {ask, offer, lend}; the skill
        // translates this to canonical {type, kind} via
        // `intentToCanonicalDraft`.
        { name: 'intent', kind: 'enum', of: PRIKBORD_INTENTS, required: true },
        { name: 'text',   kind: 'string', required: true, ...STR_NONEMPTY },
        // Optional lend-only field (epoch-ms due date).
        { name: 'dueAt',  kind: 'number' },
        // Optional skill tag the post requires/offers (single string;
        // the underlying skill accepts an array via `requiredSkills`
        // but the slash surface is scalar-only — see header).
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'Post an item (ask/offer/lend) and broadcast it; returns immediately. Pass `expectClaims > 0` to wait for claims.' },
        slash: {
          command: '/post',
          shape:   '/post <ask|offer|lend> <text>',
          // Body shape: 'type+text' — renderSlash emits
          // `/post ask buy a vacuum cleaner` → {intent:'ask',text:'...'}.
          // Verb tokens: EN ('post', 'add', 'share') + NL ('plaats', 'deel').
          match: {
            verbs:   ['post', 'plaats', 'deel'],
            body:    'type+text',
            onEmpty: { skillId: 'postRequest', args: {} },
          },
        },
      },
    },
    {
      id:   'listOpen',
      verb: 'list',
      // listOpen spans the three prikbord types — no appliesTo.type
      // narrowing (same as postRequest).
      params: [
        // Optional filter — the underlying skill accepts both.
        { name: 'intent', kind: 'enum', of: PRIKBORD_INTENTS },
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'List open requests; optional `skill` + `intent` filters.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/bulletin` (EN — open-source
          // convention).  `/list` would collide with household.listOpen;
          // `/bulletin` is collision-free and the English equivalent of
          // the in-app term "prikbord"/"buurt".  Dutch synonyms kept as
          // match.verbs aliases.
          command: '/bulletin',
          shape:   '/bulletin [ask|offer|lend]',
          match: {
            verbs:   ['bulletin', 'board', 'posts', 'open', 'prikbord', 'buurt'],
            body:    'type-only',
            onEmpty: { skillId: 'listOpen', args: {} },
          },
        },
      },
    },
    {
      id:   'listMyRequests',
      verb: 'list',
      params: [],
      surfaces: {
        chat:  { hint: 'List open requests posted by the calling actor.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/mine` (EN).  Collision-free
          // with household.  NL alias `mijn` kept as a match verb.
          command: '/mine',
          match:   { verbs: ['mine', 'mijn'], body: 'none' },
        },
      },
    },

    // ── Negotiate / chat ────────────────────────────────────────────
    {
      id:   'respondToItem',
      verb: 'claim',  // canonical — `respondToItem` soft-claims the post.
      params: [
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'body',   kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Open a chat thread on a post + send the first message; soft-claims the post.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/respond` (EN — action-on-post).
          // `/reply` would feel too chat-app-generic; `/respond` reads
          // as taking action on a referenced item.  No `match` block:
          // two-arg body (itemId + free-text) needs the chat composer's
          // picker UI — slash-command shell only.  Aliases (`reply`,
          // `reageer`) noted here for future grammar work; consumer's
          // composer can prefix-match if useful.
          command: '/respond',
          shape:   '/respond <itemId> <message>',
        },
        ui: { control: 'button', label: 'Reageer' },
      },
    },
    {
      id:        'cancelRequest',
      verb:      'remove',  // canonical — cancelRequest removes the item.
      // V0.2 Q8 wildcard (2026-05-21) — cancelRequest spans ALL post
      // types (ask/offer/lend).  The wildcard `appliesTo: {type: '*'}`
      // surfaces cancelRequest as `itemActions[]` in every section
      // (renderWeb's Q8 rule).  Without this, cancelRequest had no
      // `appliesTo` and didn't surface as an itemAction anywhere; the
      // mine.html page had to hard-code the Cancel button.  The
      // wildcard makes the manifest the source of truth.
      appliesTo: { type: '*' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Cancel an open request.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/withdraw` (EN — clearer
          // mental model: "withdraw my post").  `/cancel` is too
          // generic; `/remove` collides with household.  Aliases
          // (cancel, intrekken, annuleer) in match.verbs.
          command: '/withdraw',
          match: {
            verbs:   ['withdraw', 'cancel', 'intrekken', 'annuleer'],
            body:    'match',
            onEmpty: { skillId: 'cancelRequest', args: {} },
          },
        },
        ui: { control: 'button', label: 'Trek in' },
      },
    },

    // ── Lend lifecycle ──────────────────────────────────────────────
    {
      id:        'assignLend',
      verb:      'reassign',  // canonical — assigns the borrower.
      appliesTo: { type: 'lend' },
      params: [
        { name: 'itemId',        kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'borrowerWebid', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Assign a lent item to a borrower without closing it.' },
        slash: {
          // Collision-free vs household (`/claim` is theirs).  Stoop-
          // specific verb name.  No `match`: two-arg body.
          command: '/lend-assign',
          shape:   '/lend-assign <itemId> <borrower-webid>',
        },
      },
    },
    {
      id:        'markReturned',
      verb:      'complete',  // canonical — marks the lend complete.
      appliesTo: { type: 'lend' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Mark a lend item as returned; cancels its return reminder.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/lend-return` (EN —
          // domain-prefixed makes it unambiguous in a multi-app host).
          // `/returned` alone would be ambiguous vs tasks lifecycle.
          // `/done` collides with household.  Aliases in match.verbs.
          command: '/lend-return',
          match: {
            verbs:   ['returned', 'teruggebracht', 'terug'],
            body:    'match',
            onEmpty: { skillId: 'markReturned', args: {} },
          },
        },
        ui: { control: 'button', label: 'Teruggebracht' },
      },
    },

    // ── Moderation ──────────────────────────────────────────────────
    {
      id:   'reportPost',
      verb: 'report',  // F-SP1-e: non-canonical.  Resolved 2026-05-21
                       // (owner): kept `report` (truer to intent).
                       // Squeezing into canonical `add` would obscure
                       // the action's nature.
      appliesTo: { type: 'report' },
      params: [
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'reason', kind: 'string', ...STR_NONEMPTY },  // optional but if present must be non-empty
      ],
      surfaces: {
        chat:  { hint: 'File a report on another item; visible to admins of the group.' },
        slash: {
          // Collision-free.  No NL synonym in V0; UI calls it
          // "rapporteer".
          command: '/report',
          match: {
            verbs:   ['report', 'rapporteer', 'flag'],
            body:    'match',
            onEmpty: { skillId: 'reportPost', args: {} },
          },
        },
        ui: { control: 'button', label: 'Rapporteer' },
      },
    },
    {
      id:   'mutePeer',
      verb: 'mute',  // F-SP1-e: non-canonical.  No canonical verb
                     // fits (it's not add/remove/list — it's a
                     // local-only filter flag).
      params: [
        // Either is accepted; the skill resolves both via
        // `_resolveMuteKey`.  Modelled as separate optional params;
        // the slash body picks one or the other.
        { name: 'peerStableId', kind: 'string' },
        { name: 'peerWebid',    kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'Locally mute a peer (does not affect anyone else). Prefer peerStableId; peerWebid back-compat.' },
        slash: {
          command: '/mute',
          shape:   '/mute <peer-handle-or-stableId>',
          // `match` body: single token gets stored as `peerStableId`;
          // the consumer can transform handles → stableId before
          // dispatch.
          match: {
            verbs:   ['mute', 'demp'],
            body:    'match',
            onEmpty: { skillId: 'mutePeer', args: {} },
          },
        },
      },
    },

    // ── Profile / reveals ───────────────────────────────────────────
    {
      id:   'setMySkills',
      verb: 'set',  // F-SP1-e: non-canonical.  This is a profile
                    // mutation — not add/remove/list of an item.
                    // Resolved 2026-05-21 (owner): kept as one
                    // `setMySkills` op (vs splitting into addMySkill +
                    // removeMySkill).  Slash is line-oriented; "set my
                    // skills" is the natural user mental model.
                    // Granular `addMySkill`/`removeMySkill` already
                    // exist as skills and can be added to a future LLM-
                    // only manifest layer (D.2) if needed.
      params: [
        // Complex param — array of {categoryId, freeTags?,
        // availability?, radius?, status?}.  Slash surface can't
        // express this directly; declared as a string the consumer
        // parses (e.g. JSON-encoded form-submit payload).
        { name: 'skills', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: "Replace the calling actor's skills array." },
        slash: {
          // Resolved 2026-05-21 (owner): `/skills` (direct; matches op
          // id 1:1).  A future `/profile` or `/profile-edit` can land
          // separately if richer profile-mutation slash surfaces are
          // needed.
          command: '/skills',
          shape:   '/skills <json-array-of-skill-entries>',
        },
      },
    },
    {
      id:   'setPeerReveal',
      verb: 'set',  // F-SP1-e: non-canonical — local-only reveal flag.
      params: [
        { name: 'peerWebid',       kind: 'string',  required: true, ...STR_NONEMPTY },
        { name: 'showDisplayName', kind: 'boolean' },  // default true server-side
      ],
      surfaces: {
        chat:  { hint: 'Locally flip "show real name" for a single peer.' },
        slash: {
          // Two-arg body (peerWebid + bool) — slash shell, no match.
          command: '/reveal',
          shape:   '/reveal <peer-webid> [on|off]',
        },
      },
    },

    // ── Groups ──────────────────────────────────────────────────────
    {
      id:   'leaveGroup',
      verb: 'remove',  // canonical — leaving is a removal of self.
      appliesTo: { type: 'group-leave' },
      params: [
        { name: 'groupId',     kind: 'string',  required: true, ...ID_NONEMPTY },
        { name: 'deletePosts', kind: 'boolean' },  // default false server-side
      ],
      surfaces: {
        chat:  { hint: "Record group-leave audit + optionally delete the actor's own items." },
        slash: {
          command: '/leave-group',
          shape:   '/leave-group <groupId> [--delete-posts]',
        },
      },
    },

    // ── Read-only graph walk ────────────────────────────────────────
    {
      id:   'getItemTree',
      verb: 'tree',  // F-SP1-e: non-canonical.  `list` doesn't fit
                     // (this returns a tree, not a flat list);
                     // `tree` is a domain-natural read-only verb.
      params: [
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: "Walk an item's embeds/deps tree, materialising cross-pod refs (Phase 3.3c decentralised read path)." },
        slash: {
          // Collision-free.  Read-only; no NL alias needed in V0.
          command: '/tree',
          match: {
            verbs:   ['tree', 'boom'],
            body:    'match',
            onEmpty: { skillId: 'getItemTree', args: {} },
          },
        },
      },
    },
  ],

  // Slice E.1 (2026-05-20) — first stoop web page via renderWeb.
  // V0.2 adopt (2026-05-21) — `dataSource` (Q7) declares the section's
  // data-fetch skill in the manifest, removing the client special-case.
  //
  // Stoop has 16 web pages today (per AUDIT-stoop-folio-surfaces.md).
  // E.1 surfaces ONE page — `mine.html` (my active posts + completions)
  // — to prove the substrate-shape.  The remaining 15 pages
  // (`index.html` prikbord, `chat.html`, `contacts.html`,
  // `create-group.html`, `group.html`, `profile.html`, `settings.html`,
  // `onboard.html`, `sign-in.html`, `auth-callback.html`, `push.html`,
  // `restore.html`, `welcome.html`, `metrics.html`, `privacy.html`)
  // stay hand-built and will land in follow-on E.x slices.  Same
  // discipline B.1 used for tasks-v0 (just `dag.html`).
  //
  // The `mine` view's `type: 'request'` is the broadest stoop itemType
  // (legacy V0 — every kind of post canonicalises through it).  The
  // section is conceptually "items I posted", which is a *predicate*
  // over items, not a type — `listMyRequests` filters by addedBy=from
  // (the calling actor) and spans ALL of the user's post types
  // (ask/offer/lend), not just `request`.
  //
  // V0.2 Q7 `dataSource` (locked 2026-05-21) declares this directly:
  // adapters call `fetchSectionItems(section, {callSkill})` which
  // honours `section.dataSource` and dispatches `listMyRequests({})`.
  // Removes the previous client special-case ("if section.id === 'mine'
  // then listMyRequests") — the manifest is now the source of truth.
  views: [
    {
      id:     'mine',
      title:  'My posts',
      type:   'request',     // broadest stoop itemType; see note above
      filter: { open: true },
      // V0.2 Q7 — explicit dataSource; `fetchSectionItems` will pick
      // this up and call `listMyRequests({})` instead of the rule-b
      // fallback `listOpen({type: 'request', open: true})`.
      dataSource: { skillId: 'listMyRequests' },
    },
  ],
};

export default stoopManifest;
