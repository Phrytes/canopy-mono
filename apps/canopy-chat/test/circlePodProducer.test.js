/**
 * Per-circle pod producer (S4 structural slice) — drives the REAL sealing substrate
 * over an in-memory @canopy/pseudo-pod (no OIDC, no CSS, runs in CI). Proves a p2
 * circle gets a real per-circle control agent that bootstraps + seals to its own
 * pod, a p0 circle gets only a sealing identity (no control agent), and two circles
 * never share a sealing key. This is the in-browser counterpart of the CSS real-pod
 * verify (circleSealing.css.test.js).
 */
import { describe, it, expect } from 'vitest';
import { PodClient, createSealedPodClient, generateKeypair } from '@canopy/pod-client';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from '../src/v2/circlePodProducer.js';

class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}

/** A browser-shaped in-memory pod client factory (what the web host injects). */
function makePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

describe('createCirclePodProducer', () => {
  it('p0 circle → crypto-free no-op (no control agent, no sealing identity)', async () => {
    const vault = new MemVault();
    const prod = await createCirclePodProducer({ circleId: 'c0', storagePosture: 'p0', vault });
    expect(prod.controlAgent).toBeNull();
    expect(prod.podClient).toBeNull();
    expect(prod.sealingIdentity).toBeNull();   // p0 never seals → no x25519 keygen (browser-safe)
  });

  it('rejects a sealed circle without generateKeypair + makePodClient', async () => {
    const vault = new MemVault();
    await expect(createCirclePodProducer({ circleId: 'c', storagePosture: 'p2', vault }))
      .rejects.toThrow(/generateKeypair|makePodClient/);
  });

  it('p2 circle → a real control agent bootstrapped over its own pseudo-pod; sealed round-trip', async () => {
    const vault = new MemVault();
    const alice = generateKeypair();
    const prod = await createCirclePodProducer({
      circleId: 'alpha', storagePosture: 'p2', vault,
      roster: [{ webId: 'did:alice', publicKey: alice.publicKey, role: 'admin' }],
      generateKeypair, makePodClient,
    });
    expect(prod.controlAgent).not.toBeNull();
    expect(prod.storagePosture).toBe('p2');
    // bootstrap ran → alice (the initial roster) can resolve the group key + seal/open round-trips
    const strat = await prod.controlAgent.sealingStrategy(alice.privateKey);
    expect(strat.open(strat.seal('hoi'))).toBe('hoi');
    // and the sealed content really lands on the circle's pod, opened back transparently
    const sealed = createSealedPodClient(prod.podClient, strat);
    await sealed.write(`${prod.circleRootUri}/shared/n.txt`, 'alleen voor alpha');
    expect((await sealed.read(`${prod.circleRootUri}/shared/n.txt`)).content).toBe('alleen voor alpha');
  });

  it('persists the controller key across producers for the same circle (vault-backed)', async () => {
    const vault = new MemVault();
    const mk = (n = 0) => createCirclePodProducer({
      circleId: 'beta', storagePosture: 'p2', vault, generateKeypair, makePodClient, bootstrap: n === 0,
    });
    await mk(0);
    const k1 = await vault.get('cc.circle-controller-key:beta');
    await mk(1);
    const k2 = await vault.get('cc.circle-controller-key:beta');
    expect(k1).toBe(k2);                       // same controller key reused, not regenerated
    expect(JSON.parse(k1)).toHaveProperty('privateKey');
  });

  it('persists the group key across reloads: a fresh producer (new pod, same vault) restores it + opens prior content', async () => {
    const vault = new MemVault();
    const text = 'overleeft een reload';
    // session 1 — seal a string under the circle's group key
    const p1 = await createCirclePodProducer({ circleId: 'dur', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const id1 = await p1.sealingIdentity.ensure();
    const sealed = (await p1.controlAgent.sealingStrategy(id1.privateKey)).seal(text);
    expect(await vault.get('cc.circle-groupkey:dur')).toBeTruthy();   // group key persisted to the vault
    // session 2 — SAME vault, FRESH pseudo-pod (makePodClient mints a new in-memory backend)
    const p2 = await createCirclePodProducer({ circleId: 'dur', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const id2 = await p2.sealingIdentity.ensure();
    expect(id2.publicKey).toBe(id1.publicKey);                        // same persisted sealing identity
    const s2 = await p2.controlAgent.sealingStrategy(id2.privateKey);
    expect(s2.open(sealed)).toBe(text);                              // restored group key opens session-1 ciphertext
  });

  it('control-agent router grows the roster: a redeemed member becomes able to decrypt the circle', async () => {
    const vault = new MemVault();
    const bob = generateKeypair();
    const prod = await createCirclePodProducer({ circleId: 'rg', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const pods = new Map([['rg', prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);

    // before redeem: bob is NOT a recipient of the group key
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();
    // redeem → stoop routes addMember(bob, groupId:rg) to this circle's producer
    await router.addMember({ webId: 'did:bob', publicKey: bob.publicKey, role: 'member', groupId: 'rg' });
    // now bob can open content sealed by the circle (the local self identity)
    const self = await prod.sealingIdentity.ensure();
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('voor de hele kring');
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('voor de hele kring');

    // leave → revoke + rotate; bob can no longer unwrap (forward secrecy)
    await router.removeMember({ webId: 'did:bob', groupId: 'rg' });
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();
  });

  it('seedCircleRoster wraps the group key to members who joined before the producer was live', async () => {
    const vault = new MemVault();
    const bob = generateKeypair();
    const prod = await createCirclePodProducer({ circleId: 'seed', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const pods = new Map([['seed', prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();   // not a recipient yet

    // listGroupMembers surfaces bob with his sealing public key (from the redemption trail)
    const callSkill = async (app, op) => (op === 'listGroupMembers'
      ? { members: [{ webid: 'did:bob', sealingPublicKey: bob.publicKey, role: 'member' }, { webid: 'did:anne', role: 'admin' }] }
      : {});
    const n = await seedCircleRoster({ callSkill, circleId: 'seed', router });
    expect(n).toBe(1);   // only bob had a sealing key

    const self = await prod.sealingIdentity.ensure();
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('voor iedereen');
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('voor iedereen');
  });

  it('seedCircleRoster no-ops without callSkill / router / members', async () => {
    expect(await seedCircleRoster({})).toBe(0);
    expect(await seedCircleRoster({ callSkill: async () => ({ members: [] }), circleId: 'x', router: { addMember: async () => {} } })).toBe(0);
  });

  it('router no-ops for an unknown / unsealed circle', async () => {
    const router = createCircleControlAgentRouter(() => null);
    await expect(router.addMember({ webId: 'x', publicKey: 'k', groupId: 'none' })).resolves.toBeUndefined();
    await expect(router.removeMember({ webId: 'x', groupId: 'none' })).resolves.toBeUndefined();
  });

  it('scopes by circle: two sealed circles get different sealing identities', async () => {
    const vault = new MemVault();
    const mk = (circleId) => createCirclePodProducer({ circleId, storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const a = await (await mk('x')).sealingIdentity.ensure();
    const b = await (await mk('y')).sealingIdentity.ensure();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});
