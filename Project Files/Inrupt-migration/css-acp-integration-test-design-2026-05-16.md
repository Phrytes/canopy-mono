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
