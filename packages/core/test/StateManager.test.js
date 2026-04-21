import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../src/state/StateManager.js';
import { Task }         from '../src/protocol/Task.js';

describe('StateManager — task registry', () => {
  let sm;
  beforeEach(() => { sm = new StateManager(); });

  it('createTask stores and getTask retrieves', () => {
    const task = new Task({ taskId: 't1', skillId: 'echo' });
    sm.createTask('t1', task);
    expect(sm.getTask('t1')).toBe(task);
  });

  it('getTask returns null for unknown id', () => {
    expect(sm.getTask('nope')).toBeNull();
  });

  it('deleteTask removes entry', () => {
    const task = new Task({ taskId: 't1', skillId: 'echo' });
    sm.createTask('t1', task);
    sm.deleteTask('t1');
    expect(sm.getTask('t1')).toBeNull();
  });

  it('createTask returns the task', () => {
    const task = new Task({ taskId: 't1', skillId: 'echo' });
    expect(sm.createTask('t1', task)).toBe(task);
  });

  it('can store plain objects (used for ir: entries)', () => {
    const entry = { resolver: vi.fn() };
    sm.createTask('ir:t1', entry);
    expect(sm.getTask('ir:t1')).toBe(entry);
  });

  it('getTask returns null after TTL expires', () => {
    vi.useFakeTimers();
    const task = new Task({ taskId: 't1', skillId: 'echo' });
    sm.createTask('t1', task);
    vi.advanceTimersByTime(31 * 60 * 1_000);  // 31 min > 30 min TTL
    expect(sm.getTask('t1')).toBeNull();
    vi.useRealTimers();
  });

  it('replaces an existing entry with same id', () => {
    const t1 = new Task({ taskId: 't1', skillId: 'echo' });
    const t2 = new Task({ taskId: 't1', skillId: 'other' });
    sm.createTask('t1', t1);
    sm.createTask('t1', t2);
    expect(sm.getTask('t1')).toBe(t2);
  });
});

describe('StateManager — stream registry', () => {
  let sm;
  beforeEach(() => { sm = new StateManager(); });

  it('openStream + getStream retrieves entry', () => {
    sm.openStream('s1', { taskId: 't1', peerId: 'peer' });
    const entry = sm.getStream('s1');
    expect(entry).not.toBeNull();
    expect(entry.taskId).toBe('t1');
    expect(entry.peerId).toBe('peer');
    expect(Array.isArray(entry.chunks)).toBe(true);
  });

  it('getStream returns null for unknown id', () => {
    expect(sm.getStream('nope')).toBeNull();
  });

  it('closeStream removes entry', () => {
    sm.openStream('s1', { taskId: 't1', peerId: 'peer' });
    sm.closeStream('s1');
    expect(sm.getStream('s1')).toBeNull();
  });

  it('sessionKey defaults to null', () => {
    sm.openStream('s1', { taskId: 't1', peerId: 'peer' });
    expect(sm.getStream('s1').sessionKey).toBeNull();
  });

  it('getStream returns null after TTL expires', () => {
    vi.useFakeTimers();
    sm.openStream('s1', { taskId: 't1', peerId: 'peer' });
    vi.advanceTimersByTime(11 * 60 * 1_000);  // 11 min > 10 min TTL
    expect(sm.getStream('s1')).toBeNull();
    vi.useRealTimers();
  });
});

describe('StateManager — session registry', () => {
  let sm;
  beforeEach(() => { sm = new StateManager(); });

  it('openSession + getSession retrieves entry', () => {
    sm.openSession('sess1', { peerId: 'peer', state: 'open' });
    const entry = sm.getSession('sess1');
    expect(entry).not.toBeNull();
    expect(entry.peerId).toBe('peer');
    expect(entry.state).toBe('open');
  });

  it('getSession returns null for unknown id', () => {
    expect(sm.getSession('nope')).toBeNull();
  });

  it('closeSession removes entry', () => {
    sm.openSession('sess1', { peerId: 'peer' });
    sm.closeSession('sess1');
    expect(sm.getSession('sess1')).toBeNull();
  });

  it('state defaults to "open"', () => {
    sm.openSession('sess1', { peerId: 'peer' });
    expect(sm.getSession('sess1').state).toBe('open');
  });
});
