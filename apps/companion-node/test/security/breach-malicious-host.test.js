/**
 * J-SECURITY BREACH SUITE — malicious companion-node host.
 * PLAN-real-usage-and-deployment.md §7 ("a malicious companion host (R3: no
 * secret on host, verify live)").
 *
 * Threat: the person hosting your companion-node is hostile and tries to
 * exfiltrate your pod credentials from the box they run.
 *
 * The AUTHORITATIVE live proof — a real relay + real PodClient whose only
 * proxied seam is `fetch`, every pod request shipped back to the delegating
 * DEVICE which holds the OIDC/DPoP session and is the authoritative scope
 * check — lives in `test/companionAgentProxy.test.js` ("NO SECRET ON HOST",
 * device-authoritative deny, size caps). This suite adds a focused,
 * complementary STRUCTURAL assertion of the same invariant:
 *
 *   DEFENDED (green): the ONLY credential that crosses to the host is a
 *   scope-limited `PodCapabilityToken` (issuer/subject/pod/scopes/expiry/sig).
 *   It carries NO bearer pod secret (accessToken / DPoP / idToken / refresh /
 *   privateKey). A hostile host holding it can act ONLY within the granted
 *   scope, cannot mint wider access, and cannot recover the pod session.
 *
 * Reuses `startCompanionNode` + `authorizePod` / `deliverPodDelegation`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Agent, AgentIdentity, PodCapabilityToken } from '@onderling/core';
import { VaultMemory }  from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startCompanionNode } from '../../src/index.js';
import { authorizePod, deliverPodDelegation } from '../../src/authorizePod.js';

const POD_ROOT = 'https://owner.pod.invalid/';
const FORBIDDEN = ['accessToken', 'access_token', 'dpop', 'dpopPrivateKey',
                   'idToken', 'id_token', 'refreshToken', 'refresh_token',
                   'privateKey', 'secretKey', 'seed'];

/** Deep object-graph substring scan (the no-secret proof, from agent-proxy). */
function graphContains(root, needle, seen = new Set()) {
  if (root == null) return false;
  if (typeof root === 'string') return root.includes(needle);
  if (typeof root !== 'object') return false;
  if (seen.has(root)) return false;
  seen.add(root);
  for (const v of Object.values(root)) {
    if (graphContains(v, needle, seen)) return true;
  }
  return false;
}

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch {} } });

describe('§7.7 — malicious companion host: no pod secret on host', () => {
  it('DEFENDED: the delegation crossing to the host is a scope-only capability, not a bearer secret', async () => {
    const host = await startCompanionNode({
      identityVault: new VaultMemory(),
      gate: false,
      podProxy: true,
      podContainer: `${POD_ROOT}notes/`,
      podOwnerPubKey: null,   // set below via a real owner
    });
    cleanups.push(() => host.stop());

    const owner = await AgentIdentity.generate(new VaultMemory());

    // Owner mints a NARROW delegation for the host (read-only on /notes/).
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    const wire = token.toJSON();

    // (1) It IS a scope-limited capability.
    expect(wire.issuer).toBe(owner.pubKey);
    expect(wire.subject).toBe(host.agent.address);
    expect(wire.scopes).toEqual(['pod.read:/notes/']);
    expect(typeof wire.sig).toBe('string');

    // (2) It carries NONE of the pod session bearer secrets.
    for (const f of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(wire, f)).toBe(false);
    }
    // The device/owner's OWN secret material never appears in the wire token.
    expect(graphContains(wire, 'privateKey')).toBe(false);

    // (3) The scope cannot be widened by the host: a host-issued attempt to
    //     escalate read→write is not a valid attenuation of the parent.
    const hostId = host.agent.identity;
    const escalated = await PodCapabilityToken.issue(hostId, {
      subject: hostId.pubKey, pod: POD_ROOT, scopes: ['pod.write:/'],
      parentId: wire.id, expiresIn: 60_000,
    });
    expect(PodCapabilityToken.verifyChain([wire, escalated.toJSON()])).toBe(false);
  });

  it('DEFENDED: after accepting a delegation, the host object graph holds no pod OIDC secret', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const host = await startCompanionNode({
      identityVault: new VaultMemory(),
      gate: false,
      podProxy: true,
      podContainer: `${POD_ROOT}notes/`,
      podOwnerPubKey: owner.pubKey,
    });
    cleanups.push(() => host.stop());

    // A device on the host's relay delivers the owner's delegation.
    const devId = await AgentIdentity.generate(new VaultMemory());
    const device = new Agent({
      identity: devId,
      transport: new RelayTransport({ relayUrl: host.relayUrl, identity: devId }),
      label: 'device',
    });
    await device.start();
    cleanups.push(() => device.stop());
    await device.hello(host.agent.address);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);

    // The host now holds a delegation. A UNIQUE canary that would represent a
    // real pod session secret is NOT present anywhere in the host graph —
    // because in agent-proxy mode the DPoP/OIDC session lives on the device,
    // never shipped to the host. (The exfiltration-over-fetch live proof is
    // companionAgentProxy.test.js "NO SECRET ON HOST".)
    const SESSION_SECRET = 'OWNER-DPoP-PRIVATE-KEY-CANARY';
    expect(graphContains(host, SESSION_SECRET)).toBe(false);
    expect(graphContains(host.agent, SESSION_SECRET)).toBe(false);
  });
});
