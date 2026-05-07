import { describe, it, expect } from 'vitest';
import { PersonGraph } from '../src/index.js';

describe('PersonGraph — observe + auto-link', () => {
  it('creates a Person on first observation', async () => {
    const g = new PersonGraph();
    const p = await g.observe({
      identifier: { kind: 'email', value: 'alice@example.com' },
      observedIn: { source: 'gmail', sourceId: 'msg-1' },
    });
    expect(p.identifiers).toHaveLength(1);
    expect(p.observations).toHaveLength(1);
    expect(g.size).toBe(1);
  });

  it('auto-links observations of the same identifier across sources', async () => {
    const g = new PersonGraph();
    await g.observe({
      identifier: { kind: 'email', value: 'alice@example.com' },
      observedIn: { source: 'gmail', sourceId: 'msg-1' },
    });
    const p = await g.observe({
      identifier: { kind: 'email', value: 'alice@example.com' },
      observedIn: { source: 'icloud', sourceId: 'msg-2' },
    });
    expect(g.size).toBe(1);
    expect(p.observations).toHaveLength(2);
  });

  it('different identifiers create distinct Persons until linked', async () => {
    const g = new PersonGraph();
    await g.observe({ identifier: { kind: 'email', value: 'alice@example.com' } });
    await g.observe({ identifier: { kind: 'phone', value: '+31612345678' } });
    expect(g.size).toBe(2);
  });
});

describe('PersonGraph — link', () => {
  it('manually links two identifiers into one Person', async () => {
    const g = new PersonGraph();
    await g.observe({ identifier: { kind: 'email', value: 'alice@x.com' } });
    await g.observe({ identifier: { kind: 'phone', value: '+311' } });
    expect(g.size).toBe(2);

    const p = await g.link(
      [{ kind: 'email', value: 'alice@x.com' }, { kind: 'phone', value: '+311' }],
      { confidence: 'user-asserted' },
    );
    expect(g.size).toBe(1);
    expect(p.identifiers).toHaveLength(2);
    expect(p.linkMeta).toEqual([{ confidence: 'user-asserted' }]);
  });

  it('link merges observations from both Persons', async () => {
    const g = new PersonGraph();
    await g.observe({
      identifier: { kind: 'email', value: 'a@x.com' },
      observedIn: { source: 'gmail', sourceId: 'g-1' },
    });
    await g.observe({
      identifier: { kind: 'phone', value: '+311' },
      observedIn: { source: 'whatsapp', sourceId: 'w-1' },
    });
    const p = await g.link([
      { kind: 'email', value: 'a@x.com' },
      { kind: 'phone', value: '+311' },
    ]);
    expect(p.observations).toHaveLength(2);
  });

  it('throws when fewer than 2 identifiers', async () => {
    const g = new PersonGraph();
    await expect(
      g.link([{ kind: 'email', value: 'x@y.com' }]),
    ).rejects.toThrow();
  });
});

describe('PersonGraph — find', () => {
  it('finds Person by identifier', async () => {
    const g = new PersonGraph();
    const p = await g.observe({ identifier: { kind: 'email', value: 'a@x.com' } });
    const found = await g.findByIdentifier({ kind: 'email', value: 'a@x.com' });
    expect(found.id).toBe(p.id);
  });

  it('finds Persons by name fragment', async () => {
    const g = new PersonGraph();
    await g.observe({ identifier: { kind: 'name-display', value: 'Alice Anderson' } });
    await g.observe({ identifier: { kind: 'name-display', value: 'Bob Brown' } });
    const matches = await g.findByName('alice');
    expect(matches).toHaveLength(1);
  });
});
