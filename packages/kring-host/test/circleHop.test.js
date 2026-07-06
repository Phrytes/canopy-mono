import { describe, it, expect } from 'vitest';
import {
  MAX_HOPS, normalizeHopMode, buildHopChain, makeHopRelayRequest,
} from '../src/circleHop.js';

describe('normalizeHopMode', () => {
  it('coerces the global flag to a boolean', () => {
    expect(normalizeHopMode({ global: true })).toEqual({ global: true });
    expect(normalizeHopMode({ global: false })).toEqual({ global: false });
    expect(normalizeHopMode({})).toEqual({ global: false });
    expect(normalizeHopMode(null)).toEqual({ global: false });
    expect(normalizeHopMode({ global: 'yes' })).toEqual({ global: true }); // truthy → true
  });
});

describe('buildHopChain', () => {
  it('models me → gate → target as one hop within the limit', () => {
    const chain = buildHopChain({
      requester: { id: 'me', label: 'Me' },
      gates: [{ id: 'bert', label: 'Bert' }],
      target: { id: 'sjoerd', label: 'Sjoerd' },
    });
    expect(chain.steps.map((s) => s.role)).toEqual(['me', 'gate', 'target']);
    expect(chain.steps.map((s) => s.label)).toEqual(['Me', 'Bert', 'Sjoerd']);
    expect(chain.hops).toBe(1);
    expect(chain.withinLimit).toBe(true);
  });

  it('a direct (0-gate) chain is not a hop', () => {
    const chain = buildHopChain({ requester: { id: 'me' }, target: { id: 't' } });
    expect(chain.hops).toBe(0);
    expect(chain.withinLimit).toBe(false);
  });

  it('two gates exceeds the max-one-hop limit', () => {
    const chain = buildHopChain({
      requester: { id: 'me' },
      gates: [{ id: 'a' }, { id: 'b' }],
      target: { id: 't' },
    });
    expect(chain.hops).toBe(2);
    expect(chain.withinLimit).toBe(false);
  });

  it('label falls back to id then empty; tolerates missing input', () => {
    const chain = buildHopChain({ gates: [{ id: 'g' }] });
    expect(chain.steps[0]).toEqual({ role: 'me', id: null, label: '' });
    expect(chain.steps[1]).toEqual({ role: 'gate', id: 'g', label: 'g' });
    expect(buildHopChain().steps.map((s) => s.role)).toEqual(['me', 'target']);
  });
});

describe('makeHopRelayRequest', () => {
  it('shapes an anonymized one-hop relay request', () => {
    const req = makeHopRelayRequest({ skill: 'lend a drill', gate: { id: 'bert' } });
    expect(req).toEqual({
      type: 'hop-relay-request', skill: 'lend a drill', gateId: 'bert', anonymized: true, hops: 1,
    });
  });
  it('anonymized can be turned off; tolerates missing fields', () => {
    expect(makeHopRelayRequest({ anonymized: false })).toMatchObject({ anonymized: false, skill: null, gateId: null });
    expect(MAX_HOPS).toBe(1);
  });
});
