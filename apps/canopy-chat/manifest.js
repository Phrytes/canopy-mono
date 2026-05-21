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
  ],
  views: [],   // chat shell does not surface its own views in nav;
               //   threads are managed via the chat UI, not a section
};

export default canopyChatManifest;
