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
     * `/embed-file <path>` — v0.5.5 file-card variant.
     */
    {
      id:    'embed-file',
      verb:  'add',
      params: [{ name: 'path', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/embed-file' },
        chat:  { reply: 'embed-card', hint: 'embed a file card in this thread' },
      },
    },

    /**
     * `/embed-time <eventId>` — v0.5.5 time-card variant.
     */
    {
      id:    'embed-time',
      verb:  'add',
      params: [{ name: 'eventId', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/embed-time' },
        chat:  { reply: 'embed-card', hint: 'embed a time/event card in this thread' },
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
