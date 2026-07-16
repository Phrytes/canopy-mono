/**
 * companion-node R2b.1 — the POD-LEG SCOPE GATE fitness suite.
 *
 * R2b.0 (merged) landed the pod-side verifier (`createPodTokenVerifier` +
 * `scopeForRequest`) in `@onderling/pod-client`. R2b.1 puts it to WORK: the host's
 * held pod client is wrapped in a `ScopedPodClient` that presents a delegated
 * `PodCapabilityToken` and checks EVERY pod op against it — deny-by-default —
 * before the op touches the client. This suite proves the enforcement at the POD
 * LEG, cross-agent, over a REAL relay + REAL RelayTransport (the genuine encrypt
 * → relay-forward → decrypt wire path). We assert the RESULT — real pod content
 * returned, or an opaque denial with NO bytes — never merely that a gate "ran".
 *
 * Audit (see scopedPodClient.js header): the ONLY held-pod-client method a folio
 * core reaches today is `.list` (via `listFiles({source:'pod'})` → listPodFolio).
 * So the pod leg exercised here is `listFiles({source:'pod'})`.
 *
 * ISOLATION: the R2 SKILL gate (`gate:true`) is orthogonal — it gates WHICH skill
 * a device may call and is proven in companionGate.test.js. Here we boot with
 * `gate:false` so the ONLY thing standing between the device and the pod bytes is
 * the R2b.1 pod-scope gate — the code path under test.
 *
 * HONESTY: enforcement is IN-PROCESS (the held FsBackedMockPodClient, not an HTTP
 * pod), so this is REAL scope/expiry/revocation but NOT a network-adversary
 * boundary — that arrives with a real HTTP pod / `CapabilityAuth` pod-direct at
 * R3. The token is INJECTED at boot; R2b.2 delivers it over `authorizePod`.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, Parts, PodCapabilityToken } from '@onderling/core';
import { VaultMemory }                     from '@onderling/vault';
import { RelayTransport }                  from '@onderling/transports';
import { PodTokenRegistry }                from '@onderling/pod-client';

import { startCompanionNode }              from '../src/index.js';
import { buildDevPodSource }               from '../src/podSource.js';

const POD_ROOT = 'https://companion.pod.invalid/';

/** track everything to tear down after each case */
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { await fn(); } catch { /* best-effort */ }
  }
});

/**
 * Boot a host whose pod leg is gated by an injected, owner-issued token.
 *
 * @param {object} o
 * @param {string[]} o.scopes         token scopes (e.g. ['pod.read:/notes/'])
 * @param {string}  o.container       pod container to seed + serve (e.g. 'notes/')
 * @param {Array}   o.files           files to seed into that container
 * @param {number}  [o.expiresIn]     token TTL ms (default 1h)
 * @param {() => number} [o.podNow]   injected clock for the gate's expiry check
 * @param {PodTokenRegistry} [o.registry] owner-side revocation ledger
 */
async function bootGatedHost({ scopes, container, files, expiresIn, podNow, registry }) {
  const owner     = await AgentIdentity.generate(new VaultMemory());   // pod OWNER (issuer)
  const hostVault = new VaultMemory();
  const hostId    = await AgentIdentity.generate(hostVault);           // the delegated host (subject)

  const token = await PodCapabilityToken.issue(owner, {
    subject: hostId.pubKey,
    pod:     POD_ROOT,
    scopes,
    ...(typeof expiresIn === 'number' ? { expiresIn } : {}),
  });

  // The pod source: a dev pod seeded under `container`, rooted at POD_ROOT so the
  // token's `pod` binding + scope paths line up with what listPodFolio walks.
  const podSource = await buildDevPodSource({ podRoot: POD_ROOT, container, files });

  const host = await startCompanionNode({
    identityVault:  hostVault,                           // reuse the pre-generated host key
    gate:           false,                               // isolate the POD gate
    podSource,
    podToken:       token,
    podOwnerPubKey: owner.pubKey,                        // owner-issued trust
    ...(registry ? { podTokenRegistry: registry } : {}),
    ...(typeof podNow === 'function' ? { podNow } : {}),
  });
  cleanups.push(() => host.stop());
  return { host, owner, token };
}

/** A real device agent on the host's relay (gate:false ⇒ no skill token needed). */
async function makeDevice(host) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity:  id,
    transport: new RelayTransport({ relayUrl: host.relayUrl, identity: id }),
    label:     'device',
  });
  await agent.start();
  await agent.hello(host.agent.address);
  cleanups.push(() => agent.stop?.());
  return agent;
}

/** Invoke listFiles({source:'pod'}) over the wire, return the core's reply. */
async function listPodOverWire(device, host) {
  return Parts.data(await device.invoke(host.agent.address, 'listFiles', { source: 'pod' }));
}

describe('companion-node R2b.1 — pod-leg scope gate over a real relay', () => {
  it('IN-SCOPE ALLOW: a pod.read:/notes/ token → listFiles({pod}) returns REAL pod content', async () => {
    const { host } = await bootGatedHost({
      scopes:    ['pod.read:/notes/'],
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n\nThis note lives in the pod.\n', contentType: 'text/markdown' }],
    });
    const device = await makeDevice(host);

    const res = await listPodOverWire(device, host);

    expect(res.source).toBe('pod');
    expect(res.error).toBeUndefined();                       // the gate allowed
    expect(res.items.length).toBeGreaterThan(0);             // real pod leg ran within scope
    expect(res.items.some((i) => i.name === 'welcome.md')).toBe(true);
  }, 20_000);

  it('OUT-OF-SCOPE DENY: a /notes/ token on a /photos/ pod → DENIED, NO bytes returned', async () => {
    // Token scopes /notes/ only; the served container is /photos/ → every list is
    // out of scope. The gate throws an opaque 403; listFiles surfaces it as its
    // honest {items:[], error} boundary-miss (agentCores.js:101). NO photo leaks.
    const { host } = await bootGatedHost({
      scopes:    ['pod.read:/notes/'],
      container: 'photos/',
      files:     [{ name: 'secret.jpg', content: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' }],
    });
    const device = await makeDevice(host);

    const res = await listPodOverWire(device, host);

    expect(res.source).toBe('pod');
    expect(res.items).toEqual([]);                           // no content
    expect(res.error).toMatch(/pod list failed/i);           // denied at the pod leg
    // Prove no byte of the out-of-scope resource leaked back through the reply.
    expect(JSON.stringify(res)).not.toMatch(/secret\.jpg|PRIVATE-PHOTO-BYTES/);
  }, 20_000);

  it('EXPIRED DENY: a token past expiresAt (injected clock) → the SAME in-scope call DENIES', async () => {
    // Signature stays valid (real clock < expiresAt); the injected podNow is past
    // expiresAt, so the verifier's expiry seam denies — isolating expiry from sig.
    const { host } = await bootGatedHost({
      scopes:    ['pod.read:/notes/'],
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n', contentType: 'text/markdown' }],
      expiresIn: 3_600_000,                                  // 1h — sig valid on the real clock
      podNow:    () => Date.now() + 7_200_000,               // but the gate's clock is 2h ahead
    });
    const device = await makeDevice(host);

    const res = await listPodOverWire(device, host);

    expect(res.items).toEqual([]);                           // expired ⇒ no content
    expect(res.error).toMatch(/pod list failed/i);
  }, 20_000);

  it('REVOKED DENY: after registry.revoke(token.id), the SAME previously-working call DENIES', async () => {
    const registry = new PodTokenRegistry(new VaultMemory());
    const { host, token } = await bootGatedHost({
      scopes:    ['pod.read:/notes/'],
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n', contentType: 'text/markdown' }],
      registry,
    });
    const device = await makeDevice(host);

    // First call succeeds — the delegation is live.
    const ok = await listPodOverWire(device, host);
    expect(ok.error).toBeUndefined();
    expect(ok.items.some((i) => i.name === 'welcome.md')).toBe(true);

    // Owner revokes the delegation by id (the gate's isRevoked seam consults this).
    await registry.revoke(token.id);

    // The SAME call now denies — live, per-token revocation at the pod leg.
    const denied = await listPodOverWire(device, host);
    expect(denied.items).toEqual([]);
    expect(denied.error).toMatch(/pod list failed/i);
  }, 20_000);
});
