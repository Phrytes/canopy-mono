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
  itemTypes: ['agent', 'data-version'],

  // Layer-1 capability surface — (verb × noun) atoms this app ships.
  // P2 CONTROL: `revoke` (revokeAgent / revokeGrant), `update`
  // (grantAgent — mutates the entry's capability surface), `remove`
  // (purgeAgent — hard delete).
  // P3 RECOVERY (`data-version`, app-local like `agent`): `list`
  // (listDataVersions) + `update` (restoreDataVersion — writes a prior
  // state back to the live resource).
  nouns: {
    agent:          { atoms: ['list', 'revoke', 'update', 'remove'] },
    'data-version': { atoms: ['list', 'update'] },
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

    /* ── P3 RECOVERY ops (PLAN-pod-versioning-history-recovery) ─────────
     * "Restore corrupted / lost data" over the per-circle pod version
     * history. Deliberately on THIS surface: J5/J7's recovery arc is
     * "revoke the misbehaving agent → restore what it touched".
     */
    {
      id:        'listDataVersions',
      verb:      'list',
      appliesTo: { type: 'data-version' },
      params: [
        { name: 'circleId', kind: 'string', required: true, schema: { minLength: 1 } },
        // Without `uri`: every resource with history (uri · latest · count).
        // With `uri`: that resource's versions, newest-first — the restore pick-list.
        { name: 'uri',      kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'List a circle\'s data-version history: without a uri, every resource in the '
               + 'circle pod that has retained versions (uri, latest timestamp, count); with a '
               + 'uri, that resource\'s versions newest-first (ts, id, sha256, size, writing '
               + 'device) — use an id with restoreDataVersion to roll back. Read-only.',
        },
      },
    },
    {
      id:        'restoreDataVersion',
      verb:      'update',
      appliesTo: { type: 'data-version' },
      params: [
        { name: 'circleId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'uri',      kind: 'string', required: true, schema: { minLength: 1 } },
        // Numeric ts or the full "<ts>-<writer>" version id from listDataVersions.
        { name: 'version',  kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Restore a circle pod resource to a previous version (by uri + version ts/id '
               + 'from listDataVersions). Overwrites the CURRENT content — but undoably: the '
               + 'current state is snapshotted first (snapshotMsBeforeRestore), so a wrong '
               + 'restore can itself be restored. Use to recover data corrupted or deleted by '
               + 'a misbehaving agent.',
        },
        // Overwrites live content (undoably) — red confirm, same Q27 tier
        // as revokeAgent.
        ui: {
          control: 'button',
          label:   'Restore version',
          confirm: {
            severity: 'danger',
            message:  'Restore this resource to the selected version?  Its current content is '
                    + 'snapshotted first, so this restore can itself be undone.',
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

    /* ── P3 RECOVERY views — "restore corrupted / lost data" by screen ──
     * Same op (`listDataVersions`) drives BOTH sections; the `uri`
     * context arg switches the mode (see the op's param comments).
     * `restoreDataVersion` surfaces on each row via its `surfaces.ui`
     * button + `appliesTo: {type: 'data-version'}` (danger confirm
     * already declared on the op — renderWeb projects it as an
     * itemAction with `confirm.severity: 'danger'`).
     */
    // LIST — the circle's version SERIES roster: every resource with
    // retained history (rows: uri · latestMs · count; the core also
    // exposes them as `items` with id/label ← uri for the list
    // renderer).  `$circleId` is the same runtime context arg the
    // tasks-v0 `pod-settings` view uses (Q15 — host supplies the
    // active circle).
    {
      id:         'data-versions',
      title:      'Data versions',
      type:       'data-version',
      labelField: 'uri',
      dataSource: {
        skillId:         'listDataVersions',
        argsFromContext: { circleId: '$circleId' },
      },
    },
    // DETAIL — ONE resource's versions newest-first (the restore
    // pick-list; rows: ts · id · sha256 · size · writer, exposed as
    // `items` with label ← ISO(ts) · id).  `$uri` is a NEW runtime
    // context arg: the host materializer supplies it from the row the
    // user picked in `data-versions` (same Q15 mechanism as
    // `$agentId` on agent-detail).  Stays a LIST (not shape:'record')
    // — the drilldown is itself a pick-list of versions.
    {
      id:         'data-version-detail',
      title:      'Version history',
      type:       'data-version',
      labelField: 'label',
      dataSource: {
        skillId:         'listDataVersions',
        argsFromContext: { circleId: '$circleId', uri: '$uri' },
      },
    },
  ],
};

export default agentsManifest;
