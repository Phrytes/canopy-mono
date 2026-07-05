/**
 * Real-pod ROUTING for the per-circle producer — drives `createCirclePodProducer` over a
 * REAL Solid pod (a running CSS) instead of the in-memory pseudo-pod, via the injected
 * `makePodClient` + a `circleRootUri` pointing into the pod. Proves a sealed (p2) circle
 * stores its group key + seals content on a real pod, and the control-agent ROUTER grows
 * the roster there (a redeemed member can decrypt). This is the "real-pod routing" half of
 * circle OIDC — the auth here is non-interactive client-credentials (the verifiable path);
 * the interactive browser sign-in reuses the existing `src/web/podAuth.js`.
 *
 * Gated on `CSS_URL` + client-credentials (skips clean otherwise). Provision with
 * `apps/feedback-pipeline/scripts/bootstrap-owner.js`. Run:
 *   CSS_URL=http://localhost:3000/ CSS_CLIENT_ID=… CSS_CLIENT_SECRET=… \
 *   CSS_WEBID=http://localhost:3000/<pod>/profile/card#me \
 *   npx vitest run test/circlePodProducer.css.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE = CSS_URL && HAVE_OIDC ? describe : describe.skip;

let PodClient, SolidOidcAuth, generateKeypair, SolidVault, VaultMemory;
let createCirclePodProducer, createCircleControlAgentRouter;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth, generateKeypair } = await import('@canopy/pod-client'));
  ({ VaultMemory } = await import('@canopy/vault'));
  ({ SolidVault } = await import('@canopy/oidc-session'));
  ({ createCirclePodProducer, createCircleControlAgentRouter } = await import('../src/v2/circlePodProducer.js'));
});

class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}

SUITE('per-circle producer — real-pod routing (CSS)', () => {
  const podBase = (process.env.CSS_CIRCLE_ROOT || `${CSS_URL}circles`).replace(/\/$/, '');

  /** An authenticated real PodClient (client-credentials) — what makeRealPodClient builds in the app. */
  async function makeRealPodClient() {
    const vault = new VaultMemory();
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault });
    await sv.login({
      clientId: process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL,
    });
    return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
  }

  it('p2 circle on a real pod: bootstrap + sealed round-trip + router grows the roster', async () => {
    const podClient = await makeRealPodClient();
    const circleId = `rt-${generateKeypair().publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
    const vault = new MemVault();
    const bob = generateKeypair();

    const prod = await createCirclePodProducer({
      circleId, storagePosture: 'p2', vault,
      generateKeypair,
      makePodClient: () => podClient,                  // route to the REAL pod
      circleRootUri: `${podBase}/${circleId}`,         // the circle's container on the pod
    });
    expect(prod.controlAgent).not.toBeNull();
    expect(prod.circleRootUri).toBe(`${podBase}/${circleId}`);

    // the local member can seal/open content (group key lives on the real pod)
    const self = await prod.sealingIdentity.ensure();
    const stratSelf = await prod.controlAgent.sealingStrategy(self.privateKey);
    expect(stratSelf.open(stratSelf.seal('op een echte pod'))).toBe('op een echte pod');

    // roster growth on a real pod: a redeemed member becomes able to decrypt
    const pods = new Map([[circleId, prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();
    await router.addMember({ webId: 'did:bob', publicKey: bob.publicKey, role: 'member', groupId: circleId });
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('voor de hele kring');
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('voor de hele kring');

    // the group-key resource really persisted on the pod (host holds wrapped keys, not bob's private key)
    const raw = await podClient.read(`${podBase}/${circleId}/.keys/group.json`, { decode: 'string' });
    const rawText = typeof raw === 'string' ? raw : raw?.content;
    expect(rawText).toBeTruthy();
    expect(rawText).not.toContain(bob.privateKey);
  }, 60_000);
});
