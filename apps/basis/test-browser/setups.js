/**
 * setups.js — the connectivity SETUP / MODE MATRIX, as data.
 *
 * Phase 0 of plans/PLAN-peer-connectivity.md wants the harness to exercise EVERY setup the
 * design doc lists (no-pod · shared-pod · relay · NKN · offline/hold · contact-DM · out-of-circle ·
 * mandate-to-a-member). This module makes those setups DATA: two orthogonal axes (transport × pod
 * data-policy) plus a note on client roles, a per-cell "earliest phase it works", and a tiny
 * `describeMatrix` helper that expands the cartesian product into readably-named Playwright groups.
 *
 * EXTENSIBILITY (the whole point): adding a setup = ONE entry in an axis array below. Adding a
 * journey = one spec that calls `describeMatrix` (see matrix.spec.js). Nothing else changes.
 *
 * NAMING (CLAUDE.md invariant 9): every axis value + cell name is plain and self-describing —
 * "relay + no-pod", not a codename. A reviewer reads the cell title and knows the setup.
 */

// ── axis: transport ─────────────────────────────────────────────────────────────
// Which cross-peer transport(s) a client uses. Mirrors the app's TRANSPORT_MODES
// (src/core/wizards/settingsState.js). `real` = a real body can run today (the wire may still be
// flaky in a sandbox, but the setup itself is supported); it's the transport dimension that's live now.
export const TRANSPORT_MODES = Object.freeze([
  { id: 'nkn',   name: 'NKN',        transportMode: 'nkn',   phase: 1, real: true,
    note: "the app's default rendezvous; no relay env. Flaky in a sandbox but the supported default." },
  { id: 'relay', name: 'relay',      transportMode: 'relay', phase: 1, real: true,
    note: 'a local @onderling/relay WebSocket broker — the hermetic path (started by the relay fixture).' },
  { id: 'both',  name: 'NKN+relay',  transportMode: 'both',  phase: 1, real: true,
    note: 'both transports up; the router picks the best route per peer (relay > nkn).' },
]);

// ── axis: pod data-policy ────────────────────────────────────────────────────────
// The per-CIRCLE data posture, set at create time (circlePolicy `pod` ∈ none|shared|personal|hybrid;
// default 'none'). Today ONLY no-pod (fan-out) is wired end-to-end; the pod setups are Phase 2/3, so
// their matrix cells are auto-`fixme` (via `phase`). Adding a real pod setup later = flip `real`/`phase`
// here once the create wizard can set the policy from the harness.
export const POD_POLICIES = Object.freeze([
  { id: 'no-pod',     name: 'no-pod',     pod: 'no-pod',     circlePolicyPod: 'none',     phase: 1, real: true,
    note: 'fan-out only — no shared pod. The single real data-policy today.' },
  { id: 'shared-pod', name: 'shared-pod', pod: 'shared-pod', circlePolicyPod: 'shared',   phase: 2, real: false,
    note: 'a circle-shared pod (circlePolicy pod:shared). Create-wizard wiring is Phase 2 — fixme.' },
  { id: 'pod-only',   name: 'pod-only',   pod: 'pod-only',   circlePolicyPod: 'personal', phase: 3, real: false,
    note: 'per-member personal pods, no fan-out (circlePolicy pod:personal). Phase 3 — fixme.' },
  { id: 'hybrid',     name: 'hybrid',     pod: 'hybrid',     circlePolicyPod: 'hybrid',   phase: 3, real: false,
    note: 'fan-out + pod backing (circlePolicy pod:hybrid). Phase 3 — fixme.' },
]);

// ── axis note: client roles ──────────────────────────────────────────────────────
// Roles are NOT a boot flag — they come from the JOURNEY (who creates the circle = admin; who
// redeems the invite = member; a contact-add makes a contact; @-tagging engages the bot). Recorded
// here so the matrix documents them; specs realise a role by driving the surface, not by a mode.
export const CLIENT_ROLES = Object.freeze([
  { id: 'admin',   name: 'admin',   note: 'creates the circle (createCircle) → holds the admin panel + invite.' },
  { id: 'member',  name: 'member',  note: 'redeems an invite (joinFromInvite) → appears in the roster.' },
  { id: 'contact', name: 'contact', note: 'a contact-add handshake, no circle — the contact-share setup (Phase 2).' },
  { id: 'bot',     name: 'bot',     note: 'the circle assistant — silent untagged, answers when @tagged (Phase 2/4).' },
]);

/** The earliest phase currently landed. Cells whose phase is above this run as `fixme`. */
export const CURRENT_PHASE = Number(process.env.PEER_TEST_PHASE || 1);

/**
 * Expand one axis-combination into a matrix CELL: a plain-named, phase-aware descriptor.
 * @param {object} transport  one TRANSPORT_MODES entry
 * @param {object} podPolicy  one POD_POLICIES entry
 * @returns {{name, transport, pod, phase, supported, reason}}
 */
export function makeCell(transport, podPolicy) {
  const phase = Math.max(transport.phase, podPolicy.phase);
  const real  = transport.real && podPolicy.real;
  const supported = real && phase <= CURRENT_PHASE;
  const reason = supported
    ? ''
    : (!real
        ? `${podPolicy.name} is not wired yet (target Phase ${podPolicy.phase})`
        : `needs Phase ${phase} (current ${CURRENT_PHASE})`);
  return {
    name: `${transport.name} + ${podPolicy.name}`,
    transport, pod: podPolicy, phase, supported, reason,
  };
}

/** The full transport × pod cartesian product as cells. */
export function allCells() {
  const cells = [];
  for (const t of TRANSPORT_MODES) for (const p of POD_POLICIES) cells.push(makeCell(t, p));
  return cells;
}

/**
 * describeMatrix(title, axes, body) — expand a transport × pod product into a named
 * `test.describe` per cell, calling `body(cell)` inside each so a spec fills in the journey.
 * `body` receives the cell; it decides (via cell.supported) whether to run a real test or `test.fixme`.
 *
 * @param {import('@playwright/test')} t  the Playwright test object (pass `test`).
 * @param {string} title
 * @param {{transports?:object[], pods?:object[]}} axes  subset the axes (default: all).
 * @param {(cell:object) => void} body
 */
export function describeMatrix(t, title, axes, body) {
  const transports = axes?.transports || TRANSPORT_MODES;
  const pods       = axes?.pods       || POD_POLICIES;
  for (const transport of transports) {
    for (const podPolicy of pods) {
      const cell = makeCell(transport, podPolicy);
      t.describe(`${title} · ${cell.name}`, () => { body(cell); });
    }
  }
}
