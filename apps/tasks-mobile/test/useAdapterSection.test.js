/**
 * useAdapterSection — hook smoke tests.
 *
 * The hook itself is pure delegation to `useSkillResult` + an
 * adapter section lookup.  Substantive consumer-level testing
 * happens in the screens that adopt it (C.3+).  Here we verify
 * the pure logic: section resolution, fallback skillId, deps
 * passthrough.
 *
 * Uses vitest's mock to substitute `useSkillResult` for this test.
 * The actual `useSkillResult` requires React + ServiceContext;
 * we substitute a pure spy so the hook's resolution logic is
 * isolated from React's render lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock useSkillResult BEFORE importing useAdapterSection (the hook
// reads useSkillResult from ../src/lib/useSkill.js).
const useSkillResultMock = vi.fn();
vi.mock('../src/lib/useSkill.js', () => ({
  useSkillResult: (...args) => useSkillResultMock(...args),
}));

// Now import — the mock is wired.
const { useAdapterSection } = await import('../src/useAdapterSection.js');

beforeEach(() => {
  useSkillResultMock.mockReset();
  useSkillResultMock.mockReturnValue({
    data:    { items: [] },
    loading: false,
    refresh: async () => {},
  });
});

describe('useAdapterSection — resolution logic', () => {
  it('passes section.dataSource.skillId + args to useSkillResult', () => {
    const adapter = {
      getSection: (id) => id === 'mine'
        ? { id: 'mine', dataSource: { skillId: 'listMine', args: { open: true } } }
        : null,
    };
    useAdapterSection(adapter, 'mine', ['dep']);
    expect(useSkillResultMock).toHaveBeenCalledWith('listMine', { open: true }, ['dep']);
  });

  it('falls back to "listOpen" + {} when section.dataSource is undefined', () => {
    const adapter = {
      getSection: () => ({ id: 'x' }),  // no dataSource
    };
    useAdapterSection(adapter, 'x');
    expect(useSkillResultMock).toHaveBeenCalledWith('listOpen', {}, []);
  });

  it('falls back when adapter.getSection returns null', () => {
    const adapter = { getSection: () => null };
    const result = useAdapterSection(adapter, 'missing');
    expect(result.section).toBeNull();
    expect(useSkillResultMock).toHaveBeenCalledWith('listOpen', {}, []);
  });

  it('falls back when adapter itself is null/undefined (defensive)', () => {
    useAdapterSection(null, 'x');
    expect(useSkillResultMock).toHaveBeenCalledWith('listOpen', {}, []);
    useSkillResultMock.mockClear();
    useAdapterSection(undefined, 'x');
    expect(useSkillResultMock).toHaveBeenCalledWith('listOpen', {}, []);
  });
});

describe('useAdapterSection — return shape', () => {
  it('exposes {section, data, loading, refresh, error} mirroring useSkillResult', () => {
    const section = { id: 'mine', dataSource: { skillId: 'listMine' } };
    const adapter = { getSection: () => section };

    const refreshFn = async () => { /* spy */ };
    useSkillResultMock.mockReturnValue({
      data:    { items: [{ id: 1 }] },
      loading: true,
      refresh: refreshFn,
      error:   null,
    });

    const out = useAdapterSection(adapter, 'mine');
    expect(out.section).toBe(section);
    expect(out.data).toEqual({ items: [{ id: 1 }] });
    expect(out.loading).toBe(true);
    expect(out.refresh).toBe(refreshFn);
    expect(out.error).toBeNull();
  });

  it('defaults loading to false + refresh to a no-op when useSkillResult is empty', () => {
    useSkillResultMock.mockReturnValue(undefined);
    const adapter = { getSection: () => ({ id: 'x' }) };
    const out = useAdapterSection(adapter, 'x');
    expect(out.loading).toBe(false);
    expect(typeof out.refresh).toBe('function');
    // Refresh must be callable + return a promise.
    expect(out.refresh()).toBeInstanceOf(Promise);
  });
});

describe('useAdapterSection — deps passthrough', () => {
  it('forwards deps array verbatim', () => {
    const adapter = { getSection: () => ({ id: 'x', dataSource: { skillId: 'x' } }) };
    useAdapterSection(adapter, 'x', [1, 2, 'three']);
    expect(useSkillResultMock).toHaveBeenCalledWith('x', {}, [1, 2, 'three']);
  });

  it('defaults to [] when deps not supplied', () => {
    const adapter = { getSection: () => ({ id: 'x', dataSource: { skillId: 'x' } }) };
    useAdapterSection(adapter, 'x');
    expect(useSkillResultMock).toHaveBeenCalledWith('x', {}, []);
  });
});
