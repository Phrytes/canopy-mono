/**
 * createPodOnboarding — substrate factory.
 *
 * Bundles the four operations (`provisionDefault`,
 * `upgradeToTwoPods`, `restoreFromMnemonic`, `signOut`) with the
 * shared dependencies (pseudoPod, podProvisioner, oidcSession,
 * webidCache).
 *
 * Apps either call this factory once at boot, or invoke the
 * underlying functions directly.
 *
 * Standardisation Phase 52.5.
 */

import { provisionDefault }    from './provisionDefault.js';
import { restoreFromMnemonic } from './restoreFromMnemonic.js';
import { signOut }             from './signOut.js';
import { upgradeToTwoPods }    from './upgradeToTwoPods.js';
import { defaultAcpTemplates } from './acpTemplates.js';

/**
 * @param {object} deps
 * @param {object} [deps.pseudoPod]       — for the local mirror copy
 * @param {object} [deps.podProvisioner]  — provisioner contract; see README
 * @param {object} [deps.oidcSession]     — SolidVault-shaped
 * @param {object} [deps.webidCache]      — WebIdCache from webid-discovery
 * @param {string} [deps.deviceId]        — default deviceId for pseudo-pod ops
 */
export function createPodOnboarding(deps = {}) {
  const {
    pseudoPod,
    podProvisioner,
    oidcSession,
    webidCache,
    deviceId,
  } = deps;

  return {
    async provisionDefault(opts = {}) {
      return provisionDefault({
        pseudoPod:      opts.pseudoPod      ?? pseudoPod,
        podProvisioner: opts.podProvisioner ?? podProvisioner,
        ...opts,
      });
    },

    async restoreFromMnemonic(opts = {}) {
      return restoreFromMnemonic({
        pseudoPod:      opts.pseudoPod      ?? pseudoPod,
        podProvisioner: opts.podProvisioner ?? podProvisioner,
        oidcSession:    opts.oidcSession    ?? oidcSession,
        webidCache:     opts.webidCache     ?? webidCache,
        deviceId:       opts.deviceId       ?? deviceId,
        ...opts,
      });
    },

    async signOut(opts = {}) {
      return signOut({
        oidcSession: opts.oidcSession ?? oidcSession,
        pseudoPod:   opts.pseudoPod   ?? pseudoPod,
        deviceId:    opts.deviceId    ?? deviceId,
        ...opts,
      });
    },

    upgradeToTwoPods,

    defaultAcpTemplates,
  };
}
