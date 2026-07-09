/**
 * agents — app manifest (read slice 2026-07-09 + P2 CONTROL ops).
 *
 * The "your agents" management surface: a member's registered agents
 * (their devices + delegated agents) listed from the canonical
 * `@canopy/agent-registry` pod resource.
 *
 * READ ops (P1, canonical `list` atom):
 *   • listAgents — the non-revoked roster (soft-revoke: entries with a
 *     `revokedAt` are skipped from the list).
 *   • viewAgent  — one agent's detail record, resolved by agentId/pubKey.
 *
 * CONTROL ops (P2 — PLAN-agent-management-surface.md).  Design rule
 * (decision 2): the signed CapabilityToken is the ENFORCED authority;
 * the registry's `grants[]`/`capabilities[]` only MIRROR it — so grant
 * issues the token FIRST, then mirrors; revoke hits token(s) + entry
 * together.  Without an injected token collaborator the ops still keep
 * the mirror honest and report `tokenBacked: false` (degraded).
 *   • revokeAgent (atom `revoke`)  — soft-revoke the whole agent: revoke
 *     each of its grant tokens, then stamp the entry `revokedAt`.
 *     Confirm-gated (`severity: 'danger'` — disables an agent).
 *   • grantAgent  (atom `update`)  — issue a fresh scoped token, then
 *     mirror it into the entry (`applyGrant`).  Mutates the entry's
 *     capability surface, hence `update`.
 *   • revokeGrant (atom `revoke`)  — the adjust op: revoke ONE token,
 *     then un-mirror it from the entry (`revokeGrant`).
 *   • purgeAgent  (atom `remove`)  — HARD delete of the entry (works on
 *     a revoked agent).  Confirm-gated, permanent.
 *
 * itemType `'agent'` is app-local (F-SP1-a — not canonical in
 * `@canopy/item-types`); permitted by validateManifest.  The DETAIL
 * view mirrors the stoop `settings` / tasks-v0 `pod-settings` record-
 * view precedent (`shape: 'record'` + a runtime-derived dataSource arg
 * via `argsFromContext`), still read-only (no `fields[]` patch surface —
 * mutation goes through the explicit ops above).
 *
 * Hints are written for the LLM tool-calling layer (surfaces.chat.hint);
 * listAgents also carries a `/agents` slash command.
 *
 * @type {import('@canopy/app-manifest').__types__}
 */
export const agentsManifest = {
  app:       'agents',
  itemTypes: ['agent'],

  // Layer-1 capability surface — (verb × noun) atoms this app ships.
  // P2 CONTROL: `revoke` (revokeAgent / revokeGrant), `update`
  // (grantAgent — mutates the entry's capability surface), `remove`
  // (purgeAgent — hard delete).
  nouns: {
    agent: { atoms: ['list', 'revoke', 'update', 'remove'] },
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

    /* ── P2 CONTROL ops ─────────────────────────────────────────────────
     * All resolve the target by agentId OR pubKey ONLY (never webid —
     * ambiguous for multi-device users), same as viewAgent.  Token-first
     * discipline: see the header comment (decision 2).
     */
    {
      id:        'revokeAgent',
      verb:      'revoke',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Revoke (disable) an agent by agentId or pubKey: revokes each of its '
               + 'capability-grant tokens, then soft-revokes the registry entry (kept for '
               + 'audit; drops off the roster). Reports how many tokens were revoked.',
        },
        // Q27 Tier C consent gate — disabling an agent cuts off every
        // delegation it holds.  'danger' → adapter shows a red confirm.
        ui: {
          control: 'button',
          label:   'Revoke agent',
          confirm: {
            severity: 'danger',
            message:  'Revoke this agent?  All its capability grants stop working immediately. '
                    + 'The entry is kept for audit.',
          },
        },
      },
    },
    {
      id:        'grantAgent',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId',       kind: 'string', required: true, schema: { minLength: 1 } },
        // The fine-grained skill scope the token authorises (e.g.
        // 'tasks.addTask' or a prefix like 'bot.*').
        { name: 'skill',         kind: 'string', required: true, schema: { minLength: 1 } },
        // Coarse capability label mirrored into `capabilities[]`;
        // defaults to `skill` when omitted.
        { name: 'capability',    kind: 'string' },
        // Token lifetime; defaults to 30 days (BotAgentRegistry precedent).
        { name: 'expiresInDays', kind: 'number', schema: { exclusiveMinimum: 0 } },
        // Token subject (grantee key); defaults to the agent's pubKey.
        { name: 'subject',       kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Grant an agent (by agentId or pubKey) a scoped capability: issues a fresh '
               + 'signed capability token for the given skill (optional coarse capability '
               + 'label, expiry in days — default 30, subject — default the agent pubKey), '
               + 'then mirrors it into the registry entry.',
        },
      },
    },
    {
      id:        'revokeGrant',
      verb:      'revoke',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'tokenId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Revoke ONE capability grant from an agent (by agentId/pubKey + the grant '
               + 'tokenId, as listed in the agent detail): revokes the token, then removes '
               + 'the grant from the registry entry (un-mirroring its coarse capability '
               + 'when no other grant still uses it). The agent itself stays active.',
        },
      },
    },
    {
      id:        'purgeAgent',
      verb:      'remove',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'PERMANENTLY delete an agent entry from the registry by agentId or pubKey '
               + '(hard delete — unlike revoke, nothing is kept for audit). Works on an '
               + 'already-revoked agent; idempotent when the entry is absent.',
        },
        ui: {
          control: 'button',
          label:   'Purge agent',
          confirm: {
            severity: 'danger',
            message:  'Permanently delete this agent entry?  This cannot be undone — the '
                    + 'record is removed entirely (revoke instead to keep it for audit).',
          },
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
