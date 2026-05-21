# Track I — Distribution (private + shared server bundles)

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-28 (initial draft) |
| **Owner** | unassigned |
| **Blocked on** | partially — distribution is most useful once Track A is real |

**Goal:** package the agent + Solid pod + (optional) ollama + admin UI
as a self-hostable bundle.  Probably ends up in **its own repo**
eventually — this plan is the v1 sketch from inside the monorepo.

This track is **not on the SDK critical path**.  Most useful once
Track A is shipped and there's something real to distribute.  Can
start in parallel earlier (the packaging work itself is independent
of the SDK code).

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track I](../Design-v3/topology-implementation.md#track-i--distribution)
- [`../Design-v3/topology.md` §Consequences for development](../Design-v3/topology.md#consequences-for-development) — "private user server becomes a real product"
- [`../projects/07-household-app/llm-cost.md`](../projects/07-household-app/llm-cost.md) — hardware target analysis

---

## Track-level open questions

| # | Question | Answer (when known) |
|---|---|---|
| Q-I.1 | First distribution channel: Yunohost / Umbrel / Cloudron / one-line script / Docker Compose? | **Deferred 2026-04-29.** Decide later when I1 starts.  Track I work is not in flight. |
| Q-I.2 | Solid pod server choice: Community Solid Server (CSS) / Node Solid Server (NSS) / Inrupt ESS? | **Locked 2026-04-29: adapter pattern — series of pod-server-specific classes.  v1 ships compatibility for both CSS AND Inrupt ESS.**  Each pod server has its own auth quirks and admin endpoints; the adapter abstracts them.  Other pod servers (NSS, CSO, future) can plug in later. |
| Q-I.3 | Admin UI: web (browser) / native / both? | **Locked 2026-04-29: both, but web first.**  v1 ships the web UI (universal); native UIs (macOS/Win/Linux/iOS/Android) follow as a v2 effort.  Architecture: keep the admin business logic in a thin API layer so any UI shell can consume it. |
| Q-I.4 | Local LLM bundling: ship with ollama pre-configured, or document install? | **Locked 2026-04-29: document install.**  Lean bundle (no LLM by default); users opt in via documented Ollama add-on path.  LLM remains optional on the private server per topology.md. |
| Q-I.5 | Should Track I split into its own repo now, or stay in monorepo for v1? | **Locked 2026-04-29: split into its own repo NOW.**  Distribution churn (manifests, CI, package upgrades, multiple pod-server compat builds) doesn't belong in the SDK history.  Independent release cadence.  Coordination via SDK-version pinning in the distribution repo's package.json. |

---

## Internal parallelism

```
I1 ── (independent)
I2 ── (after I1 — variant of same packaging)
I3 ── (after I1 — operations on existing bundle)
```

- **I1 (private-server bundle)** is the foundational packaging
  work.  Independent of SDK code.
- **I2 (shared-server bundle)** is largely the same packaging
  with different defaults; can start in parallel once I1 has a
  template.
- **I3 (update / restore tooling)** depends on I1's existing
  bundle; ships alongside.

Most efficient: one dev does I1, then in parallel forks I2
while another (or same) does I3.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **I1** | Real users can self-host the SDK + a pod on a small box |
| **I2** | Households / neighborhoods can self-host shared infra |
| **I3** | Bundles have a recovery story; users can survive hardware failures |

---

## Tasks

### I1 — Private-server bundle

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, packaging project] |
| **Notes** | Decide Q-I.1 + Q-I.2 + Q-I.3 + Q-I.4 + Q-I.5 before starting. |

**Files:**

```
create:
  packaging/private-server/Dockerfile                     # if Docker chosen
  packaging/private-server/docker-compose.yml
  packaging/private-server/admin-ui/                      # web app
  packaging/private-server/scripts/                       # install / run / update
  packaging/private-server/README.md                      # ops guide
```

**Sequence:**

- [ ] 1. Lock the five Q-I questions.
- [ ] 2. Bundle layout: agent service (Node, runs `@canopy/core` server-mode) + pod server (CSS recommended) + admin UI (web).
- [ ] 3. One-line install: `curl ... | bash` or `docker compose up`.
- [ ] 4. Persistent state: pod data + agent vault + config.  Volumes / bind mounts.
- [ ] 5. Smoke test: install on a fresh VM / Pi 5 / mini PC; verify pod reachable, agent online, admin UI accessible.
- [ ] 6. Hardening: HTTPS via Let's Encrypt; firewall rules; default to local-network access.

**DoD:**
- Bundle installs from one command on a fresh Linux box.
- Pod reachable + agent online within 5 min.
- Admin UI lets the user create their first identity.
- Tests / smoke runs documented.

**Notes (team scratchpad):**

```
(empty)
```

---

### I2 — Shared-server bundle

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, packaging project] |
| **Notes** | Variant of I1.  Group-scoped defaults. |

**Files:**

```
create:
  packaging/shared-server/                                # forks I1's structure
```

**Sequence:**

- [ ] 1. Fork I1's bundle layout.
- [ ] 2. Defaults: shared pod, group-membership UI in admin, multi-user agent.
- [ ] 3. Group-membership lifecycle: invite, join, role assignment, remove.  Uses Track D3 (role-aware groups).
- [ ] 4. Install + smoke test analogous to I1.

**DoD:**
- Shared bundle installs cleanly.
- Two test users can join the same instance and see shared state.
- Admin can manage memberships.

**Notes (team scratchpad):**

```
(empty)
```

---

### I3 — Update / restore tooling

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on I1.  Uses Track C export/import. |

**Files:**

```
create:
  packaging/private-server/scripts/update.sh
  packaging/private-server/scripts/backup.sh
  packaging/private-server/scripts/restore.sh
```

**Sequence:**

- [ ] 1. Update: `update.sh` pulls latest images / packages; runs migrations.  Idempotent.
- [ ] 2. Backup: invokes Track C's PodExporter; saves bundle to user-chosen path.
- [ ] 3. Restore: takes a bundle, validates, restores into a fresh install.
- [ ] 4. Tests: backup → wipe → restore → verify identical state.

**DoD:**
- Update script works from one version to next.
- Backup + restore round-trip preserves all state.
- Documented in I1's README.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

- **I3 → C3** — uses PodExporter / PodImporter.
- **I1 → A1 + B + general SDK** — most useful once SDK is real.
- **I2 → D3** — uses role-aware groups for membership UI.

---

## Cross-references

- `Design-v3/topology.md` §Consequences#1 — "private user server becomes a real product".
- `projects/07-household-app/llm-cost.md` — hardware target.
