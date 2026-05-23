/**
 * tasks-v0 — browser entry for canopy-chat composition.
 *
 * Lets canopy-chat boot a real tasks-v0 Crew agent inside its own
 * browser bundle, sharing an `InternalBus` so canopy-chat's
 * chatAgent can `.invoke(crewAgent.address, skillId, parts)` to
 * reach every real task skill (addTask / claimTask / submitTask /
 * approveTask / listMyInbox / ...).
 *
 * Why this file
 *   The bin/<app>-ui.js launchers boot tasks-v0 as a node process
 *   for the multi-member testbed UX.  canopy-chat doesn't need
 *   that scaffolding — it already owns the bus, the identity vault,
 *   and the chat-shell surface.  It just needs the real tasks
 *   substrate composed in-process.  This factory does that.
 *
 * Boundary: this file imports ONLY the platform-neutral parts of
 * tasks-v0 — no node:fs / node:crypto / no bin scripts / no agent-ui
 * mount.  Per the architectural-layering convention.
 *
 * See `Project Files/canopy-chat/integration-plan-2026-05-23.md`
 * for the full per-app integration plan; this is slice 1.
 */

import {
  AgentIdentity, InternalTransport,
} from '@canopy/core';

import { buildBundle }     from './storage/buildBundle.js';
import { createCrewAgent } from './Crew.js';

/**
 * Build a tasks-v0 Crew agent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus           shared bus (canopy-chat owns it)
 * @param {object}         args.identityVault Vault for the crew agent's identity;
 *                                            separate from the chat vault so
 *                                            crews don't pollute chat identity
 * @param {object}         args.crewConfig    {crewId, name, kind, members}
 * @param {string}         [args.label='TasksCrew']
 * @returns {Promise<{
 *   crew:    ReturnType<typeof createCrewAgent>,
 *   address: string,
 *   close:   () => Promise<void>,
 * }>}
 */
export async function createBrowserTasksAgent({
  bus,
  identityVault,
  crewConfig,
  label = 'TasksCrew',
}) {
  if (!bus) throw new TypeError('createBrowserTasksAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserTasksAgent: identityVault required');
  if (!crewConfig?.crewId) throw new TypeError('createBrowserTasksAgent: crewConfig.crewId required');

  // Per-crew identity, persisted in the supplied vault.  Survives
  // page reloads when the vault is VaultLocalStorage / VaultIndexedDB.
  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  // Local-first item store (Map-backed cache; restart-survival comes
  // from the caller's vault if needed via attachTasksBundle).
  const localStoreBundle = buildBundle();

  const crew = await createCrewAgent({
    crewConfig,
    localStoreBundle,
    wireOnboardingSkills: false,   // no invite issuance from chat-shell V0
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    label,
  });

  return {
    crew,
    address: identity.pubKey,
    close:   () => crew.close?.(),
  };
}
