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
 * F-SP1-e — non-canonical verbs used here: `report`, `mute`, `cancel`,
 *           `set`, `assign`, `tree`.  Each is annotated inline.
 *           Canonical verb fallback options noted in DECIDE markers
 *           where applicable.
 *
 * Slash-grammar choice: bare names selected to **minimise collisions
 * with household's `/add /list /done /remove /help /task /tasks
 * /claim /register`**.  Stoop's commands are buurt-/peer-prefixed
 * (`/post`, `/buurt`, `/mine`, `/respond`, `/lend-assign`,
 * `/lend-return`, …).  DECIDE markers flag the 3 places owner
 * judgement is needed: (a) `/claim` collision (household has it for
 * tasks; stoop's analogue is `assignLend`), (b) `/profile` vs
 * `/skills` for `setMySkills`, (c) whether `/respond` or `/reply`
 * reads better.
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
          // DECIDE (owner): the slash match parser uses 'type+text'
          // bodies — emitted by renderSlash as
          // `/post ask buy a vacuum cleaner` → {intent:'ask',text:'...'}.
          // The verb tokens cover EN ('post', 'add', 'share') + NL
          // ('plaats', 'deel').  Two-arg bodies (intent+text) match
          // household's 'type+text' grammar — reusing that body shape.
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
          // DECIDE (owner): `/list` collides with household.listOpen.
          // Chose `/buurt` (Dutch for "neighbourhood") — natural stoop
          // brand vocab + zero collision.  Alternative: `/posts` (EN)
          // or `/prikbord` (the in-app term for the board).
          command: '/buurt',
          shape:   '/buurt [ask|offer|lend]',
          match: {
            verbs:   ['buurt', 'prikbord', 'posts', 'open'],
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
          // DECIDE (owner): household uses `/tasks` for its
          // listTasks; `/mine` is collision-free + reads naturally
          // ("show MY posts").  Alternative: `/mijn` (NL).
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
          // DECIDE (owner): `/respond` reads better in EN; `/reply`
          // is the chat-app-native verb.  Both are collision-free vs
          // household.  Pick one.  NL alternative: `/reageer`.
          // No `match` block: two-arg body (itemId + free-text) needs
          // the chat composer's picker UI — slash-command shell only.
          command: '/respond',
          shape:   '/respond <itemId> <message>',
        },
        ui: { control: 'button', label: 'Reageer' },
      },
    },
    {
      id:        'cancelRequest',
      verb:      'remove',  // canonical — cancelRequest removes the item.
      // No `appliesTo.type` — cancelRequest works across post types.
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Cancel an open request.' },
        slash: {
          // DECIDE (owner): household uses `/remove` for its own
          // hard-delete.  Stoop's `cancelRequest` is semantically
          // "withdraw my own post" — chose `/withdraw` (collision-
          // free).  Alternative: `/intrekken` (NL) or
          // `/cancel`.
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
          // `/done` is household's; chose `/lend-return` to make the
          // domain (lending) explicit + avoid the collision.
          // Alternative: `/returned` (EN) or `/teruggebracht` (NL).
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
      verb: 'report',  // F-SP1-e: non-canonical.  DECIDE (owner):
                       // could squeeze into `add` (it does add a
                       // report-type item), but `report` reads
                       // truer to intent.  Picked the truer verb.
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
                    // DECIDE (owner): could split into addMySkill +
                    // removeMySkill (both already exist as separate
                    // skills) and use canonical add/remove — but the
                    // audit asked for *setMySkills* specifically.
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
          // DECIDE (owner): pick `/skills` or `/profile`.  `/skills`
          // is more direct; `/profile` could later carry other
          // profile mutations (handle, displayName, avatar) as
          // sub-args.  No collision with household either way.
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

  // No `views` in the D.1 DRAFT.  Stoop's web has 16 pages; the
  // view-projection mapping is Slice E scope (renderWeb), not D.1.
  // Adding bare `views` here without grounding in a renderWeb consumer
  // would be presumptuous — the manifest stays projector-pure for
  // chat + slash until E.
};

export default stoopManifest;
