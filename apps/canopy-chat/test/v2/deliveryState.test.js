/**
 * δ.2 — deliveryStateMap substrate tests.
 *
 * Pure JS factory; no DOM/RN dependencies.
 */
import { describe, it, expect, vi } from 'vitest';
import { createDeliveryStateMap } from '../../src/v2/deliveryState.js';

describe('createDeliveryStateMap', () => {
  it('returns null for unknown ids', () => {
    const m = createDeliveryStateMap();
    expect(m.get('nope')).toBeNull();
    expect(m.size()).toBe(0);
  });

  it('round-trips pending / sent / failed via set/get', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('b', 'sent');
    m.set('c', 'failed');
    expect(m.get('a')).toBe('pending');
    expect(m.get('b')).toBe('sent');
    expect(m.get('c')).toBe('failed');
    expect(m.size()).toBe(3);
  });

  it('overwrites a previous state for the same id', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('a', 'sent');
    expect(m.get('a')).toBe('sent');
    m.set('a', 'failed');
    expect(m.get('a')).toBe('failed');
    expect(m.size()).toBe(1);
  });

  it('set(id, null) removes the entry', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('a', null);
    expect(m.get('a')).toBeNull();
    expect(m.size()).toBe(0);
  });

  it('clear(id) removes the entry and reports whether it existed', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    expect(m.clear('a')).toBe(true);
    expect(m.clear('a')).toBe(false); // already gone
    expect(m.get('a')).toBeNull();
  });

  it('ignores invalid msgIds + invalid state values', () => {
    const m = createDeliveryStateMap();
    m.set('', 'pending');                   // empty msgId — ignored
    m.set(null, 'pending');                 // non-string  — ignored
    m.set('a', 'bogus');                    // unknown state — ignored
    expect(m.size()).toBe(0);
    expect(m.get('')).toBeNull();
  });

  it('notifies subscribers on set + clear', () => {
    const m = createDeliveryStateMap();
    const fn = vi.fn();
    const off = m.subscribe(fn);
    m.set('a', 'pending');
    m.set('a', 'sent');
    m.set('a', null);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls[0]).toEqual(['a', 'pending']);
    expect(fn.mock.calls[1]).toEqual(['a', 'sent']);
    expect(fn.mock.calls[2]).toEqual(['a', null]);
    off();
    m.set('a', 'failed');
    expect(fn).toHaveBeenCalledTimes(3); // post-unsubscribe: no more calls
  });

  it('swallows subscriber throws so one bad listener cannot block the rest', () => {
    const m = createDeliveryStateMap();
    const good = vi.fn();
    m.subscribe(() => { throw new Error('boom'); });
    m.subscribe(good);
    expect(() => m.set('a', 'pending')).not.toThrow();
    expect(good).toHaveBeenCalledWith('a', 'pending');
  });

  it('does NOT notify when clear targets an unknown id', () => {
    const m = createDeliveryStateMap();
    const fn = vi.fn();
    m.subscribe(fn);
    m.clear('never-was');
    expect(fn).not.toHaveBeenCalled();
  });

  /* ─── δ.2 contract: full optimistic-send lifecycle ─── */

  it('models the happy-path lifecycle: pending → sent', () => {
    const m = createDeliveryStateMap();
    m.set('msg-1', 'pending');
    expect(m.get('msg-1')).toBe('pending');
    // After the broadcast resolves with no errors:
    m.set('msg-1', 'sent');
    expect(m.get('msg-1')).toBe('sent');
  });

  it('models the failure path: pending → failed → (retry) pending → sent', () => {
    const m = createDeliveryStateMap();
    // 1. Initial send fires.
    m.set('msg-1', 'pending');
    // 2. Broadcast rejects (or returns errors).
    m.set('msg-1', 'failed');
    expect(m.get('msg-1')).toBe('failed');
    // 3. User taps the warning icon → host re-fires fan-out with SAME msgId.
    m.set('msg-1', 'pending');
    expect(m.get('msg-1')).toBe('pending');
    // 4. Second attempt succeeds.
    m.set('msg-1', 'sent');
    expect(m.get('msg-1')).toBe('sent');
  });

  it('keeps independent state per msgId during concurrent sends', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('b', 'pending');
    m.set('c', 'pending');
    // Resolves arrive out of order.
    m.set('b', 'failed');
    m.set('a', 'sent');
    // c still in flight.
    expect(m.get('a')).toBe('sent');
    expect(m.get('b')).toBe('failed');
    expect(m.get('c')).toBe('pending');
    expect(m.size()).toBe(3);
  });
});
