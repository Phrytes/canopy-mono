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

  // Post-onboarding placeholder (Phase 41.4 wires the real Workspace).
  Workspace:      'Workspace',
});
