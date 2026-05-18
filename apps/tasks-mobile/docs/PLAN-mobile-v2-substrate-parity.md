# Tasks-mobile — V2 substrate parity + depth-uplift plan

> **Status:** PROPOSED — 2026-05-18. Supersedes the (now-deleted)
> `Project Files/Tasks App/mobile-coding-plan-2026-05-08.md` referenced
> by `CHANGELOG.md [mobile-0.1.0]`. This doc is git-tracked **on
> purpose**: the old `Project Files/` plan tree is gutted (only an
> empty `coding-plans/` + `Old/` remain), so app-local docs +
> CHANGELOGs are now the durable source of truth.
>
> **Scope:** mobile only. `tasks-v0` (web) is already at `0.4.0`
> (full V2 substrate adoption, 122/122 green). This plan brings
> `tasks-mobile` up to that line and sequences the later depth uplift.
>
> **Owner:** TBD · **Precedents this plan mirrors:**
> `apps/tasks-v0/CHANGELOG.md [0.4.0]` (the spec) and
> `apps/stoop/CHANGELOG.md [0.3.0]` C-track + `apps/stoop-mobile/`
> (the proven web→mobile mirroring pattern).

---

## 1. Why this plan exists — the parity gap

"Tasks" is two codebases that are **not** in the same place:

| App | Substrate trio¹ | Version | State |
|---|---|---|---|
| `tasks-v0` (web) | ✅ all three | `0.4.0` (2026-05-14) | V2 substrate adopted, 12 slices, 122/122 |
| `tasks-mobile` | ❌ none | `mobile-0.1.0` (2026-05-09) | Pre-substrate; mirrors *old* tasks-v0 |
| `stoop` + `stoop-mobile` | ✅ all three | — | Adopted; stoop agent now deepening pod-routing (Phase 3.x) |

¹ `@canopy/pod-routing`, `@canopy/pseudo-pod`, `@canopy/notify-envelope`.

`tasks-mobile` is a **full minor version behind** `tasks-v0` and still
mirrors the pre-substrate desktop surface. This is the exact
platform-parity failure the user ratified as a repo-wide rule on
2026-05-18 — *web ≡ mobile for every app* — only the inverse of the
Stoop incident: here **web is ahead, mobile is stranded**.

There are **two distinct gaps**, and conflating them is the trap:

- **Gap 1 — Parity.** Bring `tasks-mobile` to `tasks-v0 0.4.0`.
  Target is *committed and frozen*. → Phases **M1–M3**.
- **Gap 2 — Depth.** `tasks-v0 0.4.0` adopted pod-routing only at the
  **V0 tier** (see the "what V0 deliberately does not do" list in
  `packages/pod-routing/README.md`). The stoop agent is *right now*
  implementing the depth (`decentralised`/`hybrid` policies,
  `fromInner` inverse, cross-app type-index enumeration) in the
  **shared** `packages/pod-routing` + `packages/pseudo-pod`. → Phase
  **M4**, web+mobile together, **gated**.

## 2. The sequencing invariant (this is the whole point)

> **Mirror the frozen `tasks-v0 0.4.0` (V0 pod-routing tier) now.
> Hard-gate the depth uplift (M4) on the stoop agent freezing
> `packages/pod-routing` Phase 3.x.**

Consequences:

- **M1–M3 are parallel-safe** with the running stoop agent **iff**
  done in an **isolated git worktree**, branched *after* M0
  housekeeping. They depend only on committed code
  (`tasks-v0 0.4.0`) and a proven pattern (`stoop-mobile` C-track).
  They must **not** reach for `decentralised`/`hybrid` — stay at the
  V0 tier `tasks-v0 0.4.0` itself uses.
- **M4 is hard-gated.** Do not start until: (a) the stoop agent's
  Phase 3.x is committed, and (b) `packages/pod-routing/README.md`'s
  "what V0 deliberately does not do" list has shrunk
  (decentralised/hybrid no longer stubbed). Starting M4 early =
  building Tasks against a pre-release API mutating underneath you.

### 2a. Overlap check — verified against code 2026-05-18 (do NOT combine M1–M3 with M4)

Question asked: do Gap-1 (M1–M3) and Gap-2 (M4) overlap enough to
merge? **No. Keep them split.** Evidence from the stoop commits:

- **Phase 3.1+3.2 (`2fcbe6c`) changed zero public API.** The 34-line
  diff is internal to `PodRouting.resolve()` — it changes *which URI*
  `decentralised`/`hybrid` resolve to, not the method signature,
  `setCrewPolicy`, `crewPolicy`, or the policy enum. Consuming it is a
  **transparent inherit** of the shared dep — zero tasks code change.
- **tasks-v0 0.4.0 already ships the full 4-policy surface**
  (`CREW_STORAGE_POLICIES = ['no-pod','centralised','decentralised',
  'hybrid']` in skills/Crew/picker). M1 mirrors **all four** to
  mobile. M4 adds **no UI, no skill, no app wiring** — the depth is
  entirely inside the shared package.
- The only app-level Phase-3 work (`podPathMap`/`fromInner`/cross-app
  type-index — stoop `0334d6c`/`cb225bd`) is **Stoop-app-specific,
  additive on top of the substrate wiring**, not a shared dependency
  and not a redo of M1. Combining would force M1 to wait on the stoop
  agent for **no gain** (M1 consumes none of Phase 3.x).

**Net:** the gate costs nothing and avoids a pointless serialization.
One cheap seam remains — M4 re-opens `ServiceContext`/Agent to add a
`_podCtx`/podPathMap closure (~30 additive lines, mirror of stoop
`c49c768` Phase 2.4-core). Mitigated by the M1 forward-courtesy below.

## 3. Governing constraints (durable, do not violate)

- **Platform parity** — implement via **shared device-independent
  code paths invoked by BOTH web and mobile**, never a mobile-private
  fork of shared substrate. `tasks-v0`'s `substrateMirror.js` /
  `lib/substrateStack.js` must be confirmed RN-safe and **imported**
  by `tasks-mobile`, mirrored not duplicated (this is exactly how
  Stoop's substrateMirror surface was "preserved so stoop-mobile's
  agentBundle/bootstrapBundle drop in").
- **Node portability** — no `node:*` and no required server on the
  mobile substrate path. New Node-bound code (none expected here)
  goes in `*node*`-named files. The mobile pseudo-pod backend is the
  RN adapter (`@canopy/react-native/pseudo-pod-adapter`), `standalone`
  mode (Tasks does not need cache mode).
- **Metro resolution gotcha** — RN/Metro does not hoist like Node.
  Even though `@canopy/{pseudo-pod,pod-routing,notify-envelope}` are
  transitively present via `@canopy-app/tasks-v0` (`file:../tasks-v0`),
  they **must be listed explicitly** in `apps/tasks-mobile/package.json`
  to be Metro-resolvable — mirror `stoop-mobile`'s explicit list.

## 4. Phased plan

### M0 — Merge & freeze (do first; unblocks a clean branch)

- [ ] **Absorb the outstanding tasks-mobile todos** into this plan:
  - The Phase 41.16 real-device acceptance pass (the 13-journey
    runbook in `README.md` + `REAL_DEVICE.md`). → re-baselined as **M3**
    (the surface changes under M1/M2, so the old runbook is rewritten,
    not just run).
  - Explicit V1.x deferrals recorded in `REAL_DEVICE.md`:
    `wireCalendarEmission` live native-calendar sync (deferred);
    `useTasksAuth` biometry-lockout fallback (deferred). Decide per
    item: still deferred vs folded into M1/M2. Default: keep deferred,
    list them in §6 so they are not silently lost.
- [ ] **Wait for the stoop agent to commit its loose shared-package
  edits** before branching: `packages/item-types/src/adapter.js`
  (unused re-export removal) and
  `packages/oidc-session/src/createSolidAuthNode.js` (OIDC HTTP
  timeout raise). One working tree + two agents editing shared
  packages = guaranteed conflict.
- [ ] **Inherit the oidc-session timeout fix** — it directly benefits
  tasks-mobile pod sign-in (`OIDC_HTTP_TIMEOUT_MS`, default 30 s vs
  the 3500 ms openid-client default). Do not re-implement.
- [ ] Create the isolated worktree; branch off `master` *after* the
  above lands.

### M1 — Substrate plumbing parity (mirror tasks-v0 Slices 1–5)

| tasks-v0 0.4.0 slice | tasks-mobile work | stoop-mobile precedent |
|---|---|---|
| S1 — `embeds[]` + crew `storage` policy + get/set policy skills | embed-ref slot on the compose screen; storage-policy picker on create-crew + crew-settings | `PostComposeScreen` embed slot; `CreateGroupScreen` 4-radio policy picker |
| S2 — `/welcome.html` create-crew wizard + `provisionMyCrew` | create-crew wizard screen → `provisionMyCrew` | stoop-mobile create-group wizard |
| S3 — agent-registry on `createCrewAgent` (`registerAgentBundle`) | register on bundle bring-up in `ServiceContext`/`buildCrewState` | stoop-mobile `agentBundle`/`bootstrapBundle` `registerAgentBundle` |
| S4 — `/onboard.html` + `/pod-settings.html` | onboard (invite redeem) + pod-settings screen (policy display + upgrade row + registry status) | stoop-mobile onboard + profile "My Solid pods" |
| S5 — pod OIDC sign-in (`startPodSignIn`/`completePodSignIn`/`signOutOfPod`/`podSignInStatus`) | wire the 4 skills behind the pod-settings sign-in card (uses `@canopy/oidc-session-rn` already in deps) | stoop-mobile `ProfileMineScreen` pod sign-in |

- [ ] Add the 4 Metro-explicit deps to `apps/tasks-mobile/package.json`:
  `@canopy/pseudo-pod`, `@canopy/pod-routing`,
  `@canopy/notify-envelope`, `@canopy/agent-registry`. Pin to the same
  versions stoop-mobile carries.
- [ ] Confirm `tasks-v0`'s `substrateMirror.js` + `lib/substrateStack.js`
  are RN-safe (no `node:*`); have `tasks-mobile` **import** them
  (shared path) — do **not** fork. If anything is Node-bound, lift the
  RN-safe core per the portability convention.
- [ ] **Forward-courtesy (near-zero cost):** structure the
  `ServiceContext` substrate wiring so the per-bundle `_podCtx` /
  `innerKeyMap` closure can be added later without a rewrite (leave
  the bundle seam open — mirror where stoop `c49c768` hooks Agent).
  This is the only M1↔M4 touchpoint; pre-empting it here keeps M4 a
  pure additive inherit.
- [ ] Locales EN+NL parity for every new string; `audit-locales` clean.
- [ ] Vitest sweep green (mirror tasks-v0's `v2-adoption.test.js`
  coverage where it is device-independent).
- [ ] **Stay at the V0 pod-routing tier.** No decentralised/hybrid.

### M2 — Multi-crew + mirror fan-out parity (mirror Slices 6–12)

- [ ] Multi-crew runtime: `tasks-mobile` already ships the V2.8
  single-agent / live `crews` Map pattern (per `CHANGELOG.md
  [mobile-0.1.0]`). Verify it lines up with tasks-v0 Slices 6–8
  (`spawnMyCrew`, multi-crew onboarding dispatch, per-crew
  `itemStoreRoot` URI prefix to stop cross-crew `addTask` leakage);
  extend where it diverges.
- [ ] Substrate-mirror cross-device fan-out (Slices 9–12): wire
  `wireTasksSubstrateMirror` per crew; fan out **every** mutation —
  add/claim/complete/submit/approve/reject/revoke/reassign/remove —
  via the shared `ItemStore.applySync`/`removeSync` gate-bypass path
  (`@canopy/item-store`, already shared). Stale-peer auto-heal +
  `fetch-resource`/`groupCheck` per crew bundle inherit from the
  shared `wireTasksSubstrateMirror` (no mobile-specific code).
- [ ] Live peer-roster updates from `redeemInvite` →
  `tasksMirror.addPeer`.

### M3 — Re-baselined real-device acceptance (was Phase 41.16)

- [ ] Rewrite the runbook: the surface changed (storage-policy
  picker, pod OIDC sign-in, cross-device fan-out now exist). Model it
  on `apps/stoop-mobile/docs/phase-40-23-checklist.md` (per-journey
  tick-list, two-device for the cross-device journeys).
- [ ] Two-device cross-device fan-out journey is the acceptance gate
  (mirror Stoop's S1–S5 pair scenarios): create crew on A → join on
  B → mutate on A → observe on B via substrate-mirror.
- [ ] Reuse stoop-mobile's dev client (same Expo 52 / RN 0.76.9 pin;
  Tasks' native modules are a near-superset — saves a native rebuild).
- [ ] Carry forward the `REAL_DEVICE.md` gotchas; update the
  pod-sign-in section for the inherited `OIDC_HTTP_TIMEOUT_MS` fix.

### M4 — Pod-routing depth uplift — **GATED, thin** (see §2a)

> Reframed per the 2026-05-18 overlap check: M4 is **not** a large
> uplift. The policy depth is a transparent inherit (zero app code);
> the only substantive app work is the optional Stoop-pattern
> `podPathMap`/`fromInner`/type-index copy, additive on M1's wiring.

> **Gate: MET — verified 2026-05-18 on master `a231c1c`** (after the
> M1+M2+S5+M3 ff-merge). `git merge-base --is-ancestor` confirmed ALL
> Phase 3.x substrate is genuinely on master (not a divergent line):
> `2fcbe6c` Ph3.1+3.2 decentralised/hybrid (real impl, `PodRouting.js`
> L107/L121 — not stubbed), `0334d6c` Ph3.3a fromInner, `cb225bd`
> Ph3.3b cross-app type-index, `4f9adf5` Ph3.3c cross-pod-ref resolver
> (`packages/item-store/src/embeds.js` present), `a2685c6` Ph3.3c
> app-wiring (`getItemTree` walks cross-pod embeds). Plus `11a269a`
> stoop `device-independent pod-attach (web≡mobile)` — the concrete
> parity reference to mirror.

- [x] Gate confirmed (substrate ancestor check passed on `a231c1c`).
- [ ] **Step 1 — scope the delta first** (report before large
  changes, per the M2 pattern / §8): read stoop's Ph3.3c app-wiring
  (`a2685c6`) + `device-independent pod-attach` refactor (`11a269a`)
  + cross-pod-ref resolver (`4f9adf5`); determine for `tasks-v0` +
  `tasks-mobile` what is a **transparent inherit** (the 4-policy
  surface already passes through; pod-routing now resolves
  decentralised/hybrid internally — likely zero app code) vs **real
  app work** (the Stoop-pattern podPathMap/`fromInner`/cross-pod-ref
  read-path wiring). Size it; don't assume "thin" — verify.
- [ ] Uplift `tasks-v0` **and** `tasks-mobile` **together** (one
  piece of work, both platforms — platform parity), mirroring stoop's
  Phase 3.3c app-wiring via **shared device-independent paths** (reuse
  stoop's `11a269a` device-independent pod-attach pattern; do not
  fork per-platform). Inherit the now-on-master shared packages.
- [ ] Re-run M3 acceptance for the new policies + the cross-pod read
  path.

## 5. Dependency graph

```
M0 ──> M1 ──> M2 ──> M3
                       │
        (stoop Phase 3.x freezes pod-routing)
                       ▼
                      M4  (web + mobile together)
```

- M0 blocks a clean branch (working-tree collision avoidance).
- M1→M2→M3 are strictly sequential within the worktree, parallel-safe
  *with* the stoop agent.
- M4's only hard external dependency is the stoop agent's Phase 3.x.

## 6. Carried-forward deferrals (do not silently lose)

- Native-calendar **live** sync (`wireCalendarEmission`) — V1.x
  deferred per `REAL_DEVICE.md`. Re-evaluate after M3.
- `useTasksAuth` biometry-lockout fallback — V1 ships the Stoop-shape
  (no biometry gate); deferred.
- Folio-mobile pseudo-pod default flip stays opt-in (separate track —
  see the P3 absorption memory; noted only to avoid scope bleed).

## 7. Fleet-parity note (out of scope, flagged per the repo-wide rule)

The web≡mobile rule is repo-wide. Current substrate-trio status for
the rest of the mobile fleet, for visibility only:
`household` — none; `folio-mobile` — `@canopy/pseudo-pod` only. Each
is its own future plan; this doc does **not** cover them.

## 8. Open questions for the owner

- M1 worktree start: branch immediately after M0 housekeeping, or
  hold the whole track until the stoop agent fully finishes? (M1–M3
  are parallel-safe if isolated; the only cost of starting now is
  worktree discipline.)
- Multi-crew (M2): is `tasks-mobile`'s existing V2.8 topology already
  at Slice 6–8 parity, or does it predate it? Needs a code read at
  M2 start to size the delta.
