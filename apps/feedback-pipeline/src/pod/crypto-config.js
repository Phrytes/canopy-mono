// crypto-config.js — the single seam that turns a project's privacy menukaart into the
// { seal, open, verify } a central pod is constructed with. Keeping this in one place means
// every runnable script (bots, activation, aggregation) wires sealing + signatures the same
// way, driven purely by ProjectConfig + whatever key material exists in THIS process.
//
// Host-blind by design: `seal` and `verify`-on-write need only PUBLIC material (the project
// public key in config; the roster), so the always-on writer holds no secret. `open` exists
// only where the project private key is present — i.e. the keyless aggregation job after it
// unwraps. A writer process simply passes no private key and gets seal-without-open.

import { makeSealer, makeOpener } from './project-seal.js';
import { makeContributionVerifier } from './signing.js';
import { assertAggregationAllowed } from '../aggregation/placement.js';

/**
 * @param {object} a
 * @param {object} a.config              a validated ProjectConfig
 * @param {string} [a.projectPrivateKey] b64url X25519 private key — only the aggregation side has it
 * @param {import('./signing.js').IdentityRoster} [a.roster] pseudonym→key roster (for verify)
 * @returns {{ seal?:Function, open?:Function, verify?:Function }}
 */
export function cryptoForProject({ config, projectPrivateKey, roster } = {}) {
  const p = config?.privacy || {};
  const out = {};
  // contributions are sealed to the single project public key (the team-recipient wrapping
  // protects the PRIVATE key elsewhere, not each contribution — see the PR-1 key model).
  if (p.seal && p.projectPublicKey) out.seal = makeSealer([p.projectPublicKey]);
  // building an opener = gaining decryption capability → gated by the team's placement choice,
  // so a platform-host process cannot open a 'controller'/'enclave' project's contributions.
  if (p.seal && projectPrivateKey) { assertAggregationAllowed(config); out.open = makeOpener(projectPrivateKey); }
  if (p.verify && roster) out.verify = makeContributionVerifier({ roster, projectId: config.projectId });
  return out;
}
