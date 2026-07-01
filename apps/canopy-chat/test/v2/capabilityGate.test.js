/**
 * capabilityGate — B · Slice 1 default-deny authorization boundary.
 * Covers: default-on (unconfigured), app-level deny, (verb×noun) granularity,
 * arg-aware noun resolution, and domain-verb pass-through.
 */
import { describe, it, expect } from 'vitest';
import { effectiveCapabilities, checkCapability, capabilityKey } from '../../src/v2/capabilityGate.js';

const household = {
  app: 'household',
  itemTypes: ['shopping', 'task', 'contact'],
  domainVerbs: ['help', 'register'],
  nouns: {
    shopping: { atoms: ['add', 'list', 'complete', 'remove'] },
    task:     { atoms: ['add', 'complete', 'claim'] },
  },
  operations: [
    { id: 'addItem',  verb: 'add',      params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'addTask',  verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'claim',    verb: 'claim',    appliesTo: { type: 'task' } },
    { id: 'help',     verb: 'help' },
    { id: 'register', verb: 'register', appliesTo: { type: 'contact' } },
  ],
};
const calendar = {
  app: 'calendar',
  itemTypes: ['calendar-event'],
  nouns: { 'calendar-event': { atoms: ['add', 'list', 'remove'] } },
  operations: [{ id: 'addEvent', verb: 'add', appliesTo: { type: 'calendar-event' } }],
};
const sources = [{ manifest: household }, { manifest: calendar }];

const op = (id) => [...household.operations, ...calendar.operations].find((o) => o.id === id);

describe('effectiveCapabilities', () => {
  it('unconfigured policy (apps=null) → every app enabled (default-on migration)', () => {
    const eff = effectiveCapabilities(sources, { apps: null });
    expect(eff.enabledApps).toBe(null);
    expect(eff.keys.has(capabilityKey('household', 'add', 'shopping'))).toBe(true);
    expect(eff.keys.has(capabilityKey('calendar', 'add', 'calendar-event'))).toBe(true);
  });
  it('a policy.apps list contributes only the enabled apps’ capabilities', () => {
    const eff = effectiveCapabilities(sources, { apps: ['household'] });
    expect(eff.enabledApps.has('household')).toBe(true);
    expect(eff.keys.has(capabilityKey('household', 'add', 'task'))).toBe(true);
    expect([...eff.keys].some((k) => k.startsWith('calendar '))).toBe(false);
  });
});

describe('checkCapability — default-deny', () => {
  const enabledAll = effectiveCapabilities(sources, { apps: null });
  const onlyHousehold = effectiveCapabilities(sources, { apps: ['household'] });

  it('allows an in-set capability (arg-resolved noun)', () => {
    expect(checkCapability({ op: op('addItem'), appOrigin: 'household', args: { type: 'shopping' } }, enabledAll))
      .toMatchObject({ allow: true });
    expect(checkCapability({ op: op('addTask'), appOrigin: 'household', args: {} }, enabledAll))
      .toMatchObject({ allow: true });
  });

  it('DENIES an op from a disabled app (the leakage fix — even when invoked directly)', () => {
    const r = checkCapability({ op: op('addEvent'), appOrigin: 'calendar', args: {} }, onlyHousehold);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('app-disabled');
  });

  it('DENIES a capability absent from the effective set (verb×noun granularity)', () => {
    // Effective set has add/list/complete/remove on shopping; `claim` on shopping is NOT granted.
    const narrow = { keys: new Set([capabilityKey('household', 'add', 'shopping')]), enabledApps: new Set(['household']) };
    const r = checkCapability({ op: { verb: 'claim', appliesTo: { type: 'shopping' } }, appOrigin: 'household', args: {} }, narrow);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('capability-denied');
  });

  it('lets a domain verb through for an enabled app (help/register aren’t capabilities)', () => {
    expect(checkCapability({ op: op('help'), appOrigin: 'household' }, onlyHousehold)).toMatchObject({ allow: true });
    expect(checkCapability({ op: op('register'), appOrigin: 'household', args: {} }, onlyHousehold)).toMatchObject({ allow: true });
  });

  it('but STILL denies a domain verb from a DISABLED app', () => {
    const r = checkCapability({ op: { verb: 'sync' }, appOrigin: 'folio' }, onlyHousehold);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('app-disabled');
  });

  it('fails closed on a missing appOrigin (routing defect)', () => {
    expect(checkCapability({ op: op('addTask'), args: {} }, enabledAll).allow).toBe(false);
  });
});
