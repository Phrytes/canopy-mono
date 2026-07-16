/**
 * companion-node R2b.2 — the device→host `authorizePod` DELEGATION HANDSHAKE.
 *
 * R2b.1 INJECTED the delegated `PodCapabilityToken` at boot. R2b.2 DELIVERS it
 * over the wire: the device (the pod OWNER) mints a token granting THIS host
 * scoped pod access and hands it to the host's `pod.acceptDelegation` control op.
 * The host verifies the grant cryptographically — signature + `subject == host` +
 * `issuer == configured owner` — BEFORE installing it, then its `ScopedPodClient`
 * presents the delivered token so subsequent pod ops are scope/expiry/revocation
 * checked.
 *
 * This suite proves the FULL delegated round-trip over a REAL relay + REAL
 * RelayTransport (the genuine encrypt → relay-forward → decrypt wire path). We
 * assert the RESULT — real pod content returned, or an opaque denial with NO
 * bytes — never merely that a handshake "ran".
 *
 * The host boots FAILING CLOSED (owner configured, no token): pod ops deny until a
 * valid delegation arrives. `gate:false` isolates the POD-delegation leg from the
 * orthogonal R2 SKILL gate (proven in companionGate.test.js).
 *
 * HONESTY: enforcement is IN-PROCESS (the held FsBackedMockPodClient, not an HTTP
 * pod), so this is a REAL DELEGATION trust boundary (the host proves the grant was
 * for IT, from ITS owner) but NOT yet a network-adversary boundary — that arrives
 * with a real HTTP pod / `CapabilityAuth` pod-direct at R3.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, Parts, PodCapabilityToken } from '@onderling/core';
import { VaultMemory }                     from '@onderling/vault';
import { RelayTransport }                  from '@onderling/transports';
import { PodTokenRegistry }                from '@onderling/pod-client';

import { startCompanionNode }              from '../src/index.js';
import { buildDevPodSource }               from '../src/podSource.js';
import { authorizePod, deliverPodDelegation } from '../src/authorizePod.js';

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
 * Boot a host FAILING CLOSED for delegation: owner configured, NO token yet.
 * Pod ops deny until a valid `pod.acceptDelegation` arrives.
 *
 * @param {object} o
 * @param {AgentIdentity} o.owner     the pod owner the host trusts as issuer
 * @param {string}  o.container       pod container to seed + serve (e.g. 'notes/')
 * @param {Array}   o.files           files to seed into that container
 * @param {PodTokenRegistry} [o.registry] owner-side revocation ledger
 */
async function bootFailClosedHost({ owner, container, files, registry }) {
  const podSource = await buildDevPodSource({ podRoot: POD_ROOT, container, files });
  const host = await startCompanionNode({
    identityVault:  new VaultMemory(),
    gate:           false,                 // isolate the POD-delegation leg
    podSource,
    // podToken OMITTED — the token is DELIVERED over the wire, not injected.
    podOwnerPubKey: owner.pubKey,          // delegation trust root ⇒ fail-closed boot
    ...(registry ? { podTokenRegistry: registry } : {}),
  });
  cleanups.push(() => host.stop());
  return host;
}

/**
 * A real device agent on the host's relay. When `identity` is the pod owner, the
 * device IS the owner (mints + delivers its own delegation).
 */
async function makeDevice(host, identity) {
  const id = identity ?? await AgentIdentity.generate(new VaultMemory());
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

describe('companion-node R2b.2 — authorizePod delegation handshake over a real relay', () => {
  it('DELIVER + ALLOW: fail-closed host, owner delegates /notes/ → pod list ALLOWS real content', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());   // device == owner
    const host  = await bootFailClosedHost({
      owner,
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n\nThis note lives in the pod.\n', contentType: 'text/markdown' }],
    });
    const device = await makeDevice(host, owner);

    // BEFORE delivery: the host is failing closed — pod ops deny (no bytes).
    const before = await listPodOverWire(device, host);
    expect(before.items).toEqual([]);
    expect(before.error).toMatch(/pod list failed/i);

    // Owner mints a /notes/ delegation FOR THIS host and delivers it over the wire.
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect(token.subject).toBe(host.agent.address);   // subject == host
    expect(token.issuer).toBe(owner.pubKey);           // issuer == owner

    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);
    expect(ack.subject).toBe(host.agent.address);

    // AFTER delivery: the SAME call now returns REAL pod content within scope.
    const after = await listPodOverWire(device, host);
    expect(after.error).toBeUndefined();
    expect(after.source).toBe('pod');
    expect(after.items.some((i) => i.name === 'welcome.md')).toBe(true);
  }, 20_000);

  it('WRONG-SUBJECT REJECT: a token delegated to ANOTHER key → rejected, pod stays closed', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const host  = await bootFailClosedHost({
      owner,
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n', contentType: 'text/markdown' }],
    });
    const device = await makeDevice(host, owner);

    // Validly-signed by the owner, but subject is some OTHER key — not this host.
    const other = await AgentIdentity.generate(new VaultMemory());
    const misdirected = await PodCapabilityToken.issue(owner, {
      subject: other.pubKey, pod: POD_ROOT, scopes: ['pod.read:/notes/'],
    });

    const ack = await deliverPodDelegation(device, host.agent.address, misdirected);
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('delegation rejected');    // opaque — no leak of which check failed

    // Not installed: pod ops still deny.
    const denied = await listPodOverWire(device, host);
    expect(denied.items).toEqual([]);
    expect(denied.error).toMatch(/pod list failed/i);
  }, 20_000);

  it('WRONG-ISSUER REJECT: a valid token from a NON-owner issuer → rejected, pod stays closed', async () => {
    const owner   = await AgentIdentity.generate(new VaultMemory());
    const impostor = await AgentIdentity.generate(new VaultMemory());   // NOT the configured owner
    const host    = await bootFailClosedHost({
      owner,
      container: 'notes/',
      files:     [{ name: 'welcome.md', content: '# Welcome\n', contentType: 'text/markdown' }],
    });
    // The impostor is a real device on the relay, correctly targeting THIS host…
    const device = await makeDevice(host, impostor);

    // …with a well-formed, validly-SIGNED token bound to the host — but issued by
    // the impostor, not the owner. Only the configured owner may delegate.
    const forged = await authorizePod(impostor, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect(PodCapabilityToken.verify(forged.toJSON())).toBe(true);   // signature is genuine

    const ack = await deliverPodDelegation(device, host.agent.address, forged);
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('delegation rejected');

    const denied = await listPodOverWire(device, host);
    expect(denied.items).toEqual([]);
    expect(denied.error).toMatch(/pod list failed/i);
  }, 20_000);

  it('OUT-OF-SCOPE + REVOKE still hold after the handshake', async () => {
    // ── OUT-OF-SCOPE: deliver a /notes/ grant to a host whose pod serves /photos/.
    // The delegation INSTALLS (subject/issuer/sig all valid) but every list is out
    // of scope → the installed ScopedPodClient denies. Scope survives delivery.
    {
      const owner = await AgentIdentity.generate(new VaultMemory());
      const host  = await bootFailClosedHost({
        owner,
        container: 'photos/',
        files:     [{ name: 'secret.jpg', content: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' }],
      });
      const device = await makeDevice(host, owner);

      const token = await authorizePod(owner, host.agent.address, {
        scopes: ['pod.read:/notes/'], pod: POD_ROOT,     // grants /notes/, pod serves /photos/
      });
      const ack = await deliverPodDelegation(device, host.agent.address, token);
      expect(ack.ok).toBe(true);                          // delegation is valid + installed

      const res = await listPodOverWire(device, host);
      expect(res.items).toEqual([]);                      // …but /photos/ is out of scope
      expect(res.error).toMatch(/pod list failed/i);
      expect(JSON.stringify(res)).not.toMatch(/secret\.jpg|PRIVATE-PHOTO-BYTES/);
    }

    // ── REVOKE: deliver an in-scope /notes/ grant, list works, owner revokes via
    // the registry → the SAME live call denies. Revocation survives the handshake.
    {
      const registry = new PodTokenRegistry(new VaultMemory());
      const owner    = await AgentIdentity.generate(new VaultMemory());
      const host     = await bootFailClosedHost({
        owner, registry,
        container: 'notes/',
        files:     [{ name: 'welcome.md', content: '# Welcome\n', contentType: 'text/markdown' }],
      });
      const device = await makeDevice(host, owner);

      const token = await authorizePod(owner, host.agent.address, {
        scopes: ['pod.read:/notes/'], pod: POD_ROOT,
      });
      const ack = await deliverPodDelegation(device, host.agent.address, token);
      expect(ack.ok).toBe(true);

      const ok = await listPodOverWire(device, host);
      expect(ok.error).toBeUndefined();
      expect(ok.items.some((i) => i.name === 'welcome.md')).toBe(true);

      await registry.revoke(token.id);                    // owner-side revocation

      const denied = await listPodOverWire(device, host);
      expect(denied.items).toEqual([]);
      expect(denied.error).toMatch(/pod list failed/i);
    }
  }, 30_000);
});
