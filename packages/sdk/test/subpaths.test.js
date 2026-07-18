import { describe, it, expect } from 'vitest';

/**
 * sub-path exports. Each slice must resolve (through the package.json
 * `exports` map + the workspace symlink) to exactly its expected symbols, and
 * the main barrel must remain the SUM of the slices (byte-compatible surface).
 */

describe('SP-9 sub-path exports — each slice resolves to its symbols', () => {
  it('@onderling/sdk/core → the kernel base (Agent, AgentIdentity, …) and NOT the extensions', async () => {
    const core = await import('@onderling/sdk/core');
    for (const name of ['Agent', 'AgentIdentity', 'InternalBus', 'InternalTransport', 'OfflineTransport', 'Parts']) {
      expect(core[name], name).toBeDefined();
    }
    // The base slice is the kernel ONLY — no adapter/high extensions leak in.
    expect(core.VaultMemory).toBeUndefined();
    expect(core.RelayTransport).toBeUndefined();
    expect(core.createAgent).toBeUndefined();
  });

  it('@onderling/sdk/transports → the concrete network transports only', async () => {
    const t = await import('@onderling/sdk/transports');
    for (const name of ['NknTransport', 'MqttTransport', 'RelayTransport', 'RendezvousTransport']) {
      expect(typeof t[name], name).toBe('function');
    }
    // Base transports stay in core, not here.
    expect(t.InternalTransport).toBeUndefined();
  });

  it('@onderling/sdk/vault → the Vault family + OAuth helper only', async () => {
    const v = await import('@onderling/sdk/vault');
    for (const name of ['Vault', 'VaultMemory', 'VaultLocalStorage', 'VaultIndexedDB', 'VaultNodeFs', 'OAuthVault', 'makeAuthorizedFetch']) {
      expect(v[name], name).toBeDefined();
    }
    expect(new v.VaultMemory()).toBeTruthy();
    expect(v.Agent).toBeUndefined();
  });

  it('@onderling/sdk/pod → the pod-client surface', async () => {
    const p = await import('@onderling/sdk/pod');
    for (const name of ['PodClient', 'SolidPodSource', 'ConflictResolver']) {
      expect(typeof p[name], name).toBe('function');
    }
  });

  it('@onderling/sdk/high → createAgent / connectSkill / wireSkill only', async () => {
    const h = await import('@onderling/sdk/high');
    expect(typeof h.createAgent).toBe('function');
    expect(typeof h.connectSkill).toBe('function');
    expect(typeof h.wireSkill).toBe('function');
    // No kernel base leaks into the high slice.
    expect(h.Agent).toBeUndefined();
  });
});

describe('SP-9 barrel stays intact — the sum of the slices', () => {
  it('the barrel re-exports every slice (same symbols the sub-paths expose)', async () => {
    const [b, core, t, v, p, h, r] = await Promise.all([
      import('@onderling/sdk'),
      import('@onderling/sdk/core'),
      import('@onderling/sdk/transports'),
      import('@onderling/sdk/vault'),
      import('@onderling/sdk/pod'),
      import('@onderling/sdk/high'),
      import('@onderling/sdk/requires'),
    ]);
    // Every symbol from every slice is present on the barrel and identical.
    for (const slice of [core, t, v, p, h]) {
      for (const [name, val] of Object.entries(slice)) {
        expect(b[name], `barrel is missing ${name}`).toBe(val);
      }
    }
    // The requires vocab + validator are surfaced on the barrel too.
    expect(b.validateRequires).toBe(r.validateRequires);
    expect(b.CAPABILITIES).toBe(r.CAPABILITIES);
  });

  it('a smoke import of a representative slice from each layer still works', async () => {
    const { Agent, VaultMemory, RelayTransport, PodClient, createAgent, validateRequires } = await import('@onderling/sdk');
    expect(typeof Agent).toBe('function');
    expect(typeof VaultMemory).toBe('function');
    expect(typeof RelayTransport).toBe('function');
    expect(typeof PodClient).toBe('function');
    expect(typeof createAgent).toBe('function');
    expect(typeof validateRequires).toBe('function');
  });
});
