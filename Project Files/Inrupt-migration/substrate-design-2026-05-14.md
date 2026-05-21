# Solid-auth + sharing consolidation — substrate design (2026-05-14)

> Companion to `pod-auth-inventory-2026-05-14.md`. Answers the 9 open
> questions from §7 of the inventory + lays out the recommended
> substrate shape.
>
> **Naming note:** the saved memory uses "Track-J" but that's old
> taxonomy. This work lives in the **Phase 52 sequence** alongside the
> other substrate restructure. Proposed phase numbers below; final
> ratification happens in `track-j-plan-2026-05-14.md` (filename keeps
> "track-j" for memory continuity but the phases use 52.x).

## TL;DR (recommended decisions)

1. **Keep the two-package shape** (`@canopy/oidc-session` Node +
   `@canopy/oidc-session-rn` RN). Different transitive deps justify
   it. Add a small **shared types/interface module** that both packages
   implement so apps target the interface, not the implementation.
2. **ACP/WAC sharing lives in `@canopy/pod-client`** as new
   `client.sharing.{grant, revoke, list}` methods. Net-new code (Inrupt
   ACP primitives aren't called anywhere today). Don't create a third
   substrate.
3. **Curated issuer list** ships as `KNOWN_ISSUERS` export from the
   auth substrate. Default ranking: Inrupt → solidcommunity.net →
   custom URL. Apps can override / extend.
4. **DCR** is shipped as today; non-Inrupt providers tested out-of-band
   in V1.1. No code change required; flag the limitation in README.
5. **DPoP** deferred to V1.1 behind a feature flag. Bearer is sufficient
   for V1 against all three default providers.
6. **Identity portability** explicitly out of scope.
7. **`with-<webid>/` convention** keeps cap-token mode for V1; gets an
   `acp` mode for V1.5 when consumers exist on ACP-supporting pods.
8. **Cap-token deprecation policy:** keep ISSUANCE for power-user CLI +
   bot/admin scope (Tasks-mobile, Household); the *default* user-facing
   share UX flips to ACP-mediated sharing.
9. **Stoop web default** aligns to `login.inrupt.com` (matching the
   substrate default + every other app). The picker still offers
   community options.

**Proposed Phase numbering:**
- **Phase 52.15 — Auth consolidation.** Multi-issuer support +
  substrate promotion of `OidcSession.js` wrappers + issuer-picker
  component (web + RN) + terminology lock.
- **Phase 52.16 — Sharing v2 (ACP-mediated).** `pod-client.sharing.*`
  methods + Folio adoption + `with-<webid>/` `acp` mode.

Estimate: 52.15 ≈ 4 days; 52.16 ≈ 5 days. **Critical path for new
apps:** 52.15 should land before Tasks V1 / Household V2 add new
sign-in UX (per the TODO-GENERAL flag). 52.16 can ship after the new
apps are out — they don't need it on day one.

---

## 1. Origin + scope lock

### In scope
- Multi-issuer support across all apps' sign-in flows.
- Substrate promotion of `OidcSession.js` wrappers (rule-of-two
  satisfied — Folio + Stoop both copy-paste).
- Locked terminology contract for "Pod" / "Account" / "your data"
  across locales.
- ACP/WAC primitives in `pod-client` (`grant`, `revoke`, `list`).
- Folio's share UX gets a V2 path on top of ACP/WAC.

### Out of scope (V1)
- DPoP (deferred V1.1).
- Identity portability (move-pod-providers UX).
- Bot/admin cap-token surfaces in Tasks-mobile + Household (different
  domain — skill-scope, not pod-scope).
- A new top-level substrate package. The auth surfaces stay in the
  two existing oidc-session packages; sharing lands inside pod-client.

### Decided trade-offs

- **Two packages over one isomorphic:** chose to keep
  `@canopy/oidc-session` and `@canopy/oidc-session-rn` separate.
  Their transitive deps diverge significantly (`@inrupt/solid-client-authn-node`
  vs `expo-auth-session` + `expo-web-browser` + `expo-secure-store`),
  and the test-runner story gets cleaner when the Expo deps live in
  the RN-only package. Conceptual unity comes from a shared interface
  (see §2.2).

- **Sharing inside pod-client over a new substrate:** apps that need
  ACP/WAC already construct `PodClient`. Adding `client.sharing.*`
  methods avoids a third substrate to wire up, and the methods *are*
  Solid HTTP operations — exactly what pod-client is for. Folio's
  `with-<webid>/` auto-share convention stays in Folio (UX over the
  substrate primitive, not a substrate itself).

- **Cap-token issuance survives:** the cryptography is sound (per saved
  memory) and bot/admin use cases need it. We change which surface is
  the **default** for "share a resource with a user."

---

## 2. Auth substrate shape

### 2.1 The two packages

| Package | Runtime | Wraps | Stays as |
|---|---|---|---|
| `@canopy/oidc-session` | Node | `@inrupt/solid-client-authn-node` | Server-side substrate |
| `@canopy/oidc-session-rn` | React Native | `expo-auth-session` + `@inrupt/solid-client-authn-browser` (via the WebView callback) | RN-side substrate |

Both expose the same conceptual API; both target the shared interface
in §2.2.

### 2.2 Shared interface (typedef, lives in `@canopy/oidc-session`)

```js
/**
 * SolidAuth — the conceptual interface both auth substrates implement.
 *
 * @typedef {object} SolidAuth
 * @property {(opts: SignInOpts) => Promise<Session>}  signIn
 * @property {(callbackUrl: string) => Promise<Session>} handleCallback
 * @property {() => Promise<Session | null>}           restore
 * @property {() => Fetch}                             getAuthenticatedFetch
 * @property {() => Promise<void>}                     refresh
 * @property {() => Promise<void>}                     logout
 * @property {(event, cb) => () => void}               on
 *   // events: 'authenticated', 'refreshed', 'expired', 'logged-out'
 *
 * @typedef {object} SignInOpts
 * @property {string} issuer       — issuer URL (one of KNOWN_ISSUERS or custom)
 * @property {string} redirectUrl  — OAuth callback URL
 * @property {string} [clientName] — display name shown on consent screen
 *
 * @typedef {object} Session
 * @property {string} webId
 * @property {string} issuer
 * @property {number} expiresAt
 * @property {string} idToken      — opaque; redacted in logs
 */
```

`@canopy/oidc-session-rn` re-exports the same typedef (single
source of truth in the Node package; the RN package depends on it).

### 2.3 New shared exports

In `@canopy/oidc-session` (and re-exported from `@canopy/oidc-session-rn`):

```js
export const KNOWN_ISSUERS = [
  {
    id:        'inrupt',
    url:       'https://login.inrupt.com',
    label:     'Inrupt Pod Spaces',
    capabilities: { dcr: true, acp: true, dpop: false },
  },
  {
    id:        'solidcommunity',
    url:       'https://solidcommunity.net',
    label:     'SolidCommunity.net',
    capabilities: { dcr: true, acp: 'unknown', dpop: 'unknown' },
  },
  {
    id:        'solidweb',
    url:       'https://solidweb.org',
    label:     'SolidWeb.org',
    capabilities: { dcr: true, acp: 'unknown', dpop: 'unknown' },
  },
];

export const DEFAULT_ISSUER_ID = 'inrupt';

/** Resolve `KnownIssuer` from id or accept a custom URL. Validates
 *  shape; returns `null` on invalid input. */
export function resolveIssuer(idOrUrl) { ... }
```

`KNOWN_ISSUERS[0]` is the default; apps that want a different default
override via `app.config.defaultIssuerId = '...'` or pass directly to
`auth.signIn({issuer})`.

### 2.4 Substrate-promotion of `OidcSession.js`

`apps/folio/src/auth/OidcSession.js` and
`apps/stoop/src/lib/OidcSession.js` are byte-near-identical (Stoop's
copy says "Phase 20 lifted from Folio"). Promote to:

```js
// packages/oidc-session/src/createSolidAuthNode.js
export function createSolidAuthNode({ vault, clientName, redirectUrl }) {
  // Vault keys: `solid-oidc:<webid>:*` (already in SolidVault)
  // Returns a SolidAuth-shaped object.
}
```

Apps drop their `OidcSession.js` wrappers and call
`createSolidAuthNode({vault: bundle.vault, clientName: 'Folio'})`.

RN equivalent already exists as `OidcSessionRN` from
`@canopy/oidc-session-rn`; just remove the per-app re-export shims
(`apps/folio-mobile/src/auth/OidcSessionRN.js` etc.) by inlining the
`appId: 'folio'` pre-binding at the call site or via a thin factory in
the substrate.

### 2.5 Issuer-picker component

Two flavours:

**Web (Node/server-rendered):** static-HTML component shipped from the
auth substrate as `getIssuerPickerHtml({selectedId, customAllowed: true})`.
Returns a string of `<fieldset>...</fieldset>` HTML. Apps' sign-in
templates `${getIssuerPickerHtml(...)}` it in.

**React Native:** `<IssuerPicker>` component shipped from
`@canopy/oidc-session-rn/picker` (subpath, like `/hook` already).
Props: `value`, `onChange`, `customAllowed`, `style`. Renders a
horizontally-scrollable list of provider chips + a "Custom URL" option
that expands an inline text input.

Both default to `customAllowed: true` and render Inrupt first.

### 2.6 DCR + DPoP

- **DCR:** RN substrate already does it. Validation against
  `solidcommunity.net` is an integration-test task — out-of-band, not
  blocking.
- **DPoP:** explicit non-goal for V1. The substrate's session interface
  doesn't expose DPoP-specific knobs. V1.1 adds an opt-in: `signIn({issuer,
  redirectUrl, dpop: true})`. Until then, all sign-in is Bearer.

---

## 3. Sharing v2 (ACP/WAC inside pod-client)

### 3.1 New `client.sharing.*` surface

```js
const client = new PodClient({ podRoot, auth });

await client.sharing.grant({
  resourceUri: 'https://anne.pod/notes/x.ttl',
  agent:       'https://bob.pod/profile#me',
  modes:       ['read', 'append'],   // 'read' | 'append' | 'write' | 'control'
});

await client.sharing.revoke({ resourceUri, agent });

const shares = await client.sharing.list({ resourceUri });
// → [{ agent: '...', modes: ['read'], ... }, ...]

// Public access:
await client.sharing.grant({ resourceUri, public: true, modes: ['read'] });
```

Group + bulk-grant variants:

```js
await client.sharing.grant({
  resourceUri, group: 'https://anne.pod/groups/family#group', modes: ['read'],
});

// Container-wide grant (applies to children via ACR inheritance):
await client.sharing.grant({
  containerUri: 'https://anne.pod/shared/', agent, modes,
});
```

### 3.2 Implementation

- Lazily loads `@inrupt/solid-client` (already a transitive dep,
  loaded today for RDF patching).
- Internally: read current ACR → modify policies/matchers → write
  back atomically (Inrupt SDK supports the round-trip).
- Falls back gracefully when the pod doesn't support ACP — exposes
  `client.sharing.capabilities()` which returns
  `{ acp: boolean, wac: boolean }` after a HEAD probe.
- On non-ACP pods, throws `SharingUnsupportedError`. Caller decides
  whether to fall back to cap-token issuance.

### 3.3 Folio adoption

Folio's CLI/server/auto-share gets a `mode: 'cap-token' | 'acp'` switch
(default depends on `client.sharing.capabilities()`). UX-side:

- **`folio share <path>`** — runs ACP grant by default if pod
  supports it; falls back to cap-token. Output reflects what was
  issued.
- **Server `/share`** — same.
- **Browser share pane** — same. Recent-shares list shows the mode
  ("cap-token" / "ACP grant").
- **`with-<webid>/` auto-share** — adds an `acp` mode that issues real
  ACP grants instead of cap-tokens. Tied to provider capability
  detection.

Folio-mobile ShareScreen gets the same switch.

### 3.4 Cap-token issuance stays where it makes sense

- **Tasks-mobile bot-token QR:** skill-scope, not pod-scope. Out of
  scope.
- **Household admin pod-token:** full `pod.*:/` for co-admin access to
  the bot's pod; bots aren't really "sharing with a user" — they're
  delegating ownership. Out of scope V1.
- **Folio CLI power-user mode:** keep cap-token issuance as
  `folio share --mode cap-token` for the "I want a token I can send
  out-of-band" use case.

---

## 4. Terminology lock (ratified)

Confirmed contract — small PR per app to align locales:

| Concept | Locked EN | Locked NL | Rule |
|---|---|---|---|
| Solid storage / OIDC-attached pod | **Pod** | **Pod** | Same word both languages; technical term. |
| Local identity / mnemonic recovery | **Account** | **Account** | Distinct from Pod; onboarding/restore only. |
| Ownership framing | "your data" / "jouw data" | as marketing copy | Don't substitute for Pod in technical contexts. |
| What we avoid (negative framing) | "third-party cloud" | "cloud" | Only in privacy section, not for the Pod concept. |
| **Banned** as Pod synonyms | "storage", "drive", "cloud", "your data" (in technical contexts) | "opslag", "schijf", "cloud", "jouw data" (in technical contexts) | — |

Implementation: a `locales-audit` script that fails CI when banned
substitutions appear in `*.json` keys describing the Pod concept.
Lives in `Project Files/conventions/localisation.md` per the
translatable-by-design memory.

---

## 5. Migration plan (Phase 52.15 + 52.16)

### Phase 52.15 — Auth consolidation (~4 days)

| # | Task | Files |
|---|---|---|
| 52.15.1 | Add `KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer()` exports + shared `SolidAuth` typedef. | `packages/oidc-session/src/issuers.js`, `packages/oidc-session/index.js` |
| 52.15.2 | `createSolidAuthNode({vault, clientName, redirectUrl})` — promote `OidcSession.js` from apps/folio + apps/stoop. | `packages/oidc-session/src/createSolidAuthNode.js` |
| 52.15.3 | Drop `apps/folio/src/auth/OidcSession.js` + `apps/stoop/src/lib/OidcSession.js`. Update call sites. | `apps/{folio,stoop}/**` |
| 52.15.4 | `getIssuerPickerHtml()` web component + adoption in Folio + Stoop sign-in pages. Default + curated list. | `packages/oidc-session/src/issuerPickerHtml.js`, `apps/folio/src/server/static/*.html`, `apps/stoop/web/sign-in.html` |
| 52.15.5 | `<IssuerPicker>` RN component + adoption in folio-mobile + stoop-mobile + tasks-mobile SignInScreens. | `packages/oidc-session-rn/src/picker/`, `apps/{folio,stoop,tasks}-mobile/src/screens/SignInScreen.js` |
| 52.15.6 | Lock terminology — small per-app locale fixes + `locales-audit` script + CI hook. | `apps/*/locales/*.json`, `Project Files/conventions/localisation.md` |
| 52.15.7 | Tests: KNOWN_ISSUERS export shape; createSolidAuthNode round-trip with `FOLIO_TEST_MOCK_POD`-style fixture; IssuerPicker renders provided list. | `packages/oidc-session/test/**`, `packages/oidc-session-rn/test/picker/**` |
| 52.15.8 | README updates + cross-link to inventory + design docs. | `packages/{oidc-session,oidc-session-rn}/README.md` |

**Acceptance:** every app uses the same issuer picker shape; defaults
all point at Inrupt; users can switch to solidcommunity.net /
solidweb.org / custom; terminology audit script passes CI.

### Phase 52.16 — Sharing v2 (~5 days)

| # | Task | Files |
|---|---|---|
| 52.16.1 | `client.sharing.{grant, revoke, list, capabilities}` API. ACP-via-Inrupt-SDK impl. | `packages/pod-client/src/sharing/**` |
| 52.16.2 | `SharingUnsupportedError` + capability probe. | `packages/pod-client/src/sharing/capabilities.js` |
| 52.16.3 | Folio CLI + server `/share` adopt the new API. `--mode cap-token \| acp` flag. | `apps/folio/src/{cli,server}/**` |
| 52.16.4 | Folio browser Share pane adopts the new API. UX shows mode used. | `apps/folio/src/server/static/share.{js,html}` |
| 52.16.5 | Folio auto-share `with-<webid>/` gets `acp` mode. Capability-detection at sync time. | `apps/folio/src/autoShare.js` |
| 52.16.6 | folio-mobile ShareScreen adopts new API (when engine.identity is present; falls back to cap-token issuance otherwise). | `apps/folio-mobile/src/screens/ShareScreen.js` |
| 52.16.7 | Tests: ACP grant/revoke/list round-trip against a mock pod; capability-probe; fall-back paths. | `packages/pod-client/test/sharing/**` |
| 52.16.8 | Integration: pod-having Folio test that creates a `with-<webid>/` folder + verifies the share is ACP-mediated. | `packages/integration-tests/test/scenarios/sharing-v2/**` |

**Acceptance:** Folio's share UX defaults to ACP-mediated grants when
the pod supports it; falls back to cap-token cleanly when not; legacy
issued cap-tokens remain valid (consumer-side verification unchanged).

---

## 6. Apps that wait vs apps that proceed

| App | Status | Action |
|---|---|---|
| `apps/tasks-mobile` | Has hardcoded Inrupt sign-in today. Tasks V1 implementation plan flagged as "shouldn't ship before Inrupt cleanup is at least scoped." | **Wait for 52.15** to land before adding any new sign-in surface. Tasks V1 features unrelated to sign-in can proceed. |
| `apps/household-v2` | Designed but largely unbuilt. | **Wait for 52.15** before designing the user's sign-in UX. |
| `apps/folio`, `apps/folio-mobile` | Has the most surface area. | Adopt 52.15 AND 52.16. The auto-share migration is the load-bearing test. |
| `apps/stoop`, `apps/stoop-mobile` | Has sign-in but no sharing surface yet. | Adopt 52.15. Sharing isn't needed yet. |
| `apps/tasks-v0`, `apps/archive` | Backend / legacy. | No-op. |

---

## 7. Open decisions to ratify before implementation

These are the calls I made in the recommendations above; mark
agree/disagree to lock the design:

1. **Two packages over one isomorphic** — chose to keep
   `@canopy/oidc-session` + `@canopy/oidc-session-rn` separate.
2. **Sharing inside pod-client** rather than a new
   `@canopy/solid-sharing`.
3. **Curated issuer list with Inrupt default + community providers**;
   custom URL always allowed.
4. **DPoP deferred to V1.1.**
5. **`with-<webid>/` gets a mode switch** rather than wholesale rewrite.
6. **Cap-token issuance stays for power-user + bot/admin scope**;
   default user-facing share UX flips to ACP.
7. **Stoop web default flips** from `solidcommunity.net` to
   `login.inrupt.com` (substrate default).
8. **Phase numbering 52.15 (auth) + 52.16 (sharing).**
9. **`KNOWN_ISSUERS` initial list:** Inrupt + solidcommunity.net +
   solidweb.org. Don't ship `idp.use.id` in V1 (less mature; can be
   added once tested).

---

## 8. Risks + known unknowns

- **`@inrupt/solid-client` ACP API surface** — current dep version is
  3.0.0 (`packages/core/package.json`); verify the ACP-mutation
  primitives we need are stable in that version before kicking off
  52.16. (Likely fine — Inrupt ships these as stable in v2+.)
- **CSS server ACP support** — community Solid servers may implement
  WAC rather than ACP; `sharing.capabilities()` needs to detect both
  and the API needs to handle "ACP-only feature requested on WAC pod"
  gracefully. Tracked as 52.16.x acceptance criterion.
- **DCR against `solidcommunity.net`** — RN substrate's DCR helpers
  should work, but no test confirms it. **Validate during 52.15.1**
  before relying on the picker affordance for non-Inrupt providers.
- **Token store conflict on shared-device install** — if a user
  installs Folio-mobile AND Stoop-mobile on the same device with the
  same WebID, today they have separate SecureStore namespaces by
  `appId`. That's intentional (per-app independence). If we ever want
  shared sign-in across the app family, that's a separate design.

---

## 9. Pointers

- Inventory: `pod-auth-inventory-2026-05-14.md`
- Saved memory: `project_capability_tokens_to_inrupt.md` (origin of
  the "Track-J" label; preceded the Phase 52 restructure)
- Existing substrates:
  - `packages/oidc-session/` (Node)
  - `packages/oidc-session-rn/` (RN)
  - `packages/pod-client/` (Solid HTTP)
  - `packages/pod-onboarding/` (init-time ACP templates)
- Standardisation context:
  `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
  (where Phase 52.1–52.14 live; 52.15 + 52.16 extend the sequence)
- Translatable-by-design rule:
  `Project Files/conventions/localisation.md` (terminology audit
  script lands here)
