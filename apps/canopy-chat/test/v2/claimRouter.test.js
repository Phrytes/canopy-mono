/**
 * P6.5 — claim-router tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { routeClaim, makeAfterClaimHook } from '../../src/v2/claimRouter.js';

function override(value) {
  return async (_id) => value;
}

describe('routeClaim', () => {
  const task = { id: 't-1', text: 'Ladder terugbrengen naar Anne' };

  it('returns no-task when task is missing or non-object', async () => {
    expect(await routeClaim({ circleId: 'c', addToPersonalCircle: () => null })).toEqual({ routed: false, reason: 'no-task' });
    expect(await routeClaim({ task: null, circleId: 'c', addToPersonalCircle: () => null })).toEqual({ routed: false, reason: 'no-task' });
  });

  it('returns no-circle when circleId is missing', async () => {
    expect(await routeClaim({ task, addToPersonalCircle: () => null })).toEqual({ routed: false, reason: 'no-circle' });
    expect(await routeClaim({ task, circleId: '', addToPersonalCircle: () => null })).toEqual({ routed: false, reason: 'no-circle' });
  });

  it('returns no-sink when addToPersonalCircle is missing', async () => {
    expect(await routeClaim({ task, circleId: 'c', getOverride: override({}) }))
      .toEqual({ routed: false, reason: 'no-sink' });
  });

  it('returns opted-out when override has no flowThrough.tasksToPersonal', async () => {
    const sink = vi.fn();
    const r = await routeClaim({
      task, circleId: 'selwerd',
      getOverride: override({ flowThrough: { tasksToPersonal: false } }),
      addToPersonalCircle: sink,
    });
    expect(r).toEqual({ routed: false, reason: 'opted-out' });
    expect(sink).not.toHaveBeenCalled();
  });

  it('returns opted-out when override is null/empty', async () => {
    const sink = vi.fn();
    const r = await routeClaim({
      task, circleId: 'selwerd',
      getOverride: override(null),
      addToPersonalCircle: sink,
    });
    expect(r.routed).toBe(false);
    expect(r.reason).toBe('opted-out');
    expect(sink).not.toHaveBeenCalled();
  });

  it('mirrors to personal circle when flowThrough.tasksToPersonal is true', async () => {
    const sink = vi.fn().mockResolvedValue({ id: 'personal-task-99' });
    const r = await routeClaim({
      task, circleId: 'selwerd', circleName: 'Selwerd nabuurschap',
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
    });
    expect(r).toEqual({ routed: true, mirroredTaskId: 'personal-task-99' });
    expect(sink).toHaveBeenCalledWith({
      text:             'Ladder terugbrengen naar Anne',
      originCircleId:   'selwerd',
      originCircleName: 'Selwerd nabuurschap',
      originTaskId:     't-1',
      tag:              'via:selwerd',
    });
  });

  it('returns no-text when claimed task has no renderable title', async () => {
    const sink = vi.fn();
    const r = await routeClaim({
      task: { id: 't-2' /* no text/title/label */ },
      circleId: 'c',
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
    });
    expect(r).toEqual({ routed: false, reason: 'no-text' });
    expect(sink).not.toHaveBeenCalled();
  });

  it('falls back to title / label / name when text is absent', async () => {
    const sink = vi.fn().mockResolvedValue({ itemId: 'x' });
    await routeClaim({
      task: { id: 't', title: 'My ladder' },
      circleId: 'c',
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
    });
    expect(sink.mock.calls[0][0].text).toBe('My ladder');
  });

  it('surfaces sink failure as sink-threw', async () => {
    const sink = vi.fn().mockRejectedValue(new Error('circle full'));
    const r = await routeClaim({
      task, circleId: 'selwerd',
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
    });
    expect(r.routed).toBe(false);
    expect(r.reason).toBe('sink-threw');
    expect(r.detail).toContain('circle full');
  });

  it('treats a throwing override-read as opted-out (predicate already tolerates)', async () => {
    const sink = vi.fn();
    const r = await routeClaim({
      task, circleId: 'selwerd',
      getOverride: async () => { throw new Error('store unavailable'); },
      addToPersonalCircle: sink,
    });
    // shouldRouteClaimToPersonal swallows the throw → returns false →
    // we land in opted-out, never call the sink.
    expect(r).toEqual({ routed: false, reason: 'opted-out' });
    expect(sink).not.toHaveBeenCalled();
  });

  it('returns mirroredTaskId=null when sink returns nothing identifiable', async () => {
    const sink = vi.fn().mockResolvedValue({});  // no id / itemId
    const r = await routeClaim({
      task, circleId: 'c',
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
    });
    expect(r).toEqual({ routed: true, mirroredTaskId: null });
  });
});

describe('makeAfterClaimHook', () => {
  it('builds a hook that resolves circleName via the supplied resolver', async () => {
    const sink = vi.fn().mockResolvedValue({ id: 'p' });
    const hook = makeAfterClaimHook({
      getOverride:       override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
      resolveCircleName: async (id) => ({ selwerd: 'Selwerd nabuurschap' })[id],
    });
    const r = await hook({ task: { id: 't', text: 'pick up' }, circleId: 'selwerd' });
    expect(r.routed).toBe(true);
    expect(sink.mock.calls[0][0].originCircleName).toBe('Selwerd nabuurschap');
  });

  it('skips when called without a circleId (defensive)', async () => {
    const hook = makeAfterClaimHook({
      getOverride: override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: vi.fn(),
    });
    expect(await hook({ task: { id: 't', text: 'x' } })).toEqual({ routed: false, reason: 'no-circle' });
  });

  it('omits circleName when resolveCircleName throws (best-effort)', async () => {
    const sink = vi.fn().mockResolvedValue({ id: 'p' });
    const hook = makeAfterClaimHook({
      getOverride:       override({ flowThrough: { tasksToPersonal: true } }),
      addToPersonalCircle: sink,
      resolveCircleName: async () => { throw new Error('lookup failed'); },
    });
    const r = await hook({ task: { id: 't', text: 'x' }, circleId: 'c' });
    expect(r.routed).toBe(true);
    expect(sink.mock.calls[0][0].originCircleName).toBeUndefined();
  });
});
