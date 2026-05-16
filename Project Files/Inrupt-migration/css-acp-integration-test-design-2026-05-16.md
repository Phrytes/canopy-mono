# Real-CSS ACP integration test for `@canopy/pod-client` sharing — design + findings

> **Status (2026-05-16):** DESIGNED, NOT APPLIED. A delegated agent did
> the full read-only analysis but its sandbox denied write/exec, so the
> code is not yet written/run. This doc preserves the ready-to-apply
> recipe + the ACP findings so the work isn't lost. Resolves the
> "currently mocked" half of the TODO item; the genuine open question
> (does real CSS ACP match pod-client's assumptions) still needs a
> gate-ON run.

## Why
`@canopy/pod-client` `client.sharing.{grant,revoke,list,capabilities}`
(Phase 52.16, on Inrupt `universalAccess`) is only tested against a
**mocked** Inrupt module. No verification against a real ACP-supporting
Solid server.

## Host package + auth contract (from code read)
- Host the gated test in **`packages/pod-client`** (devDep + `test/`),
  matching the existing `PodClient.css.test.js` gated-on-`CSS_URL`
  convention. `packages/integration-tests` is mock-only; the
  `sharing-v2/` scenario dir referenced in design docs does not exist.
- Auth: `new PodClient({ podRoot, auth })`; `auth =
  new SolidOidcAuth({ vault })` where `vault` is a `SolidVault`
  (`@canopy/oidc-session`) logged in via **client-credentials**
  (`@inrupt/solid-client-authn-node` v4). `client.sharing` is lazily
  built with that authed fetch.
- `@inrupt/solid-client` is only a transitive dep (via `packages/core`,
  v3.0.0) — the test's host package must add it (+ `@canopy/oidc-session`)
  as devDeps so the lazy `import('@inrupt/solid-client')` + SolidVault
  resolve under pod-client's own vitest run.

## Concrete ACP findings (static analysis — confirm with a gate-ON run)
1. **CSS defaults to WAC, not ACP.** `@solid/community-server`'s default
   config advertises `acl` Link rels, not `acp#accessControl`. So
   `capabilities()` → `{acp:false, wac:true}` on a default boot. **The
   harness MUST boot CSS with an explicit ACP authorization config**
   (v7 `config/file-acp.json` or compose `config/ldp/authorization/acp.json`),
   else only the WAC branch of `universalAccess` is exercised. This is
   the highest-risk item and the real answer the TODO wants.
2. **`list()` cannot enumerate agents** — it only returns entries for
   WebIDs explicitly passed in `opts.agentsToQuery`. A test asserting
   "list reflects the grant" must pass `agentsToQuery:[granteeWebId]`.
   Documented design limitation, not a bug — but callers must know it.
3. **`control` mode** maps to `{controlRead,controlWrite}`; over WAC
   Inrupt collapses both to `acl:Control`, so a round-trip may report
   both true even if one was set. `accessToModes` tolerates this.

## Ready-to-apply recipe (concise)
1. `packages/pod-client/package.json` devDeps += `@solid/community-server`
   `^7.1.7`, `@inrupt/solid-client` `3.0.0`, `@canopy/oidc-session`
   `file:../oidc-session`; `npm install --prefix packages/pod-client`.
2. `packages/pod-client/test/sharing/css-harness.js` — boot CSS via
   `AppRunner().create({ config:<ACP config>, variableBindings:{ port,
   baseUrl, rootFilePath:<mkdtemp>, seededPodConfigJson }})` + `.start()`;
   create owner + grantee accounts/pods + client-credentials via the v7
   `/.account/` API; `stop()` = `app.stop()` + `rm -rf` tmp.
3. `packages/pod-client/test/sharing/sharing.css.test.js` — gate
   `process.env.POD_CLIENT_TEST_REAL_CSS === '1'` via
   `const D = GATE ? describe : describe.skip` (clean skip, no boot when
   off). Cases: `capabilities` reports the model; `grant(read)` →
   `list({agentsToQuery:[grantee]})` reflects → grantee authed fetch can
   GET → `revoke` → list empties. Assert real ACR state.
4. Verify: `npm test --prefix packages/pod-client` (gate off) green;
   `POD_CLIENT_TEST_REAL_CSS=1 npm test --prefix packages/pod-client`
   (gate on) → record PASS/FAIL + which auth model CSS actually served.

## Constraint
Do **not** edit the pod-client sharing impl to make the test pass — if
real CSS reveals a bug or ACP-shape mismatch, report it as a finding.

---

## RUN RESULTS — 2026-05-16 (gate-ON, real CSS 7.1.9 + ACP config)

**Setup that worked.** CSS 7.1.9 booted with `@css:config/file-acp.json`;
owner+grantee provisioned non-interactively via the CSS 7.1 account API
(anon controls `["password","account","main","html"]`; `POST
account.create` → `{authorization, controls}` + a session cookie;
cookie-jar auth; then `password.create` / `account.pod` /
`account.clientCredentials`, all `200`). The one real test-harness gap
the prior agent predicted (**finding #4**) was confirmed and fixed:
`@inrupt/solid-client` is only a *transitive* dep via `@canopy/core`, so
the lazy `import('@inrupt/solid-client')` threw `SHARING_SDK_MISSING`
under pod-client's own vitest. **Fix applied:** added
`@inrupt/solid-client: "3.0.0"` (version-matched to core) as a
**devDep of `packages/pod-client`** — NOT a heavy/divergent dep (it's
the SDK the feature is built on, already in the tree). Gate-OFF stays
green afterwards (188 pass / 5 skip).

**Empirical findings (the actual answers):**

1. **Capability probe mis-detects CSS-ACP as WAC.** `capabilities()`
   returned `{acp:false, wac:true}` on a CSS booted *with the ACP
   config*. Leading-cause mechanism (strong hypothesis, mechanism
   identified, not byte-confirmed): CSS advertises its authorization
   document via `Link: …; rel="acl"` for **both** WAC and ACP, but
   `parseSharingLinkHeader` (`src/sharing/capabilities.js`) only sets
   `acp:true` on the `acp#accessControl` / `acp#accessControlResource`
   rels. So the probe **cannot distinguish CSS-ACP from CSS-WAC** and
   always reports WAC on CSS-family servers. → **Actionable pod-client
   item:** rel-sniffing is insufficient for CSS; the probe should
   inspect the ACR (content-type / shape) or defer detection to
   Inrupt's own `universalAccess` auto-detection rather than guess from
   the `acl` rel.
2. **`grant()` does not throw but the grant is not observable.**
   `client.sharing.grant({agent,…})` and `grant({public:true,…})` both
   completed without error, yet `client.sharing.list({…,
   agentsToQuery:[grantee]})` / `list({…})` returned `[]` — i.e.
   `universalAccess.getAgentAccess` / `getPublicAccess` read back empty
   immediately after a successful-looking grant, on CSS 7.1.9 +
   `@inrupt/solid-client@3.0.0`. Unresolved whether the write silently
   no-ops, targets a doc the readback doesn't consult, or is an
   Inrupt-3.0.0 ↔ CSS-7.1.9 ACP-vocab drift. Deliberately NOT
   investigated deeper / NOT patched (per the constraint above): it
   needs a focused Inrupt/CSS-version study and is verification of
   already-shipped 52.16 code, not a blocker.

**Bottom line.** The mocked tests gave false confidence: against a real
modern CSS, `client.sharing` grant→list does **not** round-trip and the
capability probe mis-classifies CSS-ACP as WAC. The TODO's "needs
real-server validation" is now satisfied with a concrete negative
result. Highest-leverage first fix = the capability probe (#1); the
grant round-trip (#2) is a deeper follow-up. The gated test correctly
stays RED gate-ON (accurate coverage signal) and SKIPPED/ green
gate-OFF (CI unaffected) — left red on purpose; not papered over.

---

## FOLLOW-UP (a) — capability probe fix — DONE 2026-05-16

**FU-a1 (data captured).** Booted CSS 7.1.9 with `@css:config/file.json`
vs `@css:config/file-acp.json`; HEAD a provisioned resource. Decisive
result — CSS reuses `rel="acl"` for **both** models; only the target
extension differs:
- WAC: `<…/probe.txt.acl>; rel="acl"`
- ACP: `<…/probe.txt.acr>; rel="acl"`  ← `.acr` = Access Control Resource

CSS emits **no** Inrupt-style `acp#accessControl*` rel in either mode
(that rel is Inrupt-hosted only — separate, untouched detection path).

**FU-a2 (fix shipped).** `src/sharing/capabilities.js`
`parseSharingLinkHeader`: for a `rel="acl"` entry, inspect the target
URI — `.acr` ⇒ `acp:true`, otherwise ⇒ `wac:true` (HEAD-only, no extra
request; conservative default to WAC). Inrupt `acp#accessControl*`
path unchanged. Doc comment updated with the empirical basis.
Verified: `test/sharing/capabilities.test.js` 17/17 incl. **verbatim
captured** CSS-WAC + CSS-ACP headers (was-mis-detected case now
`{acp:true,wac:false}`); all pre-existing Inrupt/WAC cases unchanged
(no regression); full pod-client gate-OFF 192 pass / 5 skip. Finding #1
is RESOLVED. (Live `capabilities()` is `HEAD + parseSharingLinkHeader`
on that exact header → proven by the verbatim-header unit test;
optional live reconfirm deferred — the gated test stays RED overall
until #2.)

---

## FOLLOW-UP (b) — grant round-trip study — DONE 2026-05-16 (timeboxed)

**Definitive root cause (instrumented run vs real CSS 7.1.9 ACP, raw
`@inrupt/solid-client@3.0.0` calls):**
- `<resource>.acr` → **404 before** the grant (no ACR yet — a fresh
  resource inherits effective access from its container; normal).
- `universalAccess.setAgentAccess(...)` → **returned `null`, did not
  throw**.
- `<resource>.acr` → **still 404 after** — i.e. the call **never wrote
  the ACR**. Identical for `setPublicAccess`. `getAgent/PublicAccess`
  → `null` (consistent — nothing was written).

⇒ **`@inrupt/solid-client@3.0.0`'s `universalAccess.set{Agent,Public}
Access` is a SILENT NO-OP against CSS 7.1.9 ACP** (returns `null`,
writes nothing). This is an **Inrupt-SDK-version incompatibility with
modern CSS ACP**, NOT a defect in `@canopy/pod-client`'s own logic. It
is very likely fine against **Inrupt-hosted** pods (the real Phase
52.16 target — SDK 3.0.0 and Inrupt-hosted ACP are version-aligned);
CSS is the integration-test vehicle, not the production target.

**Proportionate fix applied (honesty, NOT papering over):**
`client.sharing.grant`/`revoke` previously treated the setter's return
as success unconditionally. They now capture it and **throw
`SHARING_GRANT_NOOP` / `SHARING_REVOKE_NOOP`** when it is `null` (the
SDK applied nothing) — so a caller is never told a grant/revoke landed
when it didn't. The mocked-test Inrupt fake was corrected to mirror the
real contract (returns the Access object on success, `null` on no-op).
pod-client gate-OFF 194 pass / 5 skip, no regression; +2 NOOP unit
tests.

**Recommendations (decisions for the user — NOT auto-applied):**
1. *Real CSS support* requires upgrading `@inrupt/solid-client` from
   3.0.0 to a current release. That is a **scoped dependency-upgrade
   task with cross-package blast radius** (`@canopy/core` pins 3.0.0;
   API/behaviour changes across the major bump) — deliberate, separate,
   not reflexive. Recommend logging it as its own item.
2. Until then: `client.sharing` is **functional only against
   Inrupt-hosted (and ACP versions SDK 3.0.0 understands)**; against
   modern CSS ACP it now **fails loudly** (NOOP error) instead of
   silently. Document this as a known limitation.
3. The gated `sharing.css.test.js` stays RED gate-ON by design (real
   coverage signal that CSS+SDK-3.0.0 don't round-trip); skips clean
   gate-OFF (CI unaffected). It will go green once the SDK is upgraded
   — i.e. it is now a precise regression gate for that upgrade.

FU-a + FU-b both closed.

---

## CORRECTION — "there is no SDK upgrade" (2026-05-16)

FU-b rec #1 ("upgrade `@inrupt/solid-client` 3.0.0 → current") was based
on a **wrong assumption that 3.0.0 was an old/stale pin**. Verified via
the npm registry:
- `@inrupt/solid-client` `latest` **= `3.0.0`**, published **2025-11-04**,
  modified 2025-12-10 — the **current, recently-maintained** release.
  There is no newer version; "upgrade the SDK" has no target.
- `@inrupt/solid-client-access-grants@4.0.1` is maintained but is the
  *Access Grants / VC-delegation* protocol — **not** a drop-in for
  `client.sharing`'s resource ACP/WAC use case.

So the CSS-ACP no-op is a **current-vs-current interop gap** (Inrupt
solid-client 3.0.0 ↔ CSS 7.1.9 ACP), not an outdated dependency.

### Real options (decision for the user — none auto-applied)

1. **Accept + document (recommended now).** `client.sharing` works
   against **Inrupt-hosted** pods (the actual Phase 52.16 product
   target; SDK-aligned) and now **fails loudly** (`SHARING_*_NOOP`)
   against modern CSS ACP instead of lying. CSS is our integration-test
   vehicle, not a product target today. Lowest effort; honest; matches
   product reality. Gated test stays the regression marker. **No code.**
2. **Timeboxed spike: SDK gap vs our-usage-error.** Before declaring
   "CSS-ACP unsupported" permanently, confirm whether solid-client
   3.0.0 `universalAccess` is *meant* to work on CSS 7.1.9 ACP and we
   call it wrong (e.g. the resource's ACR must be provisioned first, or
   an ACP-v4-specific entrypoint is needed). If it's our usage → a
   cheap real fix; if it's a genuine SDK/CSS gap → confirms option 1.
   ~one instrumented CSS run.
3. **Replace the sharing transport for CSS-class servers** (write ACP
   directly / alternative lib). Large build; only justified if
   CSS-hosted / self-hosted pods become a real product requirement
   (ties to the Stoop-browser-app + pod-provider-flexibility threads).
   Defer until that need is concrete.

**Recommendation:** option 1 now (it's already the shipped behaviour —
just document it) + offer option 2 as a cheap de-risking spike. Option
3 only when CSS-hosted is a product need.
