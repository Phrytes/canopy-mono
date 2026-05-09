/**
 * navigation — single source of truth for tasks-mobile route names.
 *
 * Phase 41.3 (2026-05-09).
 *
 * Each screen file imports from here so route-name typos are
 * impossible. The list grows as later phases add screens (Workspace
 * 41.4, MyWork 41.5, Review/Inbox/Dag 41.6, Crews 41.7, …).
 */

export const ROUTES = Object.freeze({
  // Pre-shell — first-run / onboarding stack.
  Welcome:        'Welcome',
  OnboardScan:    'OnboardScan',
  OnboardRestore: 'OnboardRestore',
  OnboardIssue:   'OnboardIssue',

  // Post-onboarding — main task surface (Phase 41.4).
  Workspace:      'Workspace',
  TaskDetail:     'TaskDetail',
  Compose:        'Compose',

  // Phase 41.5 — My work + planner + photo deliverable submit.
  MyWork:         'MyWork',
  Submit:         'Submit',

  // Phase 41.6 — Review / DAG / Inbox.
  Review:         'Review',
  Dag:            'Dag',
  Inbox:          'Inbox',

  // Phase 41.7 — Cross-crew dashboard.
  Crews:          'Crews',
});
