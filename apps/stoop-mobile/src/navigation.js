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

  // Main shell
  Feed:           'Feed',             // /index.html — Prikbord
  PostCompose:    'PostCompose',      // post-form section
  ItemDetail:     'ItemDetail',       // modal in / on web
  Mine:           'Mine',              // /mine.html

  // Chat
  ChatThreads:    'ChatThreads',      // /chat.html (list)
  ChatThread:     'ChatThread',       // /chat.html?thread=…

  // Identity
  ProfileMine:    'ProfileMine',      // /profile.html
  ProfileOther:   'ProfileOther',     // modal in / — read-only view
  Contacts:       'Contacts',         // /contacts.html
  Contact:        'Contact',          // single-contact modal

  // Group / governance
  Group:          'Group',            // /group.html

  // Settings & misc
  Settings:       'Settings',
  Privacy:        'Privacy',
  Push:           'Push',             // /push.html — opt-in + test
  Metrics:        'Metrics',          // optional / debug
});

/**
 * The order routes register in the stack. Welcome is the
 * `initialRouteName` until the user has identity bootstrapped, then
 * Feed takes over.
 */
export const ROUTE_ORDER = Object.freeze([
  ROUTES.Welcome,
  ROUTES.OnboardScan,
  ROUTES.OnboardRestore,
  ROUTES.OnboardIssue,
  ROUTES.SignIn,
  ROUTES.Feed,
  ROUTES.PostCompose,
  ROUTES.ItemDetail,
  ROUTES.Mine,
  ROUTES.ChatThreads,
  ROUTES.ChatThread,
  ROUTES.ProfileMine,
  ROUTES.ProfileOther,
  ROUTES.Contacts,
  ROUTES.Contact,
  ROUTES.Group,
  ROUTES.Settings,
  ROUTES.Privacy,
  ROUTES.Push,
  ROUTES.Metrics,
]);


