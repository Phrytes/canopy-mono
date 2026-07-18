/**
 * applyPrefilledParams — unit tests.
 *
 * Per renderWeb's: prefilledParams is the projector's way of
 * scoping a multi-section op (household's addItem(type, text) — one
 * tool, four sections) so the adapter pre-fills the section's type
 * on dispatch.
 *
 * Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest';

import { applyPrefilledParams } from '../src/applyPrefilledParams.js';

describe('applyPrefilledParams', () => {
  it('returns a shallow clone of args when the affordance has no prefilledParams', () => {
    const args = { text: 'bread' };
    const out  = applyPrefilledParams(args, { opId: 'addItem', label: 'add' });
    expect(out).toEqual({ text: 'bread' });
    expect(out).not.toBe(args);                  // new object
  });

  it('overlays prefilledParams under user args (user wins on conflict)', () => {
    // Household's shopping section: addItem affordance carries
    // { type: 'shopping' } as prefilledParams. Caller passes text only;
    // result should be { type:'shopping', text:'bread' }.
    const out = applyPrefilledParams(
      { text: 'bread' },
      { opId: 'addItem', prefilledParams: { type: 'shopping' } },
    );
    expect(out).toEqual({ type: 'shopping', text: 'bread' });
  });

  it('user-supplied keys override prefilled defaults', () => {
    // A debug surface could re-route a shopping-section button to an
    // errand item by passing an explicit type; the prefill is a
    // default, not authoritative.
    const out = applyPrefilledParams(
      { type: 'errand', text: 'parcel' },
      { opId: 'addItem', prefilledParams: { type: 'shopping' } },
    );
    expect(out).toEqual({ type: 'errand', text: 'parcel' });
  });

  it('treats args missing as {}', () => {
    expect(applyPrefilledParams(undefined, { prefilledParams: { type: 'shopping' } }))
      .toEqual({ type: 'shopping' });
    expect(applyPrefilledParams(null, { prefilledParams: { type: 'shopping' } }))
      .toEqual({ type: 'shopping' });
  });

  it('handles missing affordance defensively', () => {
    expect(applyPrefilledParams({ text: 'x' }, undefined)).toEqual({ text: 'x' });
    expect(applyPrefilledParams({ text: 'x' }, null)).toEqual({ text: 'x' });
  });

  it('does not mutate the caller\'s inputs', () => {
    const args = { text: 'bread' };
    const affordance = { prefilledParams: { type: 'shopping' } };
    applyPrefilledParams(args, affordance);
    expect(args).toEqual({ text: 'bread' });
    expect(affordance).toEqual({ prefilledParams: { type: 'shopping' } });
  });

  it('honours both Affordance and ItemAction shapes (same field name)', () => {
    // ItemAction example (manifest projector emits prefilledParams on
    // itemActions[] when an op surfaces via the type-enum fallback).
    const out = applyPrefilledParams(
      { match: 'urn:item:abc' },
      { opId: 'markComplete', label: 'done', appliesTo: { type: 'shopping' },
        prefilledParams: { type: 'shopping' } },
    );
    expect(out).toEqual({ type: 'shopping', match: 'urn:item:abc' });
  });
});
