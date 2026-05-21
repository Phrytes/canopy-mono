# Pod-auth + sharing inventory (2026-05-14)

> Inventory pass for **Track-J — Solid-pod auth / sharing consolidation**.
> Source: [`TODO-GENERAL.md` § "🔴 HIGH — Solid pod / cap-token UX
> cleanup (Inrupt migration)"](../TODO-GENERAL.md).
>
> **Framing update (2026-05-14):** the user clarified that almost all
> apps are **already using Inrupt login**; this is NOT a
> "migrate-from-bespoke-to-Inrupt" job. The real goals are:
>
> 1. **Consolidate inconsistencies** — same auth/share UX everywhere.
> 2. **Add multi-issuer support** so apps work against community
>    (`solidcommunity.net`) + self-hosted (CSS) pods, not just
>    `login.inrupt.com`.
> 3. **Decide what to do with the bespoke cap-token + `with-<webid>/`
>    surfaces** that DO still exist (Folio, Household, Tasks-mobile bot
>    binding). Cryptography layer stays per the saved memory; product-
>    layer UX is what shifts.
>
> Companion docs to follow this session: `substrate-design-2026-05-14.md`
> + `track-j-plan-2026-05-14.md`.

## TL;DR

- **OIDC layer:** mature. Two shared substrates carry the load
  (`@canopy/oidc-session` for Node-server apps; `@canopy/oidc-session-rn`
  for React Native). Three RN apps consume the RN substrate with
  per-`appId` SecureStore namespacing; two web apps (Folio, Stoop) keep
  copy-pasted `OidcSession.js` wrappers around `@inrupt/solid-client-authn-node`.
- **Sign-in UX:** inconsistent. Folio web is the **only** app with a
  multi-issuer picker (radio: `solidcommunity.net`/`login.inrupt.com`/
  custom URL). All RN apps default to `login.inrupt.com` with no picker
  affordance.
- **Sharing UX:** five bespoke surfaces (Folio CLI/server/web/auto-share,
  Folio-mobile ShareScreen, Tasks-mobile bot-token QR, Household admin
  cap-token). All ride on `PodCapabilityToken` + `CapabilityAuth`. **ACP
  mutation code paths are not yet implemented** (`@inrupt/solid-client`
  is lazy-loaded for RDF patching but not for ACP semantics).
- **Cap-token cryptography:** sound, stays. Substrate-level — no UX
  concern.
- **Terminology:** "Pod" is dominant + consistent (EN+NL); "Account"
  intentionally means local identity / mnemonic, not the pod;
  "your data" is privacy-framing not a competing term. Lockable
  contract — see §6.

---

## 1. Per-app auth/sign-in surfaces

### `apps/folio` (Node-server desktop)

- **Sign-in entry:** `POST /auth/login` at `src/auth/authRoutes.js:78` —
  accepts `{ issuer }` from body, no hardcoded default.
- **Issuer picker UI:** `src/server/static/index.html:45-70` — radio
  buttons for `solidcommunity.net`, `login.inrupt.com`, and a "custom
  URL" text field. Submitted via `src/server/static/auth.js:117-138`.
  **Only app with a real picker today.**
- **Redirect handler:** `/auth/callback` at `src/auth/authRoutes.js:100+`.
  Localhost-bound (`LOCAL_HOST_NAMES` at 31-32).
- **Session wrapper:** `src/auth/OidcSession.js` — sits over
  `@inrupt/solid-client-authn-node`, persists refresh-token + issuer +
  clientId/clientSecret in vault under `oidc-*` keys.
- **Test mock:** `FOLIO_TEST_MOCK_POD=1` bypasses real pod auth.

### `apps/folio-mobile` (React Native)

- **Sign-in entry:** `src/screens/SignInScreen.js:66-100`.
- **Default issuer:** `DEFAULT_INRUPT_ISSUER = 'https://login.inrupt.com'`
  (re-exported from `src/lib/config.js`). **Hardcoded; no picker.**
- **Hook:** `src/auth/folioAuthHook.js` — pre-binds
  `scheme: 'folio'`, `clientName: 'Folio (mobile)'` and delegates to
  `useOidcSignIn` from `@canopy/oidc-session-rn/hook`.
- **Session:** `src/auth/OidcSessionRN.js` — re-export shim around the
  substrate, pre-binds `appId: 'folio'` for legacy SecureStore key
  stability (`folio-oidc-*`).
- **DCR:** `src/auth/dcr.js:24` — cache keys `folio-dcr-client-id-<host>`.
- **Pod-root discovery:** `discoverPodRoot()` reads WebID profile to
  pre-fill pod-base input (SignInScreen:91-93).

### `apps/stoop` (Node-server web)

- **Sign-in entry:** `src/lib/podSignIn.js:45-60` —
  `startPodSignIn({ bundle, issuer, redirectUrl })`. Issuer is passed
  from caller; no picker at the entry point.
- **Issuer picker UI:** `web/sign-in.html` — placeholder/value
  `https://solidcommunity.net` (note: different default from Folio web,
  which radio-defaults to `login.inrupt.com`). User-editable text input;
  no curated list of providers.
- **Session wrapper:** `src/lib/OidcSession.js` — copy-pasted from
  Folio's wrapper (Phase 20 comment marks this as rule-of-two pending,
  awaiting a third consumer to promote to a substrate).

### `apps/stoop-mobile` (React Native)

- **Sign-in entry:** `src/screens/SignInScreen.js:47-72`.
- **Default issuer:** `'https://login.inrupt.com'` hardcoded at line 37.
  **Hardcoded; no picker.** User *can* `setIssuer(...)` because state is
  exposed, but there's no UI affordance.
- **Hook:** `src/auth/stoopAuthHook.js` — pre-binds `scheme: 'stoop'`,
  `clientName: 'Stoop (mobile)'`. Delegates to `useOidcSignIn`.
- **Session:** instantiates `BaseOidcSessionRN` (from the RN substrate)
  with `appId: 'stoop'` (in `src/lib/ServiceContext.js:23`).
- **SecureStore keys:** `stoop-oidc-*`.

### `apps/tasks-mobile` (React Native)

- **Sign-in entry:** `src/screens/PodSignInScreen.jsx:34-80`.
- **Default issuer:** `TASKS_OIDC_DEFAULT_ISSUER = 'https://login.inrupt.com'`
  at `src/auth/useTasksAuth.js:15`. **Hardcoded; no picker.**
- **Hook:** `src/auth/useTasksAuth.js` — pre-binds `scheme: 'tasks'`,
  `path: 'auth/callback'`, `clientName: 'Tasks (mobile)'`.
- **Session:** dynamic-imports `OidcSessionRN` with `appId: 'tasks'`
  (implicit via `scheme`). SecureStore keys: `tasks-oidc-*`.

### `apps/tasks-v0` (Node, bot agent backend)

- No user-facing pod sign-in. Token/issuer handling rides through
  webhook notifications (`wireIssuerNotifications`).
- **Cross-pod identity** for crew members is **planned, not shipped**
  (substrates-v2 §52.10 `agent-registry` will enable this).

### `apps/household` (Node, Telegram bot)

- No Solid auth surface — runs on Telegram bot auth instead.
- Has its own bespoke admin pod cap-token (`src/identity/AdminCapability.js`)
  for co-admin access to the bot's pod (see §3.3 below).

### `apps/archive`, `apps/presence-v0` and other less-trafficked apps

- Not surveyed in depth. Either no Solid auth or test/legacy paths.
  Out of scope for first consolidation pass; revisit if any becomes
  user-facing.

---

## 2. Shared auth substrates

### `@canopy/oidc-session-rn`  (React Native)

- **Default export:** `OidcSessionRN`, `buildSecureStoreKeys()`,
  `completeSignIn()`, `extractWebIdFromIdToken()`, DCR helpers.
- **Default issuer:** `'https://login.inrupt.com'` at
  `src/completeSignIn.js:12`. **Hardcoded** in the substrate too —
  consumers can override, but the substrate's own default points at
  Inrupt.
- **Subpath export `/hook`:** `useOidcSignIn` with Expo deps
  (`expo-auth-session`, `expo-web-browser`, `expo-secure-store`).
  Pure-JS helpers are at the root export so non-Expo test runners can
  consume.
- **Per-app namespacing:** `appId` is mandatory; SecureStore key
  schema `<appId>-oidc-*` + DCR cache `<appId>-dcr-client-id-<host>`.
- **Consumers:** folio-mobile, stoop-mobile, tasks-mobile.
- **Token features:** transparent access-token refresh; pro-active
  refresh ahead of expiry; PKCE via `expo-auth-session`.
- **Known gap:** "No DPoP / JWT-binding for v0 — bearer is sufficient"
  (own comment at line 19). Acceptable against Inrupt's storage; other
  providers may want DPoP.

### `@canopy/oidc-session`  (Node, server-side)

- **Main class:** `SolidVault` (extracted from `@canopy/core` at
  Phase 50.1).
- **Public API:** `login()`, `isAuthenticated()`,
  `getAuthenticatedFetch()`, `refresh()`, `logout()`.
- **Session backend:** `@inrupt/solid-client-authn-node` (Node-only).
- **Token storage:** vault namespace `solid-oidc:<webid>:*`.
- **Consumers:** `apps/folio` (via OidcSession.js wrapper),
  `apps/stoop` (via OidcSession.js wrapper — copy-paste; rule-of-two
  promotion candidate), `packages/agent-provisioning` (uses `SolidVault`
  directly).

### `@canopy/pod-client`

- **Auth integration:** `SolidOidcAuth` wraps a vault instance →
  exposes `getAuthenticatedFetch()` to `SolidPodSource`.
- **Refresh:** delegates to the wrapped vault (OidcSessionRN or
  SolidVault).
- **No direct issuer handling** here — pod-client is consumer of the
  auth substrate, not author.

---

## 3. Sharing / capability-token surfaces

### 3.1 Cap-token cryptography (substrate layer — stays)

- **`PodCapabilityToken`** at `packages/core/src/permissions/PodCapabilityToken.js`
  — signed ED25519 grants. Scopes shape `pod.{read|write|delete|*}:<path-prefix>`.
  Issue / verify / chain-attenuate API. Exported from `@canopy/core`.
- **`CapabilityAuth`** at `packages/pod-client/src/Auth/CapabilityAuth.js`
  — bearer wrapper that injects `Authorization: Bearer <serialized-token>`
  on every fetch. Only mode is `'pod-direct'` in V1; `'agent-proxy'` is
  reserved.
- **Status:** cryptographically sound per saved memory; both stay.
  This inventory does not touch the crypto layer.

### 3.2 ACP / WAC code paths

- **Init-time container ACP templates:** `packages/pod-onboarding/src/acpTemplates.js`
  — three templates (`private/`, `sharing/`, `sharing/public/`). Inert
  JSON-LD; applied by the provisioner at pod-setup time.
- **`@inrupt/solid-client` lazy-load:** `packages/pod-client/src/PodClient.js:49-58`
  — loaded dynamically inside `patch()` for RDF primitives. **NOT used
  for ACP semantics yet.** The Inrupt primitives `getAcrUri`,
  `setPublicAccess`, `setAgentAccess`, `setGroupAccess` exist in the
  dep tree but no code path calls them.
- **Implication:** the migration target — *real* ACP-mutation via Inrupt
  — is **net-new code**, not a rewrite of existing code. The bespoke
  cap-token surface effectively *substitutes for* per-resource ACL
  mutation today.

### 3.3 Per-app sharing UX

#### `apps/folio` — five sharing surfaces

1. **CLI:** `src/cli/shareCmd.js` — `folio share <path> --for <pubkey>
   --scope read|write|delete|* --expires <ms>`. Mints a
   `PodCapabilityToken` from the vault-loaded identity; outputs serialized
   JSON for paste/share.
2. **Server API:** `POST /share` at `src/server/routes.js:25-28` —
   `{webid, scopes, expiresIn?, path?}` body, returns
   `{token: <serialized>}`.
3. **Browser UI:** `src/server/static/share.js` — form (webid +
   checkboxes for r/w/d + expiry) → posts to `/share` → renders JSON
   token + copy-to-clipboard. Recent shares persisted in
   `localStorage`.
4. **Auto-share `with-<webid>/` folder convention:** `src/autoShare.js`
   — top-level folders named `with-<urlencoded-webid>/` auto-mint
   90-day tokens with `pod.read:/<scope>/` + `pod.write:/<scope>/`.
   Persisted to `.folio/shares.json` (atomic temp-rename). Renewal at
   7-day window or on identity rotation.
5. **PathMap / SyncEngine integration:** `packages/sync-engine/src/PathMap.js`
   exposes `parseSharePath` hook; Folio's `SyncEngine` subclass
   injects auto-share hooks (`parseSharePath`, `ensureShares`,
   `listShares`).

#### `apps/folio-mobile` — `ShareScreen.js`

- Form: subject (pubKey or WebID), scope (e.g. `pod.read:/notes/`),
  days. Button "Mint capability token".
- Mint: `PodCapabilityToken.issue(engine.identity, {...})`. Output:
  read-only textarea (long-press to copy).
- **Known V0 limitation:** Guards on `engine?.identity` — if the
  mobile engine hasn't been attached with an identity, surfaces a
  friendly notice pointing the user to the desktop CLI.

#### `apps/tasks-mobile` — bot-binding QR codec

- **Files:** `src/lib/qrClassifiers.js` (classify `tasks://bot-token?...`),
  `src/lib/issueBotTokenUrl.js` (encode bot cap-token into URL).
- **Note:** This is a **skill-scoped** cap-token (agent-skill grants
  for the bot), **not a pod-scope** token. Orthogonal to pod-sharing —
  same crypto, different subject. Inventory captures it because it's
  a `CapabilityToken` UX surface, but consolidation should treat it
  separately from pod-sharing.

#### `apps/household` — admin pod cap-token

- **File:** `src/identity/AdminCapability.js`.
- **Use case:** co-admin access to the bot's pod. Bot's identity mints a
  token for an admin webid with `pod.*:/` (full root) and default 30-day
  TTL.
- **Verification:** `verifyAdminCap({token, botPodRoot, botPubkey})`
  checks signature + expiry + issuer-matches-bot-pubkey.
- **Rotation:** `rotateAdminCaps()` mints fresh tokens for all admins
  on bot key rotation (no explicit revoke list — tokens expire).

#### `apps/tasks-v0` — crew membership (not direct pod sharing)

- Crew config at `<crew-pod>/crews/<crewId>/{config.json, members/, tasks/}`.
  Sharing is **crew-membership-mediated** — listed members + role
  policy.
- Cross-pod crew-member discovery is a planned feature (substrates-v2
  §52.10 agent-registry). No bespoke cap-token surface here.

### 3.4 Cross-pod reference resolution (today)

- Folio model: token holder receives JSON token → parses to
  `PodCapabilityToken` → instantiates `CapabilityAuth({token, mode:'pod-direct'})`
  → `new PodClient({podRoot: <sharer's-pod>, auth})` → fetches.
- No built-in discovery. Apps fetch on-demand using the bearer.
- This pattern is fully bespoke vs. the Solid-standard ACL-mediated
  read where the consumer authenticates as themselves and the pod
  evaluates ACL — that's the migration target.

---

## 4. Hardcoded issuer URLs (the multi-issuer gap)

| File | Issuer URL | Type | User-configurable? |
|---|---|---|---|
| `apps/tasks-mobile/src/auth/useTasksAuth.js:15` | `https://login.inrupt.com` | `TASKS_OIDC_DEFAULT_ISSUER` constant | Via parameter only — no UI |
| `apps/stoop-mobile/src/screens/SignInScreen.js:37` | `https://login.inrupt.com` | Hardcoded default | Via parameter only — no UI |
| `apps/folio-mobile/src/lib/config.js` | `https://login.inrupt.com` | `DEFAULT_INRUPT_ISSUER` export | Via parameter only — no UI |
| `apps/stoop/web/sign-in.html` | `https://solidcommunity.net` | HTML form placeholder | User-editable text input |
| `apps/folio/src/server/static/index.html:45-70` | inrupt + solidcommunity + custom | Radio buttons + custom URL field | **Full picker (only one)** |
| `packages/oidc-session-rn/src/completeSignIn.js:12` | `https://login.inrupt.com` | `DEFAULT_INRUPT_ISSUER` export | Via parameter |
| `packages/oidc-session/src/SolidVault.js` | `https://login.inrupt.com` | JSDoc example only | — |

### Key observations

- **No app surfaces a curated multi-issuer picker** apart from Folio
  web's three-option radio.
- **Defaults disagree**: mobile apps + RN substrate default to Inrupt;
  Stoop web defaults to SolidCommunity in its form placeholder.
- **No CSS / self-hosted-server stubs** found in source. To support
  community/self-hosted pods, this is mostly net-new UI + a small
  config layer.
- **DCR support across providers:** verified for Inrupt; the RN
  substrate's DCR helpers should work in principle with any standard
  Solid OIDC issuer (they hit the `/register` endpoint per spec), but
  there's no test against a non-Inrupt server.

---

## 5. Terminology contract (current state + recommendation)

### Current state (locales surveyed: stoop EN/NL, tasks-mobile EN/NL)

| Concept | Dominant term (EN) | Dominant term (NL) | Variants seen |
|---|---|---|---|
| Solid storage / OIDC-attached pod | **Pod** (~50 hits in Stoop, ~15 in Tasks) | **Pod** (kept in English) | "pod provider/aanbieder", "pod root/locatie", "Solid pod" |
| Local identity (mnemonic) | **Account** (onboarding only) | **Account** (onboarding only) | "new/existing account", "Nieuwe/Bestaande account" |
| Ownership / privacy framing | **Your data** | **Jouw data** / **je data** | "data stays yours", "data blijft" |
| Technical pod-root field hint | **Storage** (rare) | **Opslag** (rare) | "control over storage" |
| What stoop avoids | **Cloud** (single negative use) | n/a | "third-party cloud providers" |

### Findings

- **"Pod" is consistent and unambiguous** across EN+NL and across
  surveyed apps.
- **"Account" is intentionally NOT the pod** — it refers to the local
  identity / mnemonic backup. Important distinction; keep it.
- **"Your data" / "Jouw data"** is ownership-framing copy, not a
  competing term. Don't replace "pod" with "data."
- **"Storage", "Cloud", "Opslag"** are too technical / context-loaded
  for general use. Avoid for the pod concept.

### Recommended lock (for the design doc to ratify)

| Concept | Locked term (EN) | Locked term (NL) | Rule |
|---|---|---|---|
| The Solid storage | **Pod** | **Pod** | Same word EN+NL (Pod is a technical term). |
| The user's local backup phrase | **Account** | **Account** | Distinct from Pod; used only in onboarding/restore flows. |
| Ownership framing | "your data" / "jouw data" | as marketing copy | Don't substitute for "Pod" in technical contexts. |
| Banned for the pod concept | (none new) | (none new) | "storage / opslag / cloud / drive" — avoid as a synonym for Pod. |

---

## 6. What migrates vs. what stays (target shape)

| Surface | Disposition | Notes |
|---|---|---|
| `@canopy/oidc-session` (Node) | **Keep, extend** | Multi-issuer config + remove the `DEFAULT_INRUPT_ISSUER`-as-only-hardcoded-default. |
| `@canopy/oidc-session-rn` (RN) | **Keep, extend** | Same. Add issuer-picker hook helper. Optional: DPoP for non-Inrupt providers. |
| `@canopy/pod-client.CapabilityAuth` | **Keep** | Cryptography layer. |
| `@canopy/core.PodCapabilityToken` | **Keep** | Cryptography layer. |
| `apps/folio/src/auth/OidcSession.js` | **Merge** into the Node substrate | Currently a copy in `apps/stoop` too; rule-of-two satisfied. Promote to the shared substrate; drop both wrappers. |
| `apps/stoop/src/lib/OidcSession.js` | **Delete after merge** | Identical copy. |
| `apps/folio/src/server/static/index.html` issuer picker | **Replace** with shared component | Curated provider list + custom URL fallback. |
| `apps/stoop/web/sign-in.html` issuer field | **Replace** with shared component | Same picker; default aligns with the substrate's default. |
| `apps/{folio,stoop,tasks}-mobile/SignInScreen.js` | **Replace** with shared RN picker component | Today: hardcoded Inrupt + invisible override. |
| `apps/folio/src/cli/shareCmd.js` + server `/share` + browser UI | **Keep V0; design V1 alongside ACP-mutation** | The CLI/server stays useful as a power-user surface; the browser UI is the consolidation target. |
| `apps/folio/src/autoShare.js` (`with-<webid>/` convention) | **Keep V0; revisit during ACP-mutation work** | The convention is a clever fold for desktop. Migration target: do the same UX via real Solid ACL writes when the consumer's pod supports ACP. |
| `apps/folio-mobile/src/screens/ShareScreen.js` | **Replace** | Today V0-limited; gets the shared component. |
| `apps/tasks-mobile` bot-token QR codec | **Out of scope** for this track | Skill-scoped, not pod-scoped. Same crypto, different domain. |
| `apps/household/src/identity/AdminCapability.js` | **Out of scope V0** | Bot-pod admin. Mature; revisit if Inrupt-mediated alternatives become useful. |
| `packages/pod-onboarding/src/acpTemplates.js` | **Keep, extend** | Static init-time templates. The Inrupt-ACP-mutation work uses the same templates as the floor and adds per-resource grants on top. |
| `@inrupt/solid-client` ACP mutation primitives | **Add** | Net-new code, not a rewrite. Lands in pod-client (`PodClient.grant({uri, agent, modes})` shape) or in a new `@canopy/solid-sharing` substrate. |

---

## 7. Open questions for the design phase

These get answered in `substrate-design-2026-05-14.md`:

1. **Single substrate vs two:** keep `@canopy/oidc-session` +
   `@canopy/oidc-session-rn` as separate packages (current shape,
   each consumes Inrupt's Node/browser library respectively), or
   collapse to one isomorphic surface? Argument for keeping separate:
   different transitive deps (Node vs Expo). Argument for collapsing:
   identical conceptual surface.

2. **Where does ACP/sharing live?** New substrate
   `@canopy/solid-sharing` (pure ACP/WAC operations against any pod)?
   Or fold into `@canopy/pod-client` as `PodClient.grant(...)`? Or
   into `@canopy/pod-onboarding` (which already owns the templates)?

3. **Curated issuer list:** what providers ship in the default picker?
   - `login.inrupt.com` (Inrupt Pod Spaces) — default
   - `solidcommunity.net` (community)
   - `solidweb.org` (community)
   - `idp.use.id` (Use, community-friendly)
   - Custom URL — power-user option
   - Self-hosted CSS — instructions in docs

4. **DCR with non-Inrupt providers:** the RN substrate's DCR helpers
   work in principle with any spec-compliant Solid OIDC issuer. Confirm
   by test against at least solidcommunity.net before locking the
   feature. (Out-of-band integration test, not a unit test.)

5. **DPoP:** today's "bearer is sufficient" comment is Inrupt-specific.
   Some other Solid servers REQUIRE DPoP. Lock: ship Bearer for V1; add
   DPoP when a real consumer hits a 401 from a non-Inrupt server. Track
   as a known limitation.

6. **Identity portability:** if a user moves from one pod provider to
   another, what survives — webid, contacts, posts, mnemonic? This is a
   bigger product question; out of scope for this track but flag it.

7. **`with-<webid>/` convention in a multi-provider world:** if a
   self-hosted CSS doesn't support the dynamic ACP mutation, does the
   folder convention degrade gracefully (fall back to bespoke
   cap-token) or refuse? Locks during ACP-mutation work.

8. **Cap-token deprecation policy:** with Inrupt-ACP-mediated sharing
   landed, do we keep `PodCapabilityToken` issuance as a power-user
   surface (CLI / API) or remove the *issuance* and leave only
   *consumption* primitives (for backward-compat with already-issued
   tokens)?

9. **Stoop web picker UX:** Stoop web today defaults to
   `solidcommunity.net` (different from Folio). Lock: align on the
   substrate's default (`login.inrupt.com`) or keep Stoop's lean toward
   community pods as a deliberate stance?

---

## 8. Recommended next steps

1. **Design substrate shape** (`substrate-design-2026-05-14.md`):
   answer Q1–Q3 + Q5 + Q7.
2. **Inventory test gap:** validate `@canopy/oidc-session-rn` against
   `solidcommunity.net` (out-of-band; not blocking design).
3. **Timeline decision** (`track-j-plan-2026-05-14.md`): once the
   design substrate's scope is concrete, decide:
   - Should **Tasks V1 implementation plan** wait for the substrate to
     land? (TODO-GENERAL flagged this.)
   - Should **Stoop V3 mobile real-device pass (Phase 40.23)** ship
     before or after the substrate? (Cross-link to memory entry.)
4. Lock the **terminology contract** (§5) — small PR per app to align
   locales.
5. Land the **issuer-picker component** as the first real consumer of
   the consolidated substrate.

---

## Pointers

- TODO-GENERAL.md § "🔴 HIGH — Solid pod / cap-token UX cleanup"
- TODO-GENERAL.md § "🟡 MEDIUM — Default pod issuer flexibility" (the
  multi-issuer half of this work; was a separate TODO entry — fold the
  two together)
- Memory: `project_capability_tokens_to_inrupt.md`
- Memory: `feedback_translatable_by_design.md` (terminology lives in
  locales, doc-field mandatory)
- `Project Files/conventions/architectural-layering.md` (substrate
  separation rules)
- Substrate currently-used:
  `packages/oidc-session/`, `packages/oidc-session-rn/`,
  `packages/pod-client/`, `packages/pod-onboarding/`,
  `packages/agent-provisioning/`
