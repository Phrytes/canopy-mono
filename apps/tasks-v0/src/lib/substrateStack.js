/**
 * Substrate-stack builder for Tasks-v0 circle bundles — THIN SHIM.
 *
 * The stack logic lives ONCE in `@canopy/substrate-stack` (it used to be a
 * self-described "mirror of Stoop's" copy — the exact cross-app duplication
 * invariant #3 forbids; consolidated 2026-07-09). This shim preserves the
 * Tasks entry name, its literal deviceId fallback, and the
 * `existingPseudoPod` reuse option (forwarded as-is).
 *
 * Original context (Phase 52.9.3, Tasks V2 ninth slice).
 */

import { buildSubstrateStack as buildSharedSubstrateStack } from '@canopy/substrate-stack';

/**
 * @param {object} args — see `@canopy/substrate-stack`.
 * @param {import('@canopy/core').Agent} args.agent
 * @param {string} [args.deviceId] — defaults to `agent.address`.
 * @param {object} [args.existingPseudoPod] — reuse instead of constructing.
 */
export function buildTasksSubstrateStack(args = {}) {
  return buildSharedSubstrateStack({ fallbackDeviceId: 'tasks-device', ...args });
}
