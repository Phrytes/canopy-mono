/**
 * tunnelSessions — session table + TTL sweeper for Group CC.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TunnelSessions } from '../src/skills/tunnelSessions.js';

let sessions;
beforeEach(() => {
  sessions = new TunnelSessions({ sweepIntervalMs: 50 });
});
afterEach(() => sessions.stop());

function _row(overrides = {}) {
  return {
    tunnelId:    'T1',
    aliceAddr:   'alice-addr',
    aliceTaskId: 'at-1',
    carolAddr:   'carol-addr',
    carolTaskId: 'ct-1',
    carolTask:   { on() {}, off() {} },
    ...overrides,
  };
}

describe('TunnelSessions', () => {
  it('add / get / has round-trip', () => {
    sessions.add(_row());
    expect(sessions.has('T1')).toBe(true);
    expect(sessions.get('T1').aliceAddr).toBe('alice-addr');
    expect(sessions.size).toBe(1);
  });

  it('get returns null for unknown tunnelId', () => {
    expect(sessions.get('nope')).toBeNull();
  });

  it('getByAliceTaskId / getByCarolTaskId lookups', () => {
    sessions.add(_row());
    sessions.add(_row({ tunnelId: 'T2', aliceTaskId: 'at-2', carolTaskId: 'ct-2' }));

    expect(sessions.getByAliceTaskId('at-1').tunnelId).toBe('T1');
    expect(sessions.getByCarolTaskId('ct-2').tunnelId).toBe('T2');
    expect(sessions.getByAliceTaskId('nope')).toBeNull();
  });

  it('drop removes the row and emits closed', () => {
    const spy = vi.fn();
    sessions.on('closed', spy);
    sessions.add(_row());
    expect(sessions.drop('T1', 'test')).toBe(true);
    expect(sessions.has('T1')).toBe(false);
    expect(spy).toHaveBeenCalledWith({ tunnelId: 'T1', reason: 'test' });
  });

  it('drop on unknown tunnelId is a no-op', () => {
    expect(sessions.drop('never', 'x')).toBe(false);
  });

  it('markClosing does not remove but flips the flag', () => {
    const spy = vi.fn();
    sessions.on('closing', spy);
    sessions.add(_row());
    sessions.markClosing('T1', 'alice-cancel');
    expect(sessions.get('T1').closing).toBe(true);
    expect(sessions.get('T1').closingReason).toBe('alice-cancel');
    expect(spy).toHaveBeenCalledWith({ tunnelId: 'T1', reason: 'alice-cancel' });
    // Second markClosing is a no-op (no duplicate event).
    sessions.markClosing('T1', 'again');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('add throws without tunnelId', () => {
    expect(() => sessions.add({ aliceAddr: 'x' })).toThrow(/tunnelId/);
  });

  it('stop clears all rows and emits closed for each', () => {
    const spy = vi.fn();
    sessions.on('closed', spy);
    sessions.add(_row());
    sessions.add(_row({ tunnelId: 'T2' }));
    sessions.stop();
    expect(sessions.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('sweeper evicts rows past their ttl', async () => {
    sessions.start();
    sessions.add(_row({ ttlMs: 60 }));
    expect(sessions.has('T1')).toBe(true);
    await new Promise(r => setTimeout(r, 150));
    expect(sessions.has('T1')).toBe(false);
  });

  it('opened event fires on add', () => {
    const spy = vi.fn();
    sessions.on('opened', spy);
    sessions.add(_row());
    expect(spy).toHaveBeenCalledWith({ tunnelId: 'T1' });
  });
});
