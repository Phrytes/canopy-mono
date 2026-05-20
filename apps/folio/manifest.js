/**
 * Folio — app-manifest declaration.
 *
 * Slice F.1 (V0.8, 2026-05-21) — folio's first NavModel manifest.
 *
 * Folio is structurally different from the item-store apps (tasks-v0,
 * stoop, household): it doesn't have an ItemStore + crew-scoped items.
 * Its "items" are markdown files mirrored to a Solid pod via
 * `@canopy/sync-engine`.  Its "skills" are HTTP route handlers
 * (`apps/folio/src/server/routes.js`) + CLI commands
 * (`apps/folio/src/cli/*.js`) + RN actions
 * (`apps/folio-mobile/src/screens/*.js`) — NOT the
 * `defineSkill` / agent-invoke shape the substrate apps use.
 *
 * What this manifest IS:
 *   - Source-of-truth declaration of folio's destructive ops with Q27
 *     severity hints (per TIER-C-PROPOSALS.md):
 *
 *       deleteFromPod   severity: 'danger'  (irreversible pod-side delete)
 *       deleteLocally   severity: 'info'    (tombstone; pod copy survives)
 *       forceRepush     severity: 'warn'    (overwrites pod versions)
 *
 *     Plus a few non-destructive ops (sync-now, watch-start, watch-stop,
 *     verifyPodState) for shape coverage.
 *
 *   - Documentation: chat agents (a future folio chat agent, or a host
 *     chat agent that knows about folio) can read this manifest's
 *     `surfaces.chat.hint` strings to surface folio operations.
 *
 *   - Forward-compat: when folio gains a real NavModel-driven UI
 *     (currently the HTTP server + RN screens are hand-coded), the
 *     adapter consumes this manifest directly.  Today the manifest is
 *     declaration-only; no adapter consumes it yet.
 *
 * What this manifest is NOT (yet):
 *   - Wired into the HTTP routes — routes still own their own logic.
 *   - Wired into folio-mobile screens — they still own their own
 *     ConfirmModal usage.
 *   - Q16-strict — `validateManifest(folioManifest, {strict: true})`
 *     would flag `listFiles` + `verifyPodState` because they don't have
 *     `defineSkill` entries; folio's "skills" are HTTP routes.  Default
 *     non-strict validation passes.
 *
 * Future slices (F.2+) can wire the HTTP /status page + folio-mobile
 * screens to read this manifest's projected NavModel for severity
 * hints + label resolution.
 */

/** @type {import('@canopy/app-manifest').__types__} */
export const folioManifest = {
  app:       'folio',
  itemTypes: [
    // Markdown files mirrored between local folder and Solid pod.  The
    // local rel-path is the item identity (e.g. 'notes/today.md').
    'file',
  ],

  operations: [
    /* ── Destructive ops (Q27 confirm) ─────────────────────────────── */

    {
      id:        'deleteFromPod',
      verb:      'remove',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { hint: 'Permanently delete a file from your Solid pod.  Cannot be undone — pod-side delete is irreversible.' },
        ui: {
          control: 'button',
          label:   'Delete from pod',
          confirm: {
            severity: 'danger',
            message:  'Permanently delete this file from your Solid pod?  This cannot be undone.',
          },
        },
      },
    },

    {
      id:        'deleteLocally',
      verb:      'remove',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { hint: 'Remove the local copy via a tombstone.  Pod copy survives; the file re-appears locally on the next sync if still present on the pod.' },
        ui: {
          control: 'button',
          label:   'Delete locally',
          confirm: {
            severity: 'info',
            message:  'Remove local copy?  Pod copy survives.',
          },
        },
      },
    },

    {
      id:     'forceRepush',
      verb:   'sync',  // F-SP1-e: app-local verb.  Distinct from runOnce
                       // (a normal bi-directional sync) — forceRepush
                       // overwrites pod versions wholesale.
      params: [],
      // V0.2 Q8 wildcard — folder-wide op, not file-specific.  The
      // wildcard surfaces it as a section-header CTA on every view
      // (today just `files`).  Future folio views (e.g. conflicts)
      // pick it up automatically.
      appliesTo: { type: '*' },
      surfaces: {
        chat: { hint: 'Force-push every local file to the pod, overwriting concurrent pod-side edits.  Disaster-recovery only.' },
        ui: {
          control:   'button',
          label:     'Force re-push',
          placement: 'section-header',
          confirm: {
            severity: 'warn',
            message:  'Force-push the local folder to the pod?  This overwrites any concurrent edits on the pod side.',
          },
        },
      },
    },

    /* ── Non-destructive ops (shape coverage) ──────────────────────── */

    {
      id:        'syncOnce',
      verb:      'sync',
      params:    [],
      // V0.2 Q8 wildcard — folder-wide; surfaces on every view's header.
      appliesTo: { type: '*' },
      surfaces: {
        chat: { hint: 'Run one bi-directional sync between the local folder and the pod.' },
        ui: {
          control:   'button',
          label:     'Sync now',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'watchStart',
      verb:      'watch',
      params:    [],
      appliesTo: { type: '*' },
      surfaces: {
        chat: { hint: 'Start the local-folder watcher.  Edits fire `runOnce` after a stability+grace window.' },
        ui: {
          control:   'button',
          label:     'Start watching',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'watchStop',
      verb:      'watch',  // F-SP1-e: same verb as watchStart, opposite
                           // semantics — distinguished by skill id.
      params:    [],
      appliesTo: { type: '*' },
      surfaces: {
        chat: { hint: 'Stop the local-folder watcher.  Future edits no longer auto-sync; manual sync still works.' },
        ui: {
          control:   'button',
          label:     'Stop watching',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'verifyPodState',
      verb:      'read',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { hint: 'Check whether a local file matches its pod counterpart (existence + sha + size).' },
        ui:   { control: 'button', label: 'Verify on pod' },
      },
    },
  ],

  views: [
    // The files view — list of locally-tracked markdown files.  Today
    // populated by folio's `/files` HTTP route + folio-mobile's
    // NotesListScreen; the manifest's `dataSource.skillId` is
    // aspirational (folio doesn't have a `listFiles` defineSkill yet).
    // Q16-strict mode would flag this; default non-strict passes.
    {
      id:         'files',
      title:      'Files',
      type:       'file',
      dataSource: { skillId: 'listFiles' },
    },
  ],
};

export default folioManifest;
