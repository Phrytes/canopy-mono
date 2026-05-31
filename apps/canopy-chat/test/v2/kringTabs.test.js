import { describe, it, expect } from 'vitest';
import { buildKringTabs, DEFAULT_KRING_TAB } from '../../src/v2/kringTabs.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;

describe('buildKringTabs · SP-13.3', () => {
  it('exposes the canonical default-tab id', () => {
    expect(DEFAULT_KRING_TAB).toBe('gesprek');
  });

  it('default policy → GESPREK + LEDEN (chat + memberDirectory are default on)', () => {
    const tabs = buildKringTabs(DEFAULT_CIRCLE_POLICY).map((t) => t.id);
    expect(tabs).toEqual(['gesprek', 'leden']);
  });

  it('buurt-shape policy → GESPREK / PRIKBORD / LEDEN (board Voorbeeld 1)', () => {
    const policy = {
      features: { chat: true, noticeboard: true, memberDirectory: true },
    };
    expect(buildKringTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'prikbord', 'leden']);
  });

  it('huishouden-shape policy → GESPREK / TAKEN / LIJSTEN (board Voorbeeld 2)', () => {
    const policy = {
      features: { chat: true, tasks: true, lists: true, memberDirectory: false },
    };
    expect(buildKringTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'taken', 'lijsten']);
  });

  it('privé-shape policy → GESPREK / NOTITIES / TAKEN (board Voorbeeld 3)', () => {
    const policy = {
      features: { chat: true, notes: true, tasks: true, memberDirectory: false },
    };
    expect(buildKringTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'taken', 'notities']);
  });

  it('GESPREK is always first even when the chat feature is explicitly off', () => {
    // v2 §1 — chat is the kring core; turning it "off" hides PUSH /
    // settings UI for chat-notifications but the tab itself stays
    // because every kring needs at least one reachable surface.
    const policy = { features: { chat: false, noticeboard: true } };
    const ids = buildKringTabs(policy).map((t) => t.id);
    expect(ids[0]).toBe('gesprek');
    expect(ids).toContain('prikbord');
  });

  it('LEDEN renders last when memberDirectory is on (per board ordering)', () => {
    const policy = {
      features: {
        chat: true, noticeboard: true, tasks: true,
        memberDirectory: true, lists: true,
      },
    };
    const ids = buildKringTabs(policy).map((t) => t.id);
    expect(ids[ids.length - 1]).toBe('leden');
  });

  it('all-features-on policy → full ordered tab list', () => {
    const policy = {
      features: {
        chat: true, noticeboard: true, tasks: true,
        lists: true, notes: true, calendar: true,
        memberDirectory: true, houseRules: true,
      },
    };
    // houseRules has NO tab — lives in `⋯` overflow as "Huisregels".
    expect(buildKringTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'prikbord', 'taken', 'lijsten', 'notities', 'agenda', 'leden']);
  });

  it('houseRules does not produce a tab', () => {
    // Explicitly turn memberDirectory off so the only on-by-default
    // feature besides chat doesn't show up in the assertion.
    const policy = { features: { chat: true, houseRules: true, memberDirectory: false } };
    expect(buildKringTabs(policy).map((t) => t.id)).toEqual(['gesprek']);
  });

  it('includes resolved `label` strings only when a translator is passed', () => {
    const policy = { features: { chat: true } };
    expect(buildKringTabs(policy)[0]).toEqual({
      id: 'gesprek', feature: 'chat', labelKey: 'circle.tabs.gesprek',
    });
    expect(buildKringTabs(policy, t)[0]).toEqual({
      id: 'gesprek', feature: 'chat',
      labelKey: 'circle.tabs.gesprek',
      label:    'circle.tabs.gesprek',
    });
  });

  it('handles null / empty / garbage policy gracefully (treats as defaults)', () => {
    expect(buildKringTabs(null).map((t) => t.id)).toEqual(['gesprek', 'leden']);
    expect(buildKringTabs(undefined).map((t) => t.id)).toEqual(['gesprek', 'leden']);
    expect(buildKringTabs('nope').map((t) => t.id)).toEqual(['gesprek', 'leden']);
  });
});
