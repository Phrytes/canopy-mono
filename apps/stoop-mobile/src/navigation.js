/**
 * navigation — Stoop V3 mobile route table.
 *
 * Single source of truth for the screen names + their navigation
 * params. App.js wires them into a react-navigation native stack;
 * deep-link handling (Phase 40.11) maps `stoop://...` URLs onto
 * these route names.
 *
 * Per the functional design § 6 (
 * `Project Files/Stoop/v3-mobile-functional-design-2026-05-08.md`).
 */

export const ROUTES = Object.freeze({
  // First-run / onboarding
  Welcome:        'Welcome',
  OnboardScan:    'OnboardScan',
  OnboardRestore: 'OnboardRestore',
  OnboardIssue:   'OnboardIssue',     // admin generates QR
  SignIn:         'SignIn',           // pod sign-in

  // Main shell tabs (bottom-tab navigator).
  Shell:          'Shell',            // wraps the tabs; the route name we
                                      // navigate to from Welcome / deep links
  Feed:           'Feed',             // /index.html — Prikbord
  Mine:           'Mine',             // /mine.html
  ChatThreads:    'ChatThreads',      // /chat.html (list)
  Contacts:       'Contacts',         // /contacts.html
  ProfileMine:    'ProfileMine',      // /profile.html
  Settings:       'Settings',

  // Pushed over the tab shell (modals + per-item details).
  PostCompose:    'PostCompose',      // post-form section
  ItemDetail:     'ItemDetail',       // modal in / on web
  ChatThread:     'ChatThread',       // /chat.html?thread=…
  ProfileOther:   'ProfileOther',     // read-only view of another member
  Contact:        'Contact',          // single-contact detail
  Group:          'Group',            // /group.html
  Privacy:        'Privacy',
  Push:           'Push',             // /push.html — opt-in + test
  Metrics:        'Metrics',          // optional / debug
});

/**
 * Routes that live INSIDE the bottom-tab shell.  These render with
 * the tab bar visible; they're the user's "home" screens.
 */
export const SHELL_TAB_ROUTES = Object.freeze([
  ROUTES.Feed,
  ROUTES.Mine,
  ROUTES.ChatThreads,
  ROUTES.Contacts,
  ROUTES.ProfileMine,
  ROUTES.Settings,
]);

/**
 * Routes that push OVER the shell (no tab bar visible).  Includes
 * the entry stack (Welcome / Onboard*) and the per-item / per-thread
 * detail screens.
 */
export const STACK_ONLY_ROUTES = Object.freeze([
  ROUTES.Welcome,
  ROUTES.OnboardScan,
  ROUTES.OnboardRestore,
  ROUTES.OnboardIssue,
  ROUTES.SignIn,
  ROUTES.PostCompose,
  ROUTES.ItemDetail,
  ROUTES.ChatThread,
  ROUTES.ProfileOther,
  ROUTES.Contact,
  ROUTES.Group,
  ROUTES.Privacy,
  ROUTES.Push,
  ROUTES.Metrics,
]);

/**
 * Flat list of every named route, used by tests.  App.js itself
 * registers them via two navigators: `STACK_ONLY_ROUTES` go in the
 * outer native stack; `SHELL_TAB_ROUTES` go in the bottom-tab shell
 * (rendered by the synthetic `Shell` route).
 */
export const ROUTE_ORDER = Object.freeze([
  ...STACK_ONLY_ROUTES,
  ROUTES.Shell,
  ...SHELL_TAB_ROUTES,
]);


