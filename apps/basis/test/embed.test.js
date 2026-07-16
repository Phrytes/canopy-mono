/**
 * basis — embed primitive tests.  v0.5 (J7).
 */
import { describe, it, expect } from 'vitest';

import { buildEmbed, claimEmbed, embedActionsFor } from '../src/index.js';

const snap = (overrides = {}) => ({
  id:    'c-1',
  type:  'chore',
  state: 'open',
  title: 'Dishwasher',
  fields: { state: 'open', assigned_to: 'unassigned' },
  ...overrides,
});

describe('buildEmbed', () => {
  it("produces an item-card embed from a snapshot", () => {
    const e = buildEmbed({ appOrigin: 'household', snapshot: snap() });
    expect(e).toEqual({
      kind:      'item-card',
      appOrigin: 'household',
      itemRef:   { app: 'household', type: 'chore', id: 'c-1' },
      snapshot:  snap(),
    });
  });

  it("includes issuedBy when provided", () => {
    const e = buildEmbed({
      appOrigin: 'household', snapshot: snap(),
      issuedBy:  'webid:frits',
    });
    expect(e.issuedBy).toBe('webid:frits');
  });

  it.each([
    [{ appOrigin: '', snapshot: snap() },                 /appOrigin required/],
    [{ appOrigin: 'household' },                          /snapshot/],
    [{ appOrigin: 'household', snapshot: { id: 'x' } },   /snapshot/],
    [{ appOrigin: 'household', snapshot: { type: 't' } }, /snapshot/],
  ])('rejects %j', (args, pattern) => {
    expect(() => buildEmbed(args)).toThrow(pattern);
  });
});

describe('claimEmbed', () => {
  it('returns a NEW embed with claimedBy + claimedAt set', () => {
    const e1 = buildEmbed({ appOrigin: 'household', snapshot: snap(), issuedBy: 'webid:a' });
    const e2 = claimEmbed(e1, 'webid:anne', 1_700_000_000_000);
    expect(e1.claimedBy).toBeUndefined();      // immutable
    expect(e2).toMatchObject({
      ...e1,
      claimedBy: 'webid:anne',
      claimedAt: 1_700_000_000_000,
    });
  });

  it('defaults claimedAt to Date.now()', () => {
    const before = Date.now();
    const e = claimEmbed(buildEmbed({ appOrigin: 'household', snapshot: snap() }), 'webid:x');
    expect(typeof e.claimedAt).toBe('number');
    expect(e.claimedAt).toBeGreaterThanOrEqual(before);
  });

  it.each([
    [null,                              'webid:x',        /item-card embed required/],
    [{ kind: 'other' },                 'webid:x',        /item-card embed required/],
    [{ kind: 'item-card' },             '',               /claimedBy required/],
    [{ kind: 'item-card' },             null,             /claimedBy required/],
  ])('rejects invalid inputs', (embed, claimer, pattern) => {
    expect(() => claimEmbed(embed, claimer)).toThrow(pattern);
  });
});

describe('embedActionsFor', () => {
  const manifest = {
    app: 'household', itemTypes: ['chore'],
    operations: [
      {
        id: 'markComplete', verb: 'complete',
        appliesTo: { type: 'chore', state: 'open' },
        params: [],
        surfaces: { ui: { control: 'button', label: 'Mark done' } },
      },
      {
        id: 'reopen', verb: 'reopen',
        appliesTo: { type: 'chore', state: 'done' },
        params: [],
        surfaces: { ui: { control: 'button', label: 'Re-open' } },
      },
      {
        id: 'noUi', verb: 'do', params: [],
        surfaces: { chat: { hint: 'no ui' } },
      },
    ],
  };

  it('surfaces only buttons matching appliesTo (open → markComplete)', () => {
    const e = buildEmbed({ appOrigin: 'household', snapshot: snap({ state: 'open' }) });
    expect(embedActionsFor(e, manifest)).toEqual([
      { opId: 'markComplete', label: 'Mark done', callbackData: 'markComplete:c-1' },
    ]);
  });

  it('different state → different action (done → reopen)', () => {
    const e = buildEmbed({ appOrigin: 'household', snapshot: snap({ state: 'done' }) });
    expect(embedActionsFor(e, manifest)).toEqual([
      { opId: 'reopen', label: 'Re-open', callbackData: 'reopen:c-1' },
    ]);
  });

  it("returns [] for unknown state", () => {
    const e = buildEmbed({ appOrigin: 'household', snapshot: snap({ state: 'mystery' }) });
    expect(embedActionsFor(e, manifest)).toEqual([]);
  });

  it("returns [] for null/empty manifest", () => {
    const e = buildEmbed({ appOrigin: 'household', snapshot: snap() });
    expect(embedActionsFor(e, null)).toEqual([]);
    expect(embedActionsFor(e, {})).toEqual([]);
    expect(embedActionsFor(e, { operations: [] })).toEqual([]);
  });
});

describe('v0.5.1 — receiver-claim + sender-claim-on-behalf flows', () => {
  it("claimEmbed produces a NEW embed with claimedBy + claimedAt (receiver path)", () => {
    const e1 = buildEmbed({
      appOrigin: 'household',
      snapshot: { id: 'c-1', type: 'chore', state: 'open', title: 'X' },
      issuedBy:  'webid:frits',
    });
    const e2 = claimEmbed(e1, 'webid:anne');
    expect(e1.claimedBy).toBeUndefined();
    expect(e2.claimedBy).toBe('webid:anne');
    expect(typeof e2.claimedAt).toBe('number');
  });

  it("sender-claim-on-behalf shape: same issuer + claimer (atomic)", () => {
    // Sender claims as they issue — both fields set to local actor.
    let embed = buildEmbed({
      appOrigin: 'household',
      snapshot: { id: 'c-1', type: 'chore', state: 'open', title: 'X' },
      issuedBy:  'webid:local-demo-user',
    });
    embed = { ...embed, claimedBy: 'webid:local-demo-user', claimedAt: Date.now() };
    expect(embed.issuedBy).toBe(embed.claimedBy);
  });
});
