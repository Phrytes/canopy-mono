/**
 * Substrate-stack builder for Stoop bundles — THIN SHIM.
 *
 * The stack logic lives ONCE in `@canopy/substrate-stack` (it used to be
 * duplicated verbatim across stoop / tasks-v0 / household — the exact
 * cross-app copy invariant #3 forbids; consolidated 2026-07-09). This shim
 * only preserves Stoop's entry name + its literal deviceId fallback.
 *
 * Original context (Phase 52.9.2, Q-B groupMirror retirement): wires
 * `@canopy/pseudo-pod` + `@canopy/pod-routing` + `@canopy/notify-envelope`
 * per bundle, with per-recipient transport routing built from the agent.
 */

import { buildSubstrateStack as buildSharedSubstrateStack } from '@canopy/substrate-stack';

/**
 * @param {object} args — see `@canopy/substrate-stack`.
 * @param {import('@canopy/core').Agent} args.agent
 * @param {string} [args.deviceId] — defaults to `agent.address`.
 */
export function buildSubstrateStack(args = {}) {
  return buildSharedSubstrateStack({ fallbackDeviceId: 'stoop-device', ...args });
}
