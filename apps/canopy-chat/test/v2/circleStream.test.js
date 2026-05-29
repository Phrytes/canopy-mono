import { describe, it, expect } from 'vitest';
import { eventCircleId, buildCircleStream } from '../../src/v2/circleStream.js';

const circles = [
  { id: 'crew-1', name: 'Garden crew' },
  { id: 'grp-9',  name: 'Block 9' },
];

describe('eventCircleId', () => {
  it('reads circleId / crewId / groupId / buurtId off the payload', () => {
    expect(eventCircleId({ payload: { circleId: 'crew-1' } })).toBe('crew-1');
    expect(eventCircleId({ payload: { crewId: 'crew-1' } })).toBe('crew-1');
    expect(eventCircleId({ payload: { groupId: 'grp-9' } })).toBe('grp-9');
    expect(eventCircleId({ payload: { buurtId: 'grp-9' } })).toBe('grp-9');
  });

  it('falls back to itemRef.circleId, else null', () => {
    expect(eventCircleId({ itemRef: { circleId: 'grp-9' } })).toBe('grp-9');
    expect(eventCircleId({ payload: {} })).toBeNull();
    expect(eventCircleId({})).toBeNull();
    expect(eventCircleId(null)).toBeNull();
  });
});

describe('buildCircleStream', () => {
  it('tags each event with its circle name and keeps newest-first', () => {
    const events = [
      { id: 'e1', ts: 300, app: 'stoop',    type: 'buurt-post',   payload: { groupId: 'grp-9' } },
      { id: 'e2', ts: 100, app: 'tasks-v0', type: 'task-claimed', payload: { crewId: 'crew-1' } },
      { id: 'e3', ts: 200, app: 'household',type: 'note-added',   payload: {} },
    ];
    const rows = buildCircleStream({ events, circles });
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e3', 'e2']); // ts desc
    expect(rows[0]).toMatchObject({ circleId: 'grp-9', circleName: 'Block 9', app: 'stoop' });
    expect(rows[2]).toMatchObject({ circleId: 'crew-1', circleName: 'Garden crew' });
  });

  it('keeps un-scoped events (no circle) untagged rather than dropping them', () => {
    const events = [{ id: 'e3', ts: 200, app: 'household', type: 'note-added', payload: {} }];
    const [row] = buildCircleStream({ events, circles });
    expect(row.circleId).toBeNull();
    expect(row.circleName).toBeNull();
  });

  it('tolerates an unknown circleId (tag id kept, name null)', () => {
    const events = [{ id: 'e9', ts: 1, app: 'stoop', type: 'x', payload: { circleId: 'ghost' } }];
    const [row] = buildCircleStream({ events, circles });
    expect(row.circleId).toBe('ghost');
    expect(row.circleName).toBeNull();
  });

  it('returns [] for empty / missing inputs', () => {
    expect(buildCircleStream()).toEqual([]);
    expect(buildCircleStream({ events: [], circles: [] })).toEqual([]);
    expect(buildCircleStream({ events: [null, undefined] })).toEqual([]);
  });
});
