import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';

describe('LOW layer — one import, explicit adapters (re-exports resolve)', () => {
  it('re-exports the kernel (@onderling/core) surface', () => {
    // A representative slice of the kernel that must come through `export *`.
    for (const name of ['Agent', 'AgentIdentity', 'InternalBus', 'InternalTransport', 'OfflineTransport', 'Parts', 'Emitter']) {
      expect(sdk[name], name).toBeDefined();
    }
  });

  it('re-exports the Vault family from @onderling/vault (VaultMemory is the default)', () => {
    for (const name of ['Vault', 'VaultMemory', 'VaultLocalStorage', 'VaultIndexedDB', 'VaultNodeFs', 'OAuthVault']) {
      expect(sdk[name], name).toBeDefined();
    }
    expect(typeof sdk.VaultMemory).toBe('function');
    // It really constructs.
    expect(new sdk.VaultMemory()).toBeTruthy();
  });

  it('re-exports the transports from @onderling/transports', () => {
    for (const name of ['NknTransport', 'MqttTransport', 'RelayTransport', 'RendezvousTransport']) {
      expect(sdk[name], name).toBeDefined();
      expect(typeof sdk[name]).toBe('function');
    }
  });

  it('re-exports a pod piece from @onderling/pod-client', () => {
    for (const name of ['PodClient', 'SolidPodSource', 'ConflictResolver']) {
      expect(sdk[name], name).toBeDefined();
      expect(typeof sdk[name]).toBe('function');
    }
  });

  it('exposes the HIGH-layer helpers alongside the low layer', () => {
    expect(typeof sdk.createAgent).toBe('function');
    expect(typeof sdk.connectSkill).toBe('function');
  });
});
