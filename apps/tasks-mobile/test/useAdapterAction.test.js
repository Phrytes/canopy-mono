/**
 * useAdapterAction — (2026-05-20) hook smoke tests.
 *
 * The hook itself is pure: build args, call `bundle.agent.invoke`,
 * unwrap parts.  Substantive consumer-level testing happens in
 * screens that adopt it (a future C.x).  Here we verify the dispatch
 * shape: opId resolution, arg merge order, scope enrichment,
 * defensive fallbacks.
 *
 * Mocks the React hooks layer (useService) so the dispatcher's logic
 * is isolated from React's render lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock useService BEFORE importing useAdapterAction so it sees the
// stubbed services bundle.
const useServiceMock = vi.fn();
vi.mock('../src/ServiceContext.js', () => ({
  useService: () => useServiceMock(),
}));

// Mock `toParts` + `unwrapParts` to act as identity passthroughs;
// the part-encoding is sync-engine-rn's concern, not this hook's.
vi.mock('@onderling/sync-engine-rn/react', () => ({
  toParts:     (args) => ({ args }),         // wrap so we can inspect
  unwrapParts: (raw)  => raw?.reply,
}));

// Stub React's useCallback to call the factory eagerly with stable
// identity per test (we don't need memoization semantics here — we
// need the inner async function to be invokable directly).
vi.mock('react', () => ({
  useCallback: (fn) => fn,
}));

const { useAdapterAction } = await import('../src/lib/useAdapterAction.js');

function makeBundle({ replyValue = 'OK' } = {}) {
  const calls = [];
  const agent = {
    address: 'local-peer-addr',
    invoke: async (peer, skillId, parts) => {
      calls.push({ peer, skillId, parts });
      return { reply: replyValue };
    },
  };
  return {
    activeBundle:   { agent, groupId: 'group-xyz' },
    activeGroupId:  'group-fallback',
    calls,
  };
}

beforeEach(() => {
  useServiceMock.mockReset();
});

describe('useAdapterAction — dispatch logic', () => {
  it('invokes the agent with action.opId + merged args', async () => {
    const svc = makeBundle();
    useServiceMock.mockReturnValue(svc);

    const dispatch = useAdapterAction();
    const action = { opId: 'approveTask', label: 'Approve', args: { id: 't-1' } };

    const reply = await dispatch(action);

    expect(reply).toBe('OK');
    expect(svc.calls).toHaveLength(1);
    expect(svc.calls[0].peer).toBe('local-peer-addr');
    expect(svc.calls[0].skillId).toBe('approveTask');
    // toParts mock wraps under {args}; assert _scope was injected.
    expect(svc.calls[0].parts.args).toEqual({
      id:     't-1',
      _scope: 'group-xyz',
    });
  });

  it('merges extraArgs over action.args (caller wins on conflict)', async () => {
    const svc = makeBundle();
    useServiceMock.mockReturnValue(svc);

    const dispatch = useAdapterAction();
    const action = {
      opId: 'declineSubtaskProposal',
      args: { proposalId: 'p-1', note: 'default' },
    };

    await dispatch(action, { note: 'overridden', extra: 'x' });

    expect(svc.calls[0].parts.args).toMatchObject({
      proposalId: 'p-1',
      note:       'overridden', // extraArgs.note wins
      extra:      'x',
      _scope:     'group-xyz',
    });
  });

  it('falls back to svc.activeGroupId when bundle.groupId is missing', async () => {
    const svc = makeBundle();
    svc.activeBundle.groupId = null;
    useServiceMock.mockReturnValue(svc);

    const dispatch = useAdapterAction();
    await dispatch({ opId: 'doIt', args: {} });

    expect(svc.calls[0].parts.args._scope).toBe('group-fallback');
  });

  it('returns undefined when action is malformed (no opId)', async () => {
    useServiceMock.mockReturnValue(makeBundle());

    const dispatch = useAdapterAction();
    expect(await dispatch(null)).toBeUndefined();
    expect(await dispatch({})).toBeUndefined();
    expect(await dispatch({ opId: '' })).toBeUndefined();
    expect(await dispatch({ opId: 42 })).toBeUndefined();
  });

  it('returns undefined when no active bundle is available', async () => {
    useServiceMock.mockReturnValue({});  // no activeBundle

    const dispatch = useAdapterAction();
    const reply = await dispatch({ opId: 'doIt', args: {} });
    expect(reply).toBeUndefined();
  });

  it('treats absent action.args as an empty object', async () => {
    const svc = makeBundle();
    useServiceMock.mockReturnValue(svc);

    const dispatch = useAdapterAction();
    await dispatch({ opId: 'clearInbox' });  // no args

    expect(svc.calls[0].parts.args).toEqual({ _scope: 'group-xyz' });
  });
});
