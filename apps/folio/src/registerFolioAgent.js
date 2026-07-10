/**
 * registerFolioAgent — self-register folio into `@canopy/agent-registry`
 * (Slice 1b, PLAN-folio-as-file-agent.md).  The folio sibling of the
 * agents-app bring-up in canopy-chat's `realAgent.js` (`registerAgentBundle`).
 *
 * Folio becomes a CONNECTABLE file agent: once registered it appears in the
 * user's "your agents" roster with folio's pod-file capabilities, so the
 * registry (the mirror truth) knows a folio agent exists on this device.
 *
 * WHERE THIS IS WIRED: `createBrowserFolioAgent` (browser.js) is the
 * chat-web subset — it has NO pseudoPod in reach (the pod backend, watcher,
 * SyncEngine all stay app-side and never enter the browser bundle).  So,
 * exactly like the agents app (registered from `realAgent.js`, NOT from its
 * own factory), this helper is EXPOSED for the CONSUMING composition to
 * call once it has a pseudoPod + deviceId — canopy-chat wires it alongside
 * the folio agent boot, or folio's own Node server/CLI composition does
 * (a later slice).  It is deliberately NOT imported by `browser.js`, so the
 * browser bundle never pulls `@canopy/agent-registry`.
 *
 * Soft-fail: `registerAgentBundle` returns `null` (never throws) on a
 * transient pseudo-pod miss, so bring-up stays robust; re-registration is
 * idempotent (CAS upsert keyed on `agentId`).
 */
import { registerAgentBundle } from '@canopy/agent-registry';

import { folioManifest } from '../manifest.js';

/**
 * Folio's advertised capabilities = the pod-file op ids (the relocatable
 * `runtime:'browser'` set — the exact ids `buildFolioSkills` wires).
 * Derived from the manifest so the capability list can't drift from the
 * wired skills.
 */
export const FOLIO_CAPABILITIES = Object.freeze(
  folioManifest.operations
    .filter((op) => op.runtime === 'browser')
    .map((op) => op.id),
);

/**
 * @param {object} args
 * @param {object} args.pseudoPod   folio's pseudoPod (registry write target)
 * @param {string} args.deviceId    the pseudoPod's URI authority
 *                                   (= `agent.address` in the typical setup)
 * @param {object} args.agent       the live `core.Agent` (folio's agent)
 * @param {string} [args.name='folio']
 * @param {string} [args.role='service']  folio is a service agent, not a device
 * @param {string[]} [args.capabilities]  override the advertised set
 * @param {(err: Error) => void} [args.onError]
 * @returns {Promise<object|null>} the live registry handle, or `null` on soft-fail
 */
export function registerFolioAgent({
  pseudoPod,
  deviceId,
  agent,
  name = 'folio',
  role = 'service',
  capabilities,
  onError = null,
} = {}) {
  return registerAgentBundle({
    pseudoPod,
    podDeviceId: deviceId,
    agent,
    opts: {
      name,
      role,
      capabilities: Array.isArray(capabilities) ? capabilities : [...FOLIO_CAPABILITIES],
    },
    onError,
  });
}
