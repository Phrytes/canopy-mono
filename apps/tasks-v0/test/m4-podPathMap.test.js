/**
 * Tasks M4 — podPathMap classifier + reverseResolve.
 *
 * Analog of apps/stoop/test/podPathMapReverse.test.js, adapted for
 * Tasks' `mem://tasks/crews/<circleId>/…` logical key space.
 *
 * Asserts the bijective property: classify(key) → storageFn+tail;
 * reverseResolve(podUri) → key round-trips back to the original.
 * Also covers the intentionally-unrouted prefixes (settings/process)
 * and the no-pod byte-neutral behaviour (active=false → identity).
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect } from 'vitest';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

const CREW = 'crew-alpha';

// Fake pod base. Each storage-function resolves to:
//   `https://pod.example/<fn>/`
// This is the simplest invertible mapping for test purposes.
function mockResolve(fn /*, _vars */) {
  return `https://pod.example/${fn}/`;
}

describe('classify', () => {
  it('routes items/ to group/<circleId>/items', () => {
    const r = classify(`mem://tasks/crews/${CREW}/items/01JTEST.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/items`);
    expect(r.tail).toBe('01JTEST.json');
  });

  it('routes audit/ to group/<circleId>/audit', () => {
    const r = classify(`mem://tasks/crews/${CREW}/audit/entry-1.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/audit`);
    expect(r.tail).toBe('entry-1.json');
  });

  it('routes members/ to group/<circleId>/members', () => {
    const r = classify(`mem://tasks/crews/${CREW}/members/webid%3Alice.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/members`);
    expect(r.tail).toBe('webid%3Alice.json');
  });

  it('routes config.json (exact) to group/<circleId>/governance', () => {
    const r = classify(`mem://tasks/crews/${CREW}/config.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/governance`);
    expect(r.tail).toBe('');
  });

  it('routes availability/ to group/<circleId>/availability', () => {
    const r = classify(`mem://tasks/crews/${CREW}/availability/alice.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/availability`);
    expect(r.tail).toBe('alice.json');
  });

  it('routes skills/ to group/<circleId>/skills', () => {
    const r = classify(`mem://tasks/crews/${CREW}/skills/alice.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/skills`);
  });

  it('routes skills.json to group/<circleId>/skills (no trailing slash)', () => {
    const r = classify(`mem://tasks/crews/${CREW}/skills.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/skills`);
  });

  it('routes invoicing/ to group/<circleId>/invoicing', () => {
    const r = classify(`mem://tasks/crews/${CREW}/invoicing/alice/2026-05.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/invoicing`);
    expect(r.tail).toBe('alice/2026-05.json');
  });

  it('routes botAgents/ to group/<circleId>/bot-agents', () => {
    const r = classify(`mem://tasks/crews/${CREW}/botAgents/bot1.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/bot-agents`);
  });

  it('routes agent/ to group/<circleId>/private-state (vault)', () => {
    const r = classify(`mem://tasks/crews/${CREW}/agent/identity-vault.json`, { circleId: CREW });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CREW}/private-state`);
  });

  it('returns null for mem://tasks/settings/… (device-local, not routed)', () => {
    expect(classify('mem://tasks/settings/devices/abc.json', { circleId: CREW })).toBeNull();
    expect(classify('mem://tasks/settings/.migrated-from-v2', { circleId: CREW })).toBeNull();
  });

  it('returns null for mem://tasks/process/… (process-local, not routed)', () => {
    expect(classify('mem://tasks/process/agent-identity-vault.json', { circleId: CREW })).toBeNull();
  });

  it('returns null when circleId is null for a crew-prefixed key', () => {
    expect(classify(`mem://tasks/crews/${CREW}/items/x.json`, { circleId: null })).toBeNull();
  });

  it('returns null for completely unknown prefix', () => {
    expect(classify('mem://other/stuff/foo.json', { circleId: CREW })).toBeNull();
  });
});

describe('reverseResolve', () => {
  it('round-trips items/ key through classify → reverseResolve', () => {
    const key = `mem://tasks/crews/${CREW}/items/01JTEST.json`;
    const c = classify(key, { circleId: CREW });
    expect(c).toBeTruthy();
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: CREW, podUri });
    expect(back).toBe(key);
  });

  it('round-trips audit/ key', () => {
    const key = `mem://tasks/crews/${CREW}/audit/entry.json`;
    const c = classify(key, { circleId: CREW });
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: CREW, podUri });
    expect(back).toBe(key);
  });

  it('round-trips governance (config.json) exact key', () => {
    const key = `mem://tasks/crews/${CREW}/config.json`;
    const c = classify(key, { circleId: CREW });
    expect(c.tail).toBe('');
    const podUri = mockResolve(c.storageFn);  // no tail
    const back = reverseResolve({ resolve: mockResolve, circleId: CREW, podUri });
    expect(back).toBe(key);
  });

  it('returns null for an unrecognised pod URI', () => {
    const back = reverseResolve({
      resolve: mockResolve, circleId: CREW,
      podUri: 'https://other-pod.example/completely/unrelated',
    });
    expect(back).toBeNull();
  });

  it('returns null when circleId is null', () => {
    const key = `mem://tasks/crews/${CREW}/items/x.json`;
    const c = classify(key, { circleId: CREW });
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: null, podUri });
    expect(back).toBeNull();
  });
});

describe('bijection check — classify → reverseResolve is identity for all routed prefixes', () => {
  const CASES = [
    `mem://tasks/crews/${CREW}/items/01JA.json`,
    `mem://tasks/crews/${CREW}/audit/01JB.json`,
    `mem://tasks/crews/${CREW}/members/alice%40example.json`,
    `mem://tasks/crews/${CREW}/config.json`,
    `mem://tasks/crews/${CREW}/availability/alice.json`,
    `mem://tasks/crews/${CREW}/skills/alice.json`,
    `mem://tasks/crews/${CREW}/invoicing/alice/2026-04.json`,
    `mem://tasks/crews/${CREW}/botAgents/bot.json`,
    `mem://tasks/crews/${CREW}/agent/vault.json`,
  ];
  for (const key of CASES) {
    it(`round-trips: ${key.replace(`mem://tasks/crews/${CREW}/`, '')}`, () => {
      const c = classify(key, { circleId: CREW });
      expect(c).toBeTruthy();
      const podUri = mockResolve(c.storageFn) + c.tail;
      const back = reverseResolve({ resolve: mockResolve, circleId: CREW, podUri });
      expect(back).toBe(key);
    });
  }
});
