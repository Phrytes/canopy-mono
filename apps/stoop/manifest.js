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
 * `Project Files/projects/audit-stoop-folio-surfaces.md`'s "primary flows" recommendation.
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

    // ── Pod session ─────────────────────────────────────────────────
    // Q27 adoption (V0.8, 2026-05-21).  signOutOfPod disconnects the
    // OIDC session from the user's Solid pod.  No appliesTo — same
    // pattern as listMyRequests / mutePeer (session-scoped, not
    // per-item).
    {
      id:   'signOutOfPod',
      verb: 'remove',  // canonical — signing out is removal of session.
      params: [],
      surfaces: {
        chat:  { hint: 'Sign out of the current Solid pod session.  Mid-sync state may be dropped; the user can sign back in any time.' },
        slash: {
          // Collision-free with household's /add /list /done /remove
          // /help /task /tasks /claim /register.  Action verb at the
          // session scope.
          command: '/sign-out',
          match: {
            verbs:   ['sign-out', 'signout', 'uitloggen'],
            body:    'reject',  // no body — session-scoped, no args
            onEmpty: { skillId: 'signOutOfPod', args: {} },
          },
        },
        ui: {
          control: 'button',
          label:   'Uitloggen',
          confirm: {
            severity: 'warn',
            message:  'Uitloggen van je pod?  Lopende synchronisatie wordt afgebroken.',
          },
        },
      },
    },
  ],

  // Slice E.1 (2026-05-20) — first stoop web page via renderWeb.
  // V0.2 adopt (2026-05-21) — `dataSource` (Q7) declares the section's
  // data-fetch skill in the manifest, removing the client special-case.
  // Slice E.2 (2026-05-20) — second stoop web page via renderWeb:
  // `privacy.html` (closed-beta disclosure + data-location).  Picked
  // as the smallest read-only page (66 lines) — perfect fit for Q9
  // `view.readOnly: true`.  Contacts (417 lines, heavy mutations) and
  // profile (591 lines, form-heavy) defer to later E.x slices.
  // Slice E.3 (2026-05-20) — third stoop web page via renderWeb:
  // `settings.html` (per-device + per-actor preferences).  Picked over
  // profile/contacts as the next-smallest-after-privacy + a clean fit
  // for the existing V0.2 contract: `getSettings({})` is a param-free
  // dataSource skill (perfect Q7 fit) and the per-field mutations
  // (`updateSettings({patch})`, `setHopMode({global})`) live outside
  // the D.1 manifest as profile/plumbing skills (gap #4 territory).
  // Profile (591 lines — avatar resize / mnemonic / geocoding / backup,
  // many runtime-arg skills) and contacts (417 lines, heavy mutations)
  // defer to later E.x slices.
  //
  // Stoop has 16 web pages today (per Project Files/projects/audit-stoop-folio-surfaces.md).
  // After E.3, THREE pages are NavModel-driven (`mine.html`,
  // `privacy.html`, `settings.html`); 13 pages remain hand-built
  // (`index.html` prikbord, `chat.html`, `contacts.html`,
  // `create-group.html`, `group.html`, `profile.html`, `onboard.html`,
  // `sign-in.html`, `auth-callback.html`, `push.html`, `restore.html`,
  // `welcome.html`, `metrics.html`) and will land in follow-on E.x
  // slices.  Same discipline B.1 used for tasks-v0 (just `dag.html`).
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
  //
  // ──── E.2 — privacy view (V0.2 Q7 + Q9) ──────────────────────────
  //
  // `privacy.html` is a closed-beta disclosure page: it renders the
  // privacy-notice sections + a small key/value summary of where the
  // user's data lives.  TRUE read-only — no forms, no mutations —
  // a perfect Q9 `readOnly: true` proof-point.
  //
  // The view's `type: 'group-rules'` is a placeholder (closest
  // semantic — privacy is "rules of the system").  It does NOT
  // describe the data the section renders (which is text sections,
  // not group-rules items).  Same pattern mine.html uses with
  // `type: 'request'` — the type is a manifest-shape requirement
  // (validateView pins type ∈ manifest.itemTypes) more than a real
  // descriptor.
  //
  // `dataSource: { skillId: 'getDataLocation' }` declares ONE of the
  // two fetches privacy.html performs.  `getDataLocation` takes no
  // params — perfect fit for `fetchSectionItems`'s static `args ?? {}`
  // contract.  The second fetch (`getPrivacyNotice({lang})`) needs a
  // RUNTIME-derived param (browser language) — the V0.2 `dataSource`
  // contract is static args only, so the page keeps a direct
  // `callSkill('getPrivacyNotice', {lang})` for that fetch.  This is
  // a V0.2 substrate gap (logged below) — V0.3 may add a
  // `dataSource.argsFromContext` mechanism so language-aware skills
  // can be declared too.
  //
  // ──── V0.2 substrate gaps surfaced by E.2 ─────────────────────────
  //   3. `view.dataSource.args` is STATIC (frozen at manifest-author
  //      time).  Privacy needs a RUNTIME lang param for
  //      `getPrivacyNotice`; no mechanism today to declare "fetch
  //      with browser lang".  Worked around: privacy.html calls
  //      `getPrivacyNotice` directly while the section's declared
  //      dataSource targets `getDataLocation` (param-free).  Logged
  //      as a V0.3 follow-on — likely `dataSource.argsFromContext:
  //      {lang: '$lang'}` (or similar).
  //   4. `getPrivacyNotice` + `getDataLocation` are not manifest ops
  //      (they're read-only info-skills, not chat/slash-callable per
  //      Slice D.1's primary-flows discipline).  `dataSource.skillId`
  //      is a FREE STRING (validate.js doesn't constrain it to
  //      `operations[].id`), so this is permitted but worth flagging:
  //      a manifest-driven page can call skills outside the manifest's
  //      op set.  Forward-additive — V0.3 could add an opt-in cross-
  //      check.
  //
  // `readOnly: true` suppresses creative-verb auto-surface (Q10
  // affordances like `register` ops would otherwise appear here).
  // Wildcard itemActions (Q8 `cancelRequest`) still surface in this
  // section's `itemActions[]` — the page IGNORES them (privacy
  // renders text sections + key/value rows, not items).
  //
  // ──── E.3 — settings view (V0.2 Q7) ──────────────────────────────
  //
  // `settings.html` is a per-actor + per-device preferences page:
  // poll-interval (device), hop-relay (device), online-window (device),
  // broadcastable + defaultShareLocation (shared / per-actor).  Read
  // path = `getSettings({})` — perfect fit for `fetchSectionItems`'s
  // static-args contract.  Mutation paths are the per-field skills
  // (`updateSettings({patch})`, `setHopMode({global})`) — neither is
  // in the D.1 manifest (they're profile/plumbing skills, outside the
  // "primary chat/slash flows" set per D.1 line 14).  Same dataSource-
  // outside-manifest gap #4 territory as privacy.
  //
  // The `settings` view's `type: 'group-rules'` is a placeholder
  // (same pattern privacy uses) — `validateView` pins type ∈
  // manifest.itemTypes, but the section's actual data is a SINGLETON
  // record (settings object), not a list of items.  V0.3 substrate
  // signal: NavModel sections assume `Array<item>`; "singleton-record"
  // views (settings / profile / current-status) don't fit that shape
  // cleanly.  See V0.3 substrate signals below.
  //
  // No `readOnly: true` — the page mutates via the per-field handlers.
  // But because the per-field skills aren't manifest ops, NO creative-
  // verb affordances surface here regardless of the readOnly flag (Q10
  // only auto-surfaces ops with surfaces.ui or add/register verbs).
  // The wildcard `cancelRequest` itemAction surfaces in this section's
  // itemActions[] (Q8 rule) — the page IGNORES it (settings renders a
  // singleton record + per-field toggles, not items).
  //
  // ──── V0.2 substrate signals surfaced by E.3 ──────────────────────
  //   5. NavModel sections assume `Array<item>` data.  Settings is a
  //      SINGLETON record (one merged object: per-device + per-actor
  //      fields).  Today this works — `getSettings({})` returns
  //      `{settings: {...}}` and the page extracts `.settings`
  //      directly — but `fetchSectionItems`'s "items extraction"
  //      contract doesn't apply.  V0.3 candidate: `view.shape:
  //      'record'` flag, or a `dataSource.extract: 'settings'` path
  //      that the helper honours, so adapters can render record views
  //      without app-side special-casing.
  //   6. Mutation paths for record-shaped views are per-field skills
  //      (`updateSettings({patch})`, `setHopMode({global})`), not
  //      add/remove of items.  The current Q10 creative-verb model
  //      doesn't have a slot for "patch a settings field"; manifest
  //      ops would need a `verb: 'patch'` (non-canonical) or a new
  //      `view.fields[].opId` schema.  Deferred — current pages drive
  //      these directly until V0.3 has a real signal-rich consumer.
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
    {
      id:       'privacy',
      title:    'Privacy — wat je moet weten',
      type:     'group-rules',  // placeholder; see note above
      readOnly: true,           // V0.2 Q9 — read-only disclosure page
      // V0.3 Q15 (adopted 2026-05-21) — `getPrivacyNotice` is now
      // the explicit dataSource; lang arg substituted at call time
      // from the browser-supplied context (`$lang`).  Replaces the
      // V0.2 workaround that direct-called the skill.
      dataSource: {
        skillId:         'getPrivacyNotice',
        argsFromContext: { lang: '$lang' },
      },
    },
    {
      id:    'settings',
      title: 'Instellingen',
      type:  'group-rules',  // placeholder; settings is singleton-record,
                             // not a list of group-rules items.
      // V0.3 Q17 (adopted 2026-05-21) — shape: 'record' marks this
      // section as a singleton.  Adapter expects ONE record from
      // `getSettings`, not an array — matches the reality of the
      // settings page.
      shape:       'record',
      dataSource:  { skillId: 'getSettings' },
      // V0.4 Q18 (adopted 2026-05-22) — declare a representative
      // subset of editable fields with patch declarations.  The
      // settings.html UI is rich (localisation + per-field custom UX); the
      // manifest is the source-of-truth for WHICH fields exist +
      // their patch ops, but UI rendering stays hand-coded.
      //
      // V0.5 signal — wrapped-patch convention: `updateSettings`
      // takes `{patch: {<key>: <value>}}` (nested arg).  Q18's
      // `{opId, argName}` model is FLAT — for updateSettings-backed
      // fields, `argName` is the settings-key name (semantic);
      // adapter wraps in `{patch: {...}}` on dispatch.  A future
      // Q21 could add `patch.argWrapper: 'patch'` to make this
      // explicit in the substrate.
      fields: [
        {
          name:     'hopThrough',
          type:     'boolean',
          label:    'Hop-relay (globaal)',
          // V0.6 Q22 — localisation key for Dutch-first surfaces.  Consumer-
          // side resolution; falls back to `label` if unknown.
          labelKey: 'settings.hop_label',
          // setHopMode takes `{global: <bool>}` directly — Q18 fits.
          patch:    { opId: 'setHopMode', argName: 'global' },
        },
        {
          name:     'pollIntervalMs',
          type:     'enum',
          label:    'Hoe vaak het prikbord ververst',
          labelKey: 'settings.poll_interval_label',
          choices:  [2000, 10000, 60000, 300000],
          // Wrapped-patch convention: dispatch is
          // `updateSettings({patch: {pollIntervalMs: <value>}})`.
          // Adapter knows the convention; manifest stays semantic.
          patch:    { opId: 'updateSettings', argName: 'pollIntervalMs' },
        },
        {
          name:     'broadcastable',
          type:     'boolean',
          label:    'Auto-skill-match',
          labelKey: 'settings.broadcastable_label',
          patch:    { opId: 'updateSettings', argName: 'broadcastable' },
        },
        {
          name:     'defaultShareLocation',
          type:     'boolean',
          label:    'Standaard locatie delen met nieuwe contacten?',
          labelKey: 'settings.default_share_location_label',
          patch:    { opId: 'updateSettings', argName: 'defaultShareLocation' },
        },
        // Other settings.html fields (online-every, online-duration,
        // …) remain to be declared.  Pattern is the same; not
        // surfacing all 8+ in this commit to keep the V0.4-adopt
        // proof small.  Forward-additive extensions land per-field.
      ],
    },

    // ──── E.4 — profile view (V0.4-adopt) ─────────────────────────────
    //
    // `profile.html` is stoop's account/identity surface: handle +
    // displayName + holiday-mode + skills picker + location + recovery
    // + my-pods.  591 lines, FIVE sections, heavy custom UX (avatar
    // resize, mnemonic reveal-once, geocoding preview).  Like
    // settings.html, auto-rendering would regress UX — the page keeps
    // its rich hand-coded layout.
    //
    // Manifest's job here = source-of-truth for WHICH editable identity
    // fields exist + their patch ops.  Mirrors settings's V0.4-adopt
    // pattern (commit 9e7003b): record-shape view + fields[] with
    // per-field {opId, argName}.  Page rendering stays unchanged.
    //
    // The `profile` view's `type: 'group-rules'` is a placeholder
    // (same pattern privacy + settings use).  `validateView` pins
    // type ∈ manifest.itemTypes, but the section's actual data is a
    // SINGLETON record (the calling actor's MemberMap entry), not a
    // list of group-rules items.  Adding 'profile' as a new itemType
    // would change the frozen 8-type set (per manifest-validation test
    // line 92-101); reusing the placeholder keeps the diff minimal +
    // matches the established convention for record-shape views.
    //
    // `dataSource: { skillId: 'getMyProfile' }` — `getMyProfile()`
    // returns `{entry, renderForCurrentGroup}`; the page already
    // extracts `.entry` (line 208 of profile.html: `r?.entry?.handle`).
    // Same "page extracts the record key from the envelope" pattern
    // settings uses with `.settings`.
    //
    // Fields chosen: 3 representative identity fields, all FLAT
    // dispatch (no argWrapper needed — getMyProfile-backed mutations
    // are all single-arg skills, not wrapped-patch like
    // updateSettings).  Avatar, mnemonic, backup, location, skills
    // picker, and my-pods sections remain hand-coded (see V0.5+ signals
    // below — none of them fit Q18 fields[] cleanly).
    //
    // ──── V0.5+ substrate signals surfaced by E.4 ─────────────────────
    //   7. `holidayMode` lives on the MemberMap entry (`entry.holidayMode`)
    //      — readable via `getMyProfile`.  But the dedicated reader
    //      `getHolidayMode()` returns `{holidayMode}` directly (separate
    //      skill).  Q18 today assumes ONE dataSource skill per view;
    //      no slot for "field-specific read skill" alongside the
    //      record-level read.  Adapter has to either trust the record
    //      envelope or know to re-read per-field.  Out of scope here;
    //      page already reads holiday-mode separately.
    //   8. `avatarUrl` is bytes (data-URL after resize), not a primitive
    //      that fits Q18's `type: 'boolean' | 'enum' | string`.  The
    //      avatar input is a file-picker with client-side resize
    //      (`fileToResizedDataUrl`) + dispatch to `setMyAvatarUrl({url})`
    //      and clear via `clearMyAvatar({})`.  Q18 has no `'file'` or
    //      `'image'` field type + no notion of "client-side transform
    //      before dispatch".  Stays hand-coded.
    //   9. `skills` section is a list-shape WITHIN a record-shape view
    //      (the user has many skills, each editable in 3 dimensions:
    //      checked/status/freeTags).  Q17 today is a flat `'record'`
    //      vs `'list'` choice per view — no nested shape.  Splitting
    //      profile into "profile-identity" (record) + "profile-skills"
    //      (list) is possible but would change the page's mental model;
    //      keeping it ONE view for now.
    //  10. `location` is also list-/wizard-shape (search → preview →
    //      confirm) with an intermediate geocode skill call.  No Q18
    //      slot for "multi-step mutation".  Stays hand-coded.
    //  11. `mnemonic` + `encryptedBackup` are SECURITY-sensitive
    //      one-shot reveals (mnemonic shows once) + dangerous-action
    //      flows (backup needs a passphrase).  Q18 has no notion of
    //      "consent gate" or "one-shot read".  Stays hand-coded.
    //
    // None of these block E.4: the V0.4-adopt proof-point is the
    // record + 3 flat fields.  The signals are forward-additive
    // substrate work for later V0.x.
    {
      id:    'profile',
      title: 'Mijn profiel',
      type:  'group-rules',  // placeholder; profile is singleton-record,
                             // not a list of group-rules items.
      // V0.3 Q17 — shape: 'record' marks this section as a singleton.
      // `getMyProfile` returns `{entry, renderForCurrentGroup}`; the
      // page extracts `.entry` (mirrors settings's `.settings` envelope
      // extraction).
      shape:       'record',
      dataSource:  { skillId: 'getMyProfile' },
      // V0.4 Q18 (adopted 2026-05-22) — declare 3 representative
      // identity fields with patch declarations.  All FLAT dispatch
      // (no Q21 argWrapper) — getMyProfile-backed mutations are
      // single-arg skills, not wrapped-patch like updateSettings.
      fields: [
        {
          name:     'handle',
          type:     'string',
          label:    'Handle (kleine letters, 3–32 tekens)',
          // V0.6 Q22 — localisation key for Dutch-first surfaces.
          labelKey: 'profile.handle_label',
          // setMyHandle takes `{handle: <string>}` directly — flat fit.
          patch:    { opId: 'setMyHandle', argName: 'handle' },
        },
        {
          name:     'displayName',
          type:     'string',
          label:    'Echte / weergavenaam (optioneel)',
          labelKey: 'profile.display_name_label',
          // setMyDisplayName takes `{displayName: <string>}` directly.
          patch:    { opId: 'setMyDisplayName', argName: 'displayName' },
        },
        {
          name:     'holidayMode',
          type:     'boolean',
          label:    'Vakantiemodus (skill-match overslaat me)',
          labelKey: 'profile.holiday_label',
          // V0.7 Q25 — `holidayMode` is reachable BOTH via the record's
          // dataSource (`getMyProfile` returns it under `.entry.
          // holidayMode`) AND via a dedicated `getHolidayMode` skill.
          // Adapters that want a single-field refresh (e.g. after the
          // user toggles it elsewhere) call this skill instead of
          // re-fetching the whole profile.  E.4 was the originating
          // signal; V0.7 closed the substrate gap.
          readSkill: { skillId: 'getHolidayMode' },
          // setHolidayMode takes `{on: <bool>}` directly — argName
          // is the *skill arg* (`on`), not the field-on-entry name
          // (`holidayMode`).  Same semantic split settings's
          // hopThrough → setHopMode({global}) uses.
          patch:    { opId: 'setHolidayMode', argName: 'on' },
        },
        // Other profile.html fields (avatar, skills[], location,
        // mnemonic, encryptedBackup, my-pods) stay hand-coded — see
        // V0.5+ signals (7–11) above.  Forward-additive: any of them
        // can land per-field when the substrate has a fit.
      ],
    },
  ],
};

export default stoopManifest;
