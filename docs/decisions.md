# Decisions log — code & architecture (ADRs)

Short, dated records of settled technical/architectural choices, so the *why* survives after the choice is baked
into the code. One entry per decision, **newest at the bottom**. How/when to add one:
[`conventions/decision-log.md`](./conventions/decision-log.md). Organization/strategy decisions live privately
in `plans/strategy/decisions.md`.

---

## 2026-07-01 — Base platform: React Native + Expo (not Electron / Tauri / Capacitor)

**Status:** settled and shipped (`packages/react-native` + `apps/`).

**Context:** one JavaScript base had to run on both web and mobile, and carry NKN, mDNS, BLE, WebRTC, and decent
background tasks.

**Decision:** React Native, starting with Expo (new project; migrate the useful old parts).

**Alternatives / why RN won:** over Electron / Tauri / Capacitor — RN runs the **NKN client** directly (plain
JS); **mDNS** via `react-native-zeroconf` (iOS Bonjour / Android NSD); **better background tasks** than
Capacitor; **WebRTC** via `react-native-webrtc`.

---

## 2026-07-01 — Docs are private-by-function; private docs kept in an overlay repo (task #66)

**Status:** settled and implemented.

**Context:** plans/designs churn and shouldn't clutter the public repo, but moving them fully out breaks
in-repo references and fresh-clone usability.

**Decision:** a file's **function is encoded in its name/location**, and that drives git: tracked/public =
`docs/**` + `README`/`QUICKSTART` + `CLAUDE.md`/`AGENTS.md`; ignored/private = `plans/` + `_archive/` + root
private-prefix docs. Private docs are versioned + backed up in a **separate private repo** mounted as an overlay
(`git --git-dir` external, work-tree = the repo) — never on the public remote. A CI lint (`npm run lint:docs`)
enforces the split.

**Alternatives / why:** over a git submodule (ceremony; agents stumble on submodules) and a full
file-move-into-a-sibling-repo (symlink/gitignore friction) — the overlay keeps files in place, needs no moves,
and can't leak to the public remote.

**Consequences:** the doc-structure + doc-org conventions (`conventions/doc-structure.md`); the public plan
history was purged from all branches.

---

## 2026-07-02 — Decisions logged in one running file per domain (not a file-per-ADR directory)

**Status:** settled.

**Context:** setting up a decisions log (Phase 1 of the roadmap/docs restructure).

**Decision:** one running ADR-lite file per domain — `docs/decisions.md` (code, public) and
`plans/strategy/decisions.md` (org, private) — newest at the bottom, governed by
[`conventions/decision-log.md`](./conventions/decision-log.md).

**Alternatives / why:** over a `docs/decisions/NNNN-*.md` directory of one-file-per-decision (the classic ADR
layout) — a single running file is lower-ceremony and reads as a history top-to-bottom, which fits a small team.
