/**
 * navigation — single source of truth for tasks-mobile route names.
 *
 * Phase 41.3 (2026-05-09).
 *
 * Each screen file imports from here so route-name typos are
 * impossible. The list grows as later phases add screens (Workspace
 * 41.4, MyWork 41.5, Review/Inbox/Dag 41.6, Circles 41.7, …).
 */

export const ROUTES = Object.freeze({
  // Pre-shell — first-run / onboarding stack.
  Welcome:        'Welcome',
  OnboardScan:    'OnboardScan',
  OnboardRestore: 'OnboardRestore',
  OnboardIssue:   'OnboardIssue',

  // Phase 41.18 follow-up — bottom-tab shell. Outer-stack route
  // that hosts Workspace / MyWork / Review / Inbox / Circles as
  // tabs. Detail screens push OVER this shell.
  Main:           'Main',

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

  // Phase 41.7 — Cross-circle dashboard.
  Circles:          'Circles',

  // Phase 41.9–41.11 — User-side admin: availability / profile / settings.
  Availability:   'Availability',
  ProfileMine:    'ProfileMine',
  ProfileOther:   'ProfileOther',
  Settings:       'Settings',

  // Phase 41.8 — Circle settings (six sections).
  CircleSettings:   'CircleSettings',

  // Phase 41.13 — Bot binding QR.
  IssueBotToken:  'IssueBotToken',

  // Phase 41.15 — Pod sign-in + bulk sync.
  PodSignIn:      'PodSignIn',
  AuthCallback:   'AuthCallback',

  // Phase 41.18.2 — Diagnostics + privacy notice (parity completion).
  Metrics:        'Metrics',
  Privacy:        'Privacy',

  // Phase 41.18.3 — Skills editor + cadence overrides (parity completion).
  EditSkills:        'EditSkills',
  CadenceOverrides:  'CadenceOverrides',

  // Phase 41.18.4 — Appeal flow + chat-thread surface (parity completion).
  ChatThread:        'ChatThread',

  // M1-S2 — full create-circle wizard (storage-policy picker).
  CreateCircle:        'CreateCircle',

  // M1-S4 — Pod & storage settings screen.
  PodSettings:       'PodSettings',
});
