# Slice G — Folio Boundary Audit (2026-05-20)

Three parallel read-only audits on folio's relationship to the
substrate stack. Folio is the only canopy-mono app with a documented
"Direct SDK use" section (the canonical layer-escape pattern) and the
pattern-source for `@canopy/sync-engine`.

| Audit | Scope                           | Status |
| ----- | ------------------------------- | ------ |
| G.1   | `apps/folio/` layering          | done   |
| G.2   | `apps/folio-mobile/` layering + parity | done   |
| G.3   | `@canopy/sync-engine` substrate boundary | done   |

## Headline

**No structural boundary violations.** What the audit surfaced is
**documentation drift** — three recent substrate adoptions (Phase D
pseudo-pod, Phase 52.15.2 oidc-session, Phase 52.x sync-engine-rn) have
shipped to production but their README justifications haven't caught
up. Plus one minor substrate enhancement: `SyncEngine.isWatching`
getter (no consumer change required — folio's existing `__watching`
intent flag stays).

The Folio ⇄ sync-engine relationship is healthy: subclass is thin
(constructor hook-injection only, zero method overrides), all
post-Phase-5.1 substrate additions are opt-in with safe defaults, and
the web⇄mobile parity for the core surfaces (sync / watch / status /
share / conflicts / version-history) is in place.

---

## G.1 — apps/folio findings

### Imports drift since README revision

Folio's README documents 1 substrate (`@canopy/sync-engine`) and 4
direct SDK uses (`@canopy/core` × 4 + `@canopy/pod-client` × 1).
Actual imports surface 3 additional adoptions that the README hasn't
caught up to:

| Adoption | Phase | Files | Verdict |
| --- | --- | --- | --- |
| `@canopy/pseudo-pod` (cache-mode) | Phase D, 2026-05-16 | `podCache.js`, `_podFactory.js` | Substrate use. Should be added to "Substrates" table. |
| `@canopy/sync-engine-rn` | Phase 52.x | `src/rn/serviceFactory.js`, `backgroundTasks.js` | Substrate use for RN platform (consumed by folio-mobile). Should be added to "Substrates" table. |
| `@canopy/oidc-session` (`createSolidAuthNode`) | Phase 52.15.2, 2026-05-14 | `serveCmd.js`, `diagnostics.js` | SDK-direct. Should be added to "Direct SDK use" table. README narrative mentions it but the table doesn't list it. |
| `@canopy/core::AgentIdentity` | (long-standing) | `routes.js` (line ~920, `/share` POST) | SDK-direct, consistent with existing `Bootstrap` / `VaultNodeFs` rationale. Add to "Direct SDK use" table or consolidate the `@canopy/core` row. |

### SyncEngine subclass — thin

`apps/folio/src/SyncEngine.js` (~50 lines) is a proper thin subclass.
It passes 3 hooks into `super()`:

- `parseSharePath` — recognizes `with-<webid>/` folder convention
- `applyConflictHook` — writes git-style `<<<<<<< MINE` markers
- `ensureSharesHook` + `listSharesHook` — auto-share token lifecycle

Each is markdown / folio-specific glue with no substrate-level analog.
**Zero method overrides.** The substrate's hook-injection contract is
exercised exactly as intended.

### Multi-pod boundary

Folio is the only multi-pod app (own pod + shared `with-<webid>/`
folders via `PodCapabilityToken`). Reviewed `autoShare.js` (540 lines)
+ `routes.js`. Observations:

- `PodCapabilityToken` correctly SDK-direct (semantics are foundational,
  not substrate-wrappable).
- ACP grant path (Phase 52.16.5) is decorator-style — folio injects a
  `.sharing` method onto PodClient when the server supports ACP;
  substrate (sync-engine) stays ACP-agnostic. Clean.
- PathMap multi-pod awareness is honoured (`pathMap.localToPod(...)`
  with fallback). No leakage.

### Action items (P1)

1. README refresh: add `@canopy/pseudo-pod` + `@canopy/sync-engine-rn`
   to "Substrates"; add `@canopy/oidc-session` + `AgentIdentity` to
   "Direct SDK use".
2. README clarification at line 120-121: `createClientSharing` is not
   imported directly; the sharing capability is method-on-PodClient.

---

## G.2 — apps/folio-mobile findings

### Imports drift

| Adoption | Files | Verdict |
| --- | --- | --- |
| `@canopy/react-native/pseudo-pod-adapter` | `ServiceContext.js:284` (dynamic + feature-flagged) | Phase 3 OQ-6 optional caching, gated on `FOLIO_PSEUDO_POD` env. Not documented in README. P0 from G.2 — should be added with the feature-flag context. |

All other imports (`@canopy/sync-engine-rn`, `@canopy/oidc-session-rn`,
`@canopy-app/folio`, `@canopy/core::PodCapabilityToken`,
`@canopy/react-native`) are documented and accurate.

### Single-agent rule

Confirmed: no mesh transport imports. Folio-mobile remains pod-only
per the convention; the `ONE core.Agent per service-context` rule is
satisfied trivially.

### App-app dependence

`@canopy-app/folio` import is clean: only `SyncEngine` (aliased
`FolioSyncEngine`), with inline justification citing the layering
doc's platform-shell exception. Minimal surface, intentional naming.

### Web ⇄ mobile parity

| Capability                | Desktop | Mobile | Status |
| ------------------------- | :-----: | :----: | --- |
| Sign-in                   |   ✅    |   ✅   | Different auth model (mnemonic vs OIDC) — intentional |
| Sync (one-shot)           |   ✅    |   ✅   | Parity |
| Watch (continuous)        |   ✅    |   ✅   | Mobile uses background-fetch (OS best-effort); desktop is CLI watcher. Per-design difference. |
| Status                    |   ✅    |   ✅   | Parity |
| Conflicts (detect+resolve)|   ✅    |   ✅   | Mobile adds interactive three-way merge UI |
| Share (issue cap token / ACP) | ✅  |   ✅   | Identical fallback chain (ACP → cap-token) |
| Version history + restore |   ✅    |   ✅   | Parity, landed 2026-05-18 (commit `61981f8`) |
| Diagnostics               |   ✅    |   ✅   | Mobile skips non-applicable steps (e.g. service install) |
| Force re-push             |   ✅    |   ✅   | Parity |
| **Receive cap token**     |   ✅    |  ⚠️    | **Mobile lacks inbound flow** — documented as v0 limitation |
| **File deletion UI**      |   ✅    |  ⚠️    | **Mobile lacks delete affordance** — documented as v0 deferred |
| **`engine.verifyPodState`**|  ✅    |  ⚠️    | RN engine may not expose; diagnostics gracefully skips. Verify and either wire or document why. |

### Action items

- **P0** — README: add `pseudo-pod-adapter` row to "Direct SDK use".
- **P1** — Verify `engine.verifyPodState` availability on RN
  SyncEngine; either wire the mobile diagnostics step or document the
  skip in the code comment.
- **P2** — Track inbound cap-token + file-deletion mobile surfaces in
  the Folio v2 plan (documented v0 gaps).

---

## G.3 — @canopy/sync-engine boundary findings

### Substrate exports — all consumed

Every export from `packages/sync-engine/src/index.js` has a real
consumer (folio, folio-mobile, or tasks-mobile / stoop-mobile via
`@canopy/sync-engine-rn`). No dead exports. Internal helpers
(`DEBOUNCE_MS`, `_clearVersionsCache`, `_pathSep`) are
test-only / module-internal — correctly NOT in the public barrel.

### Post-Phase-5.1 additions — all Folio-driven, all opt-in

Five substantive additions since the 2026-05-04 substrate lift:

| Feature | Driver | Opt-in? |
| --- | --- | :-: |
| `watcher.stableMs` / `watcher.maxStableWaitMs` (sha-stable hardening, v2.6) | Folio (editor-atomic-save false positives) | ✅ defaults |
| `watcher.graceMs` (copy-rename grace, v2.10) | Folio (avoid pushing `A (Copy).md`) | ✅ defaults |
| `setPodClient()` + `pod-client-swapped` event (v2.1) | Folio web/mobile (sign-in mid-session) | ✅ optional |
| `identity` + `setIdentity()` + `shares()` (Q-Folio.3) | Folio auto-share | ✅ defaults no-op |
| `versions` constructor param + lifecycle methods (Folio.B4) | Folio time-machine | ✅ defaults no retention |

Pattern is consistent: substrate accepts optional hook / param;
defaults are inert; other consumers (stoop-mobile, tasks-mobile)
inherit the surface without configuring it. No substrate-as-pseudo-app
smell.

### sync-engine ↔ sync-engine-rn split — clean

| Concern | Lives in |
| --- | --- |
| Cross-platform sync logic | `@canopy/sync-engine` |
| Node fs / hash / watcher adapters | `@canopy/sync-engine/adapters/*Node.js` |
| RN fs / hash / watcher adapters | `@canopy/sync-engine/adapters/*RN.js` |
| RN bootstrap + background-fetch bridge | `@canopy/sync-engine-rn` |
| React hooks (skill invocation) | `@canopy/sync-engine-rn/react` |

sync-engine-rn imports from sync-engine; never the reverse. No
circular deps.

### Substrate boundary smell (clarified)

G.3 initially flagged `apps/folio/src/server/wsHub.js:71` reading
`this.#engine.__watching` as a private-field violation. **Re-checked:
not a bug.** `__watching` is folio's app-side property set explicitly
by `serveCmd.js:110` + maintained across `routes.js` + `index.js`. JS
allows external property assignment to class instances; the `__`
prefix is folio's informal "app-side" convention, not a substrate
private. The broadcast at `wsHub.js:71` works correctly because
`serveCmd` sets the flag before any WS client can connect.

**But** the pattern is still a soft signal: folio chose to bolt state
onto the engine instance because the substrate didn't expose watch
state. Closed with a substrate enhancement (no folio change needed):

- **`SyncEngine.isWatching` getter** added (`packages/sync-engine/src/SyncEngine.js:266`).
  Returns `!!this.#watcher` (the fact the watcher adapter has attached
  — distinct from folio's `__watching` intent flag, which is set
  synchronously at the `start()` call).

The JSDoc explains the intent/fact distinction so future consumers can
choose which signal they want.

### Action items

- **P1 (this commit)** — `SyncEngine.isWatching` getter ✅ landed.
- **P2** — JSDoc for the 3 subclass-hook signatures (`applyConflictHook`,
  `ensureSharesHook`, `listSharesHook`) so future RN apps don't have
  to read the substrate body to find the shape.
- **P2** — Consider `get isRunning()` if a UI needs to disable
  "sync now" during an in-flight `runOnce`.

---

## Consolidated action list

| # | Acuity | Area | Action |
| - | --- | --- | --- |
| 1 | **P1 done** | sync-engine | `isWatching` getter added (this commit) |
| 2 | P1 | apps/folio README | Add `@canopy/pseudo-pod` + `@canopy/sync-engine-rn` to Substrates; add `@canopy/oidc-session` + `AgentIdentity` to Direct SDK use |
| 3 | P1 | apps/folio-mobile README | Add `pseudo-pod-adapter` row to Direct SDK use |
| 4 | P1 | folio-mobile | Verify `engine.verifyPodState` availability on RN; wire or document |
| 5 | P2 | sync-engine | JSDoc the 3 subclass-hook signatures |
| 6 | P2 | sync-engine | Optional `get isRunning()` |
| 7 | P2 | folio-mobile v2 plan | Track inbound cap-token + file-deletion mobile surfaces |

Items 2–4 are documentation refreshes — not blocking. Items 5–7 are
quality-of-life. **No urgent code work surfaced by the audit.**

## What this audit confirms

- Folio is the only repo app that legitimately needs the "Direct SDK
  use" escape pattern, and its uses are individually justified.
- The Folio → sync-engine pattern-source dynamic is healthy:
  post-Phase-5.1 substrate additions are all Folio-driven AND all
  opt-in. The substrate hasn't ossified around Folio's specifics.
- Web⇄mobile parity for folio's core user surfaces is achieved.
- The substrate has one minor expressiveness gap (watch-state
  observability) which this commit closes.
