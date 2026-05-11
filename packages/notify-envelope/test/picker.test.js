/**
 * pickMode — per-write mode selection.
 *
 * The picker is a pure function — exhaustive coverage here, then
 * the integration tests verify the wiring at the substrate level.
 */

import { describe, it, expect } from 'vitest';
import { pickMode } from '../src/picker.js';

function reachableRouting()   { return { isPodReachable: () => true }; }
function unreachableRouting() { return { isPodReachable: () => false }; }

describe('pickMode', () => {
  it('pseudo-pod:// ref → full-payload, no queue', () => {
    const d = pickMode({
      ref:        'pseudo-pod://anne-device/tasks/abc',
      podRouting: reachableRouting(),   // irrelevant for pseudo-pod refs
    });
    expect(d).toEqual({
      mode:   'full-payload',
      queue:  false,
      reason: 'pseudo-pod-ref',
    });
  });

  it('pseudo-pod:// ref ignores reachability', () => {
    const d = pickMode({
      ref:        'pseudo-pod://anne-device/x',
      podRouting: unreachableRouting(),
    });
    expect(d.mode).toBe('full-payload');
    expect(d.queue).toBe(false);
  });

  it('https:// ref + pod reachable → envelope-only, no queue', () => {
    const d = pickMode({
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      podRouting: reachableRouting(),
    });
    expect(d).toEqual({
      mode:   'envelope-only',
      queue:  false,
      reason: 'pod-reachable',
    });
  });

  it('https:// ref + pod unreachable → full-payload, queue=true', () => {
    const d = pickMode({
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      podRouting: unreachableRouting(),
    });
    expect(d).toEqual({
      mode:   'full-payload',
      queue:  true,
      reason: 'pod-unreachable-fallback',
    });
  });

  it('throws on missing ref', () => {
    expect(() => pickMode({ podRouting: reachableRouting() })).toThrow(/ref/);
  });

  it('throws on missing podRouting', () => {
    expect(() => pickMode({ ref: 'https://x' })).toThrow(/podRouting/);
  });

  it('consults podRouting.isPodReachable with the actual ref', () => {
    let seen = null;
    const r = { isPodReachable: (uri) => { seen = uri; return true; } };
    pickMode({ ref: 'https://x.pod/y', podRouting: r });
    expect(seen).toBe('https://x.pod/y');
  });
});
