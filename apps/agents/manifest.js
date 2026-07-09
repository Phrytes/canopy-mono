/**
 * agents — app manifest (read-only first slice, 2026-07-09).
 *
 * The "your agents" management surface: a member's registered agents
 * (their devices + delegated agents) listed from the canonical
 * `@canopy/agent-registry` pod resource.  THIS SLICE IS READ-ONLY —
 * a LIST view (name · role · status · lastSeen) + a record DETAIL view
 * (skills · grant summary · status · lastSeen).  No mutate ops yet:
 * grant / revoke / purge / install are a later slice (owned separately).
 *
 * Two ops, both reads (canonical `list` atom):
 *   • listAgents — the non-revoked roster (soft-revoke: entries with a
 *     `revokedAt` are skipped from the list).
 *   • viewAgent  — one agent's detail record, resolved by agentId/pubKey.
 *
 * itemType `'agent'` is app-local (F-SP1-a — not canonical in
 * `@canopy/item-types`); permitted by validateManifest.  The DETAIL
 * view mirrors the stoop `settings` / tasks-v0 `pod-settings` record-
 * view precedent (`shape: 'record'` + a runtime-derived dataSource arg
 * via `argsFromContext`), but read-only (no `fields[]` patch surface).
 *
 * Hints are written for the LLM tool-calling layer (surfaces.chat.hint);
 * listAgents also carries a `/agents` slash command.
 *
 * @type {import('@canopy/app-manifest').__types__}
 */
export const agentsManifest = {
  app:       'agents',
  itemTypes: ['agent'],

  // Layer-1 capability surface — read-only in this slice (list only).
  nouns: {
    agent: { atoms: ['list'] },
  },

  operations: [
    {
      id:        'listAgents',
      verb:      'list',
      appliesTo: { type: 'agent' },
      params:    [],
      surfaces: {
        slash: { command: '/agents' },
        chat: {
          reply: 'list',
          hint:  'List your registered agents (devices + delegated agents), newest signing first. '
               + 'Shows name, role, status (active), and when each was last seen. Revoked agents are omitted. Read-only.',
        },
      },
    },
    {
      id:        'viewAgent',
      verb:      'list',
      appliesTo: { type: 'agent' },
      params: [
        // Resolve on agentId OR pubKey only (NOT webid — a webid is
        // ambiguous for multi-device users, who share one webid across
        // several agent entries).  kind:'string' — the core matches it
        // against agentId then pubKey.
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Show one agent in detail by its agentId or pubKey: derived skills '
               + '(from its grants + capabilities), a grant summary, status, and last-seen. Read-only.',
        },
      },
    },
  ],

  views: [
    // LIST — the roster.  Rows carry name · role · status · lastSeen
    // (see the `toRow` mapping in src/cores.js).  Non-revoked only.
    {
      id:         'agents',
      title:      'Your agents',
      type:       'agent',
      labelField: 'name',
      dataSource: { skillId: 'listAgents' },
    },
    // DETAIL — one agent, record shape (mirrors stoop `settings` /
    // tasks-v0 `pod-settings`).  `agentId` is a RUNTIME-derived arg
    // (the selected row / URL), supplied via the fetch-section context
    // as `$agentId` (same Q15 pattern tasks-v0 uses for `$circleId`).
    // read-only: no `fields[]` — this slice has no patch surface.
    {
      id:       'agent-detail',
      title:    'Agent',
      type:     'agent',
      shape:    'record',
      readOnly: true,
      dataSource: {
        skillId:         'viewAgent',
        argsFromContext: { agentId: '$agentId' },
      },
    },
  ],
};

export default agentsManifest;
