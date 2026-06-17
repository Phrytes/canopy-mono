/**
 * canopy-chat — slash-routing manifests for tasks-v0 / stoop / folio.
 *
 * NOTE: the "mock" prefix is HISTORICAL.  Post slices 1 / 2b / 4 of the
 * integration plan (2026-05-23), the SKILL HANDLERS for these three
 * apps are REAL — composed in-process by `realAgent.js` via each app's
 * `src/browser.js` factory.  These manifests are the chat-shell's
 * slash-command DECLARATIONS for those real agents (the real per-app
 * manifests in `apps/<app>/manifest.js` deliberately omit
 * `surfaces.slash` — slash is a chat-shell concern).
 *
 * Why split out from `mockAgent.js` (2026-05-23, slice-4 polish):
 *   - Three manifests dominated the file (~365 of 612 lines).
 *   - The real mock LIVES in `mockAgent.js` — household-only
 *     (`mockHouseholdManifest` + `createMockHouseholdAgent` are still
 *     used as a lightweight fixture in `mockAgent.test.js`).
 *   - Co-locating the three slash-binding manifests here makes it
 *     obvious what they actually do + makes future renames easier.
 *
 * If you're adding a new chat slash command for tasks/stoop/folio,
 * declare it here.  If you're adding the IMPLEMENTATION, register a
 * handler in the relevant `apps/<app>/src/browser.js`.
 *
 * Future rename candidates (not done in this slice): `mockTasksManifest`
 * → `tasksSlashManifest`, etc.  Deferred — names are load-bearing
 * across imports + the rename adds churn without behavior change.
 */

/**
 * tasks-v0 manifest — Part G dissolve (2026-06-17).
 *
 * This file's former `mockTasksManifest` literal (the chat-shell slash/
 * gate surface for the REAL tasks-v0 crew skills) has been FOLDED INTO
 * the real `apps/tasks-v0/manifest.js`, which is now the ONE tasks
 * manifest (same move folio made — see the `mockFolioManifest`
 * re-export below).  We re-export it under the historical name so every
 * importer (circleGate.js, web/main.js's manifestsByOrigin, journeys
 * tests, navModel) keeps working unchanged.
 *
 * The merged manifest's `.app` is now `'tasks'` (NOT `'tasks-v0'`): the
 * catalog (`manifestMerge.js`) keys ops by `m.app`, so dispatch now
 * routes the tasks crew under appOrigin `'tasks'` (realAgent.js's
 * callSkill matches `'tasks'`).  The vocab adapter bridges
 * (rejectTask reason→note, submitTask note-default) are removed — the
 * manifest declares the real `note` param directly.  The Q29 claimTask
 * embed decl lives IN the real manifest now (no post-hoc patch here).
 */
import { tasksManifest } from '../../../../tasks-v0/manifest.js';

export const mockTasksManifest = tasksManifest;

/**
 * Mock stoop manifest (v0.4 cross-app demo).  Three browser-doable ops
 * with a slash-name collision-induction (`/post` is stoop-only, `/done`
 * collides with household for v0.4 prefix-on-collision demonstration —
 * not actually colliding here since opIds differ, but shows multi-app
 * UX in /help).
 */
export const mockStoopManifest = {
  app:        'stoop',
  // 2026-05-27 slash audit close-out — `lend` + `report` added for the
  // new audit-close-out ops (`assignLend` appliesTo:'lend', `reportPost`
  // appliesTo:'report').  Mirrors the real stoopManifest's itemTypes
  // (subset — the mock only needs the types its declared ops reference).
  itemTypes:  ['post', 'contact', 'member', 'lend', 'report'],
  operations: [
    {
      id:    'listFeed', verb: 'list', params: [],
      surfaces: {
        slash: { command: '/feed' },
        chat:  { reply: 'list', hint: "list your buurt's feed" },
      },
    },
    {
      id:    'postRequest', verb: 'add',
      // C6 (real-device 2026-05-27) — accept --kind=ask|borrow|share|report|event
      // alongside the body text.  Substrate already understands `kind`
      // (see apps/stoop/src/skills/index.js postRequest skill — it
      // routes to canonicalDraft via intentToCanonicalDraft).  Prior
      // shape was `body: 'match'` so any `--kind=ask` ended up glued
      // into the post text instead of becoming a flag.
      params: [
        { name: 'text', kind: 'string', required: true },
        { name: 'kind', kind: 'string', required: false, enum: ['ask', 'borrow', 'share', 'report', 'event'] },
      ],
      surfaces: {
        // Part C gate — "post/ask/borrow X" → postRequest{text}. Bare 'share'/'deel' belong to
        // folio.shareFolder (collision); the post `kind` flag stays slash/LLM-only.
        slash: { command: '/post', body: 'flags',
          match: { verbs: ['post', 'ask', 'borrow', 'vraag', 'plaats', 'leen', ['bied', 'aan']], body: 'text-only', dropTrailing: ['to', 'aan', 'op', 'in', 'voor'] } },
        chat:  {
          reply: 'text', hint: 'post a skill-request to your buurt',
          followUps: [
            // Q31 demo — same-app follow-up: after posting, suggest viewing.
            { opId: 'listFeed' },
          ],
        },
      },
    },
    /**
     * v0.7.cc — `/stoop-profile` — stoop's per-buurt profile (handle +
     * displayName + reveals).  Mirrors DEMO.md §2.
     */
    {
      id:    'getStoopProfile', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/stoop-profile' },
        chat:  { reply: 'record', hint: 'show your stoop profile (handle + reveals)' },
      },
    },
    /**
     * v0.7.cc — `/reveal <peer> <on|off>` — flip the local Reveal
     * setting for a peer (DEMO.md §2 connection accept).  Bilateral —
     * the peer must also flip on their side for full reveal.
     */
    {
      id:    'revealPeer', verb: 'add',
      params: [
        { name: 'peer',   kind: 'string', required: true },
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
      ],
      surfaces: {
        slash: { command: '/reveal', body: 'flags' },
        chat:  { reply: 'text', hint: 'reveal (or hide) a peer\'s real name' },
      },
    },
    /**
     * #179 (2026-05-23) — `respondToItem` — offer help on an open
     * stoop post (the "Help with" / "Ik help" UX from the design doc).
     * Real skill at apps/stoop/src/skills/index.js:1987.  Opens a
     * private DM thread between requester + responder; first body
     * becomes the thread's first message.
     *
     * No slash command — the natural surface is the [Help with]
     * button on each post row in /feed.  Typing post-id is friction
     * (per the existing-slash-surface audit, /help-with → R→B).
     */
    {
      id:    'respondToItem', verb: 'claim',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
        // 2026-05-24 — body is required by the substrate; mark it
        // required here so [Help with] click triggers form-elicitation
        // ("what help are you offering?") instead of dispatching with
        // missing arg + getting 'body required' from the substrate.
        { name: 'body',   kind: 'string', required: true },
      ],
      surfaces: {
        // Part C gate — "help with X" / "ik help X" → respondToItem{itemId}; PARTIAL gate (binds
        // itemId by label; `body` "what help?" is then form-elicited as today).
        slash: { match: { verbs: [['help', 'with'], ['respond', 'to'], 'offer', ['ik', 'help'], ['help', 'met'], ['reageer', 'op'], ['bied', 'hulp']], body: 'match', arg: 'itemId' } },
        chat: { reply: 'text', hint: 'offer help on a request' },
        // appliesTo-gated row button on /feed posts.  Click → form
        // prompts for body, then dispatches.  Future Slice: spawn a
        // DM thread instead of the inline form (per post>reply>chat
        // flow noted 2026-05-24).
        ui:   { control: 'button', label: 'Help with' },
      },
    },
    /**
     * #179 (2026-05-23) — `markReturned` — close a "lend" post after
     * the borrower returns the item.  Real skill at
     * apps/stoop/src/skills/index.js:843.  Author-only.
     *
     * 2026-05-27 audit close-out — `/lend-return` slash declaration
     * mirrored from `apps/stoop/manifest.js` (real D.1 stoop).  Body
     * `match` with EN/NL verbs binds `_match` → first required param
     * (`itemId`); the realAgent adapter aliases `itemId → requestId`
     * for the substrate skill.
     */
    {
      id:    'markReturned', verb: 'complete',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
      ],
      surfaces: {
        chat: { reply: 'text', hint: 'Mark a lend item as returned; cancels its return reminder.' },
        // Part C — FIX: bind the body to `itemId` (was the default `match`, which dropped the label).
        slash: {
          command: '/lend-return',
          match: {
            verbs:   ['returned', 'teruggebracht', 'terug', ['mark', 'returned']],
            body:    'match',
            arg:     'itemId',
            onEmpty: { skillId: 'markReturned', args: {} },
          },
        },
        ui:   { control: 'button', label: 'Teruggebracht' },
      },
    },
    /**
     * Slice 6d (2026-05-24) — per-row [DM] button on contact + member
     * rows.  No substrate dispatch — onButtonTap intercepts and routes
     * to ensureDmThread.  Alias-as-button-only of canopy-chat's
     * `startDm` op (so the validator's appliesTo gate stays in stoop's
     * manifest where 'contact'/'member' itemTypes are declared).
     */
    {
      id:    'startDm',
      verb:  'add',
      appliesTo: { type: ['contact', 'member'] },
      params: [{ name: 'webid', kind: 'string', required: true }],
      surfaces: {
        chat: { reply: 'text', hint: 'open a DM with this peer' },
        ui:   { control: 'button', label: 'DM' },
      },
    },
    /**
     * #185 (A6, 2026-05-23) — `/holiday-mode <on|off>` — toggle the
     * calling actor's holiday-mode flag (Phase 23.4 in stoop).  When
     * on: notifications suppressed, skills marked unavailable, no
     * skill-match hints.  Allows a temporary pause without leaving
     * the buurt.  Real skills:
     *   - setHolidayMode (apps/stoop/src/skills/index.js:1043)
     *   - getHolidayMode (apps/stoop/src/skills/index.js:1058)
     * Bare `/holiday-mode` reads current state.
     */
    {
      id:    'setHolidayMode', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/holiday-mode' },
        chat:  { reply: 'text', hint: 'toggle holiday mode on/off' },
      },
    },
    {
      id:    'getHolidayMode', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/holiday-status' },
        chat:  { reply: 'record', hint: 'show current holiday-mode state' },
      },
    },
    /**
     * #186 (A4, 2026-05-23) — ContactBook surface.  Stoop's contact
     * graph (apps/stoop/src/lib/ContactBook.js + skills 2701-2783) had
     * zero chat-shell affordance before today.  Wired:
     *   /contacts [--min-trust=known|trusted] [--tag=X]    → list
     *   /add-contact <webid> [--name=X]                    → add
     *   /remove-contact <webid>                            → remove
     *   /contact-trust <webid> <known|trusted|none>        → set trust
     * Chat-shell enums are English (EN-first locale rule).  The
     * underlying stoop skill still persists Dutch labels ("bekend",
     * "vertrouwd") — the realAgent.js adapter translates at the
     * boundary.  Locale entries in en/nl.json:contacts.trust render
     * the labels per user language.  In-chat row buttons planned for
     * the contacts list (R→B replacements for /mute, /unmute, /reveal
     * per existing-slash-surface-audit) once the contact-card panel
     * lands.
     */
    {
      id:    'listContacts', verb: 'list',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'min-trust', kind: 'enum', of: ['known', 'trusted'], required: false },
        { name: 'tag',       kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/contacts', body: 'flags' },
        chat:  { reply: 'list', hint: 'list your contacts' },
      },
    },
    {
      id:    'addContact', verb: 'add',
      params: [
        { name: 'webid', kind: 'webid',  required: true },
        { name: 'name',  kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/add-contact', body: 'flags' },
        chat:  { reply: 'text', hint: 'add a 1:1 contact' },
      },
    },
    {
      id:    'removeContact', verb: 'remove',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
      ],
      surfaces: {
        slash: { command: '/remove-contact' },
        chat:  { reply: 'text', hint: 'remove a contact' },
        ui:    { control: 'button', label: 'Remove' },
      },
    },
    {
      id:    'setContactTrust', verb: 'submit',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
        { name: 'level', kind: 'enum', of: ['known', 'trusted', 'none'], required: true },
      ],
      surfaces: {
        slash: { command: '/contact-trust', body: 'flags' },
        chat:  { reply: 'text', hint: 'set a contact\'s trust level' },
      },
    },
    /**
     * #198 (C3-C6, 2026-05-24) — remaining Cluster C wizards.  All
     * use #180 customRenderer; per-wizard renderer files under
     * src/web/wizards/.
     */
    {
      id:    'restoreFromMnemonicWizard',
      verb:  'submit',
      params: [],
      surfaces: {
        slash: { command: '/restore-from-mnemonic' },
        chat:  { hint: 'recover from a saved mnemonic phrase (DESTRUCTIVE)' },
        page:  { kind: 'side-panel', title: 'Restore identity' },
      },
    },
    {
      id:    'conflictDisputeWizard',
      verb:  'add',
      // #200 — per-bubble action on stoop posts.  Slash kept for
      // general-dispute (no postId) + LLM tool-call surface.
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'postId', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/dispute', body: 'flags' },
        chat:  { hint: 'raise a conflict-resolution dispute in your buurt' },
        page:  { kind: 'side-panel', title: 'Raise a dispute' },
        ui:    { control: 'button', label: 'Dispute' },
      },
    },
    {
      id:    'postAudienceWizard',
      verb:  'add',
      params: [
        { name: 'text', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/post-audience', body: 'flags' },
        chat:  { hint: 'post with audience targeting (trust + tags + distance)' },
        page:  { kind: 'side-panel', title: 'Post with audience' },
      },
    },
    {
      id:    'encryptedBackupWizard',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/encrypted-backup' },
        chat:  { hint: 'download a passphrase-encrypted snapshot of your data' },
        page:  { kind: 'side-panel', title: 'Encrypted backup' },
      },
    },
    /**
     * #197 (C1, 2026-05-24) — biggest Cluster C wizard.  Surfaces
     * createGroupV2 across 5 sections (identity, governance, rules,
     * tech, review).  Membership-code reveal on success — show ONCE,
     * user must copy or it's lost (per stoop design).
     */
    {
      id:    'createGroupWizard',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/create-group' },
        chat:  { hint: 'create a new buurt: 5-step wizard' },
        page:  { kind: 'side-panel', title: 'Create buurt' },
      },
    },
    /**
     * #196 (C2, 2026-05-24) — first Cluster C wizard.  Opens a 3-step
     * panel: rules disclosure → privacy notice → handle pick → submits
     * chained redeemInviteWithGate + setMyHandle + redeemInvite.
     * Slash arg: invite URL ('stoop-invite://...').
     */
    {
      id:    'joinGroupWizard',
      verb:  'add',
      params: [
        { name: 'invite', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/join-group' },
        chat:  { hint: 'join a buurt: open the 3-step rules-gate wizard' },
        page:  { kind: 'side-panel', title: 'Join buurt' },
      },
    },
    /**
     * #189 (B1+B2, 2026-05-23) — buurt/group surface.  V0: single-
     * buurt info per agent instance (the chat-shell currently runs
     * one stoop agent in one buurt; true multi-buurt requires
     * multi-agent topology — separate slice).  Surfaces existing
     * stoop skills:
     *   /groups        → current buurt info + member count
     *   /group-members → members of current buurt
     *   /group-rules   → latest rules.md for current buurt
     *   /leave-group   → with Q27 confirm
     */
    {
      id:    'getCurrentGroup', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/groups' },
        chat:  { reply: 'record', hint: 'show your current buurt' },
      },
    },
    {
      id:    'listGroupMembers', verb: 'list',
      appliesTo: { type: 'member' },
      params: [],
      surfaces: {
        slash: { command: '/group-members' },
        chat:  { reply: 'list', hint: 'list members of your buurt' },
      },
    },
    {
      id:    'getGroupRules', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/group-rules' },
        chat:  { reply: 'record', hint: 'show your buurt\'s rules' },
      },
    },
    {
      id:    'leaveGroup', verb: 'remove',
      params: [
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/leave-group', body: 'flags' },
        chat:  { reply: 'text', hint: 'leave your buurt (irreversible — asks to confirm)' },
      },
    },
    /**
     * #188 (A8, 2026-05-23) — share-my-contact via QR payload.
     * Real skill at apps/stoop/src/skills/index.js:2247.  V0 returns
     * the stoop-contact:// URL; user pastes into any QR generator.
     * Canvas-rendered QR image is a follow-up.
     */
    {
      id:    'getContactShareQr', verb: 'list',
      params: [
        { name: 'trust', kind: 'enum', of: ['known', 'trusted'], required: false },
      ],
      surfaces: {
        slash: { command: '/share-my-contact', body: 'flags' },
        chat:  { reply: 'record', hint: 'show your contact-share payload (paste into a QR generator)' },
      },
    },
    /* ─────── 2026-05-27 slash-audit close-out (7 long-tail ops) ───────
     * The seven ops below mirror their `apps/stoop/manifest.js` (real
     * D.1 stoop) shape — verbs, body, params, hints, appliesTo.  No
     * substrate handlers needed: declarations alone make
     * `bundle.callSkill('stoop', '<id>', args)` route past the catalog
     * check for chat-shell-only demos.  Real skill execution always
     * goes through realAgent.js (which composes the live stoop agent). */
    /**
     * `/lend-assign <itemId> <borrower-webid>` — two-arg positional
     * slash → ALWAYS needsForm (no `match` block).  Shell-only by
     * design: the consumer's composer surfaces the form/picker UI
     * because slash bodies are line-oriented and can't bind two
     * positional args.  Same shape household.markComplete uses for
     * row-button-only ops.
     */
    {
      id:        'assignLend', verb: 'reassign',
      appliesTo: { type: 'lend' },
      params: [
        { name: 'itemId',        kind: 'string', required: true },
        { name: 'borrowerWebid', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: 'Assign a lent item to a borrower without closing it.' },
        slash: {
          command: '/lend-assign',
          shape:   '/lend-assign <itemId> <borrower-webid>',
        },
      },
    },
    {
      id:        'setMySkills', verb: 'set',
      params: [
        { name: 'skills', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: "Replace the calling actor's skills array." },
        slash: {
          command: '/skills',
          shape:   '/skills <json-array-of-skill-entries>',
        },
      },
    },
    {
      id:    'getItemTree', verb: 'tree',
      params: [
        { name: 'itemId', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: "Walk an item's embeds/deps tree, materialising cross-pod refs (Phase 3.3c decentralised read path)." },
        // Part C — removed the gate `match` (a debug tree-walk, not an NL user command; the
        // body:'match' also dropped the label since the param is itemId). Literal /tree stays.
        slash: { command: '/tree' },
      },
    },
    /**
     * Q27 confirm-gated session op — `surfaces.ui.confirm.severity:
     * 'warn'` triggers a `needsConfirm` envelope from resolveDispatch
     * BEFORE the substrate runs.  Same pattern household.removeChore
     * uses.
     */
    {
      id:    'signOutOfPod', verb: 'remove',
      params: [],
      surfaces: {
        chat:  { hint: 'Sign out of the current Solid pod session.  Mid-sync state may be dropped; the user can sign back in any time.' },
        // Part C — removed the gate `match`: body:'reject' is NOT a valid renderSlash body kind
        // (would throw), and sign-out is a session op, not an NL one-liner. Literal /sign-out + the
        // confirm-gated button stay.
        slash: { command: '/sign-out' },
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
    {
      id:        'reportPost', verb: 'report',
      appliesTo: { type: 'report' },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
        { name: 'reason', kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'File a report on another item; visible to admins of the group.' },
        // Part C — FIX: bind the body to `itemId` (was the default `match`); `reason` stays optional.
        slash: {
          command: '/report',
          match: {
            verbs:   ['report', 'rapporteer', 'flag'],
            body:    'match',
            arg:     'itemId',
            onEmpty: { skillId: 'reportPost', args: {} },
          },
        },
        ui: { control: 'button', label: 'Rapporteer' },
      },
    },
    {
      id:    'listOpen', verb: 'list',
      params: [
        { name: 'intent', kind: 'enum', of: ['ask', 'offer', 'lend'] },
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'List open requests; optional `skill` + `intent` filters.' },
        // Part C — removed the gate `match`: body:'type-only' mapped against a nonexistent `type`
        // param (this op's enum is `intent`) with no typeAliases declared — mis-wired. List op,
        // slash/screen only. Literal /bulletin stays.
        slash: {
          command: '/bulletin',
          shape:   '/bulletin [ask|offer|lend]',
        },
      },
    },
  ],
  views: [
    { id: 'feed',     title: 'Feed',     type: 'post' },
    { id: 'contacts', title: 'Contacts', type: 'contact' },
  ],
};

/**
 * Folio manifest — Part G dissolve (2026-06-11).
 *
 * This file's former `mockFolioManifest` (the chat-shell slash/gate
 * surface for the REAL folio skills) has been FOLDED INTO the real
 * `apps/folio/manifest.js`, which is now the ONE folio manifest (the
 * calendar-style target).  We re-export it under the historical name so
 * every importer (circleGate.js, composeManifests, navModel) keeps
 * working unchanged.
 *
 * The merged manifest carries the chat-shell ops (readNote, shareFolder,
 * syncOnce, watchStart, getFileSnapshot, downloadFile, saveToMyPod,
 * folioStatus, listFiles) WITH their slash/chat/gate surfaces, plus
 * folio's own destructive ops (deleteFromPod, deleteLocally, forceRepush)
 * which DELIBERATELY carry no `surfaces.chat` so the circle LLM can never
 * propose deleting a shared file.  The Q30/Q33/Q29 decls below
 * (brief / search / embed) still attach to readNote / shareFolder.
 */
import { folioManifest } from '../../../../folio/manifest.js';

export const mockFolioManifest = folioManifest;

// v0.7 — Q30 brief-summary decls on each app's list op.  /brief fans
// across these to produce the morning brief.  Household's Q30 decl
// lives in `mockAgent.js`.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 30, label: 'Buurt' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 20, label: 'Folio' };

// v0.7.5 — Q33 search decls.  Each app declares a text-search skill
// so /find can fan across them.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.search = { searchSkill: 'searchPosts' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.search = { searchSkill: 'searchFiles' };

// v0.7.13 — Q29 cardSnapshotSkill on shareFolder (the user-visible
// 'share a file' moment).  /embed-file --path=<existing> looks up
// the file via getFileSnapshot before building the embed envelope.
mockFolioManifest.operations.find((o) => o.id === 'shareFolder')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getFileSnapshot' };
