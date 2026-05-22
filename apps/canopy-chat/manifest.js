/**
 * canopy-chat — own manifest.
 *
 * The chat shell composes OTHER apps' manifests at runtime via
 * `manifestMerge`.  Its own manifest declares ops the shell itself
 * owns (thread management, mute, etc.) — populated in phase v0.2+.
 * v0.1 ships a minimum manifest so the validator passes.
 *
 * Per `Project Files/canopy-chat/coding-plan.md` § Phase v0.1.
 */

export const canopyChatManifest = {
  app:        'canopy-chat',
  itemTypes:  ['chat-thread', 'chat-message'],
  operations: [
    /**
     * `/help` — list every command available in the merged catalog.
     *
     * Chat-shell built-in (handled locally by the web entry; not
     * routed to any app agent).  The handler lives in
     * `src/web/localBuiltins.js` and introspects the merged catalog
     * to produce its reply, so it picks up new apps automatically.
     */
    {
      id:    'help',
      verb:  'help',
      params: [],
      surfaces: {
        slash: { command: '/help' },
        chat:  {
          reply: 'text',
          hint:  'list every available command',
        },
      },
    },

    /**
     * `/newthread <name>` — create a new chat thread.
     *
     * Default filter is wildcard ({}); the user can refine via the
     * sidebar's Configure (rename / filter / permissions) — v0.3+.
     * After creation, the new thread becomes active.
     */
    {
      id:    'newthread',
      verb:  'add',
      params: [
        { name: 'name', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/newthread' },
        chat:  {
          reply: 'text',
          hint:  'create a new chat thread',
        },
      },
    },

    /**
     * `/threads` — list every chat thread in the workspace.
     */
    {
      id:    'threads',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/threads' },
        chat:  {
          reply: 'text',
          hint:  'list every chat thread',
        },
      },
    },

    /**
     * `/embed <itemId> [--claim]` — v0.5 J7 demo.  Posts an embed-
     * card to the active thread using the snapshot returned by the
     * item's `cardSnapshotSkill` (Q29).  `--claim` is the sender-
     * claim-on-behalf path (per OQ-5): the embed is issued AND
     * claimed by the sender atomically.  Without `--claim`, the
     * receiver claims via the [Claim] button on the rendered card.
     */
    {
      id:    'embed',
      verb:  'add',
      params: [
        { name: 'itemId', kind: 'string',  required: true  },
        { name: 'claim',  kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/embed', body: 'flags' },
        chat:  {
          reply: 'embed-card',
          hint:  'embed an item card; --claim for claim-on-behalf',
        },
      },
    },

    /**
     * `/embed-file` — file-card.  v0.7 catch-up: now an actual
     * file-attach UX with real params instead of a stub that
     * synthesised metadata from a path.  Real folio integration
     * (calling folio.getFileSnapshot) lands when folio's Q29 ships.
     * Until then, /embed-file CREATES a file reference card from
     * the supplied params.
     */
    {
      id:    'embed-file',
      verb:  'add',
      params: [
        { name: 'name',  kind: 'string', required: true  },
        { name: 'mime',  kind: 'string', required: false },
        { name: 'path',  kind: 'string', required: false },
        { name: 'share', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/embed-file', body: 'flags' },
        chat:  { reply: 'embed-card', hint: 'embed a file card; --share=anne to send' },
      },
    },

    /**
     * `/embed-time` — appointment maker.  v0.7 catch-up: user F:
     * "calendar lookup as an appointment maker (can be shared with
     * others too)".  Until a real calendar app exists, /embed-time
     * CREATES an appointment card client-side with the supplied
     * title + when + duration + location, optionally shared with a
     * peer.  Future: when a calendar app exists, /embed-time accepts
     * either an existing eventId (lookup) OR creation params.
     */
    {
      id:    'embed-time',
      verb:  'add',
      params: [
        { name: 'title',    kind: 'string', required: true  },
        { name: 'when',     kind: 'date',   required: true  },
        { name: 'duration', kind: 'string', required: false },
        { name: 'location', kind: 'string', required: false },
        { name: 'share',    kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/embed-time', body: 'flags' },
        chat:  { reply: 'embed-card', hint: 'create an appointment; --share=anne to send' },
      },
    },

    /**
     * `/logs [--since=...] [--app=X] [--type=Y] [--mute=app:type]` —
     * v0.7.1 D.1 network-events log.  Lists every event the
     * EventRouter delivered in the last 14 days (OQ-7.B retention),
     * with optional filter flags.  `--mute=app:type` adds a kind to
     * the mute set + reports.  Without args, shows the 20 most-recent
     * events.
     */
    {
      id:    'logs',
      verb:  'list',
      params: [
        { name: 'app',   kind: 'string', required: false },
        { name: 'type',  kind: 'string', required: false },
        { name: 'actor', kind: 'string', required: false },
        { name: 'since', kind: 'string', required: false },
        { name: 'mute',  kind: 'string', required: false },
        { name: 'limit', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/logs', body: 'flags' },
        chat:  { reply: 'list', hint: 'recent events; --app= / --type= / --mute=app:type' },
      },
    },

    /**
     * `/brief` — v0.7 morning-brief aggregator.  Fans across all
     * enabled apps that declare `surfaces.chat.brief.summarySkill`
     * (Q30); aggregates replies into a single brief-shape card.
     * Cache TTL: 60s per OQ-7.A (use --refresh / click [Refresh] to
     * bypass).
     */
    {
      id:    'brief',
      verb:  'list',
      params: [
        { name: 'refresh', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/brief', body: 'flags' },
        chat:  { reply: 'brief', hint: 'morning summary across all apps' },
      },
    },

    /**
     * `/signin` — v0.6.2 external-flow demo (J6 framework).
     *
     * Opens a mock external page that simulates an OIDC sign-in
     * round-trip; the callback wakes this thread with a fake
     * webid.  Real Inrupt OIDC binding lands when @canopy/oidc-session
     * is composed into the chat-shell (v0.7+).
     */
    {
      id:    'signin',
      verb:  'add',
      params: [
        { name: 'issuer', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/signin' },
        chat:  { reply: 'text', hint: 'open the (mock) sign-in flow' },
      },
    },

    /**
     * `/apps` — v0.6 OQ-4.B chat-inline app-toggle.  Subcommands:
     *   /apps             → list every catalog app + enabled state
     *   /apps on <name>   → enable an app
     *   /apps off <name>  → disable an app
     *
     * Disabled apps disappear from /help + dispatches fail with a
     * friendly error.  Toggle persists across reloads.  Side-panel
     * UI lands with RN port (v0.6.7+).
     */
    {
      id:    'apps',
      verb:  'list',
      params: [
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
        { name: 'app',    kind: 'string',                  required: false },
      ],
      surfaces: {
        slash: { command: '/apps', body: 'flags' },
        chat:  { reply: 'text', hint: 'list or toggle apps; /apps on|off <name>' },
      },
    },

    /**
     * `/send-to <peer> <itemId>` — v0.5.6 simulated cross-peer demo.
     * Fakes a J7 round-trip by routing an embed-card into the named
     * peer's thread (per the simulated cross-peer simPeers config).
     * Lets the user test issued-by + receiver-claim UX in a single
     * browser tab without real network.  Real cross-peer delivery
     * happens through each hosting app's chat surface (v0.5.3 audit).
     */
    {
      id:    'sendto',
      verb:  'add',
      params: [
        { name: 'peer',   kind: 'string', required: true },
        { name: 'itemId', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/send-to' },
        chat:  { reply: 'text', hint: 'simulate sending an embed to a peer thread' },
      },
    },
  ],
  views: [],   // chat shell does not surface its own views in nav;
               //   threads are managed via the chat UI, not a section
};

export default canopyChatManifest;
