/**
 * MetricsScreen._flattenForDisplay unit tests.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Hits the JSX file's pure-fn export — same pattern as
 * `composeArgs.test.js` (vitest doesn't choke on the JSX module
 * because the helper has no JSX in it).
 */

import { describe, it, expect } from 'vitest';
import { _flattenForDisplay } from '../../src/screens/MetricsScreen.jsx';

describe('MetricsScreen._flattenForDisplay', () => {
  it('flattens primitive values to {key,value} rows', () => {
    const rows = _flattenForDisplay({ relayRtt: 42, lastSync: 'now', online: true });
    expect(rows).toEqual([
      { key: 'relayRtt', value: '42' },
      { key: 'lastSync', value: 'now' },
      { key: 'online',   value: 'true' },
    ]);
  });

  it('uses dotted paths for nested objects', () => {
    const rows = _flattenForDisplay({ skillCounts: { addTask: 5, claimTask: 3 } });
    expect(rows).toEqual([
      { key: 'skillCounts.addTask',   value: '5' },
      { key: 'skillCounts.claimTask', value: '3' },
    ]);
  });

  it('renders primitive arrays inline; objects-in-arrays use [N]', () => {
    expect(_flattenForDisplay({ tags: ['a', 'b'] })).toEqual([
      { key: 'tags', value: '[a, b]' },
    ]);
    const rows = _flattenForDisplay({ peers: [{ id: 'p1', rtt: 10 }, { id: 'p2', rtt: 20 }] });
    expect(rows).toEqual([
      { key: 'peers[0].id',  value: 'p1' },
      { key: 'peers[0].rtt', value: '10' },
      { key: 'peers[1].id',  value: 'p2' },
      { key: 'peers[1].rtt', value: '20' },
    ]);
  });

  it('handles null + missing values', () => {
    expect(_flattenForDisplay({ x: null, y: undefined })).toEqual([
      { key: 'x', value: '—' },
      { key: 'y', value: '—' },
    ]);
    expect(_flattenForDisplay(null)).toEqual([]);
    expect(_flattenForDisplay(undefined)).toEqual([]);
  });

  it('returns empty for empty arrays', () => {
    expect(_flattenForDisplay({ tags: [] })).toEqual([
      { key: 'tags', value: '[]' },
    ]);
  });
});
