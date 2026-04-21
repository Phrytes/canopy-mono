import { describe, it, expect, vi } from 'vitest';
import { FallbackTable } from '../src/routing/FallbackTable.js';

describe('FallbackTable', () => {
  it('records a latency entry and retrieves it via getBest', () => {
    const ft = new FallbackTable();
    ft.record('peer1', 'relay', 50);
    expect(ft.getBest('peer1')).toBe('relay');
  });

  it('getBest returns null when no data for peer', () => {
    const ft = new FallbackTable();
    expect(ft.getBest('unknown')).toBeNull();
  });

  it('getBest returns the fastest transport', () => {
    const ft = new FallbackTable();
    ft.record('p', 'nkn',   120);
    ft.record('p', 'relay',  40);
    ft.record('p', 'mqtt',   80);
    expect(ft.getBest('p')).toBe('relay');
  });

  it('filters by candidate list', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 10);
    ft.record('p', 'nkn',   20);
    // Only nkn is in candidates
    expect(ft.getBest('p', {}, ['nkn'])).toBe('nkn');
  });

  it('filters by pattern support — skips transports that do not support streaming', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 10, { streaming: false });
    ft.record('p', 'nkn',   30, { streaming: true  });
    expect(ft.getBest('p', { streaming: true })).toBe('nkn');
  });

  it('pattern filter: missing flag treated as supported', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 10);   // no patternSupport specified → allow all
    expect(ft.getBest('p', { streaming: true })).toBe('relay');
  });

  it('markDegraded demotes transport after healthy ones', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 5);
    ft.record('p', 'nkn',   50);
    ft.markDegraded('p', 'relay');
    // relay is degraded → nkn wins
    expect(ft.getBest('p')).toBe('nkn');
  });

  it('isDegraded returns true while window is active', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 5);
    ft.markDegraded('p', 'relay', Date.now() + 60_000);
    expect(ft.isDegraded('p', 'relay')).toBe(true);
  });

  it('isDegraded returns false after window expires', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 5);
    ft.markDegraded('p', 'relay', Date.now() - 1);  // expired in the past
    expect(ft.isDegraded('p', 'relay')).toBe(false);
  });

  it('getBest falls back to degraded transport if it is the only one', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 5);
    ft.markDegraded('p', 'relay');
    // No other options → still returns relay
    expect(ft.getBest('p')).toBe('relay');
  });

  it('clear removes all entries for a peer', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 10);
    ft.record('p', 'nkn',   20);
    ft.record('other', 'relay', 5);
    ft.clear('p');
    expect(ft.getBest('p')).toBeNull();
    expect(ft.getBest('other')).toBe('relay');
  });

  it('getAll returns all entries for a peer', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 10);
    ft.record('p', 'nkn',   20);
    const entries = ft.getAll('p');
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.transportName).sort()).toEqual(['nkn', 'relay']);
  });

  it('record updates existing entry', () => {
    const ft = new FallbackTable();
    ft.record('p', 'relay', 100);
    ft.record('p', 'relay', 20);   // update
    expect(ft.getAll('p')[0].latencyMs).toBe(20);
  });
});
