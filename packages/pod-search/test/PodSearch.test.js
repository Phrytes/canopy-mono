import { describe, it, expect, beforeEach } from 'vitest';
import { PodSearch } from '../src/index.js';

const ARCHIVE_SCHEMA = {
  fields: {
    id:        { primary: true },
    type:      { facet: true },
    source:    { facet: true },
    timestamp: { sortable: true },
    title:     { fts: true, weight: 2 },
    body:      { fts: true },
    people:    { facet: true, multi: true },
  },
};

let s;
beforeEach(async () => {
  s = new PodSearch({ schema: ARCHIVE_SCHEMA });
  await s.indexBatch([
    { id: '1', type: 'email',    source: 'gmail',    timestamp: 1000, title: 'meet alice friday',  body: 'lunch at noon',          people: ['alice@x.com'] },
    { id: '2', type: 'email',    source: 'icloud',   timestamp: 2000, title: 'project update',     body: 'alice asked for status', people: ['alice@x.com', 'bob@x.com'] },
    { id: '3', type: 'photo',    source: 'gphotos',  timestamp: 3000, title: 'paris trip',         body: '',                       people: ['bob@x.com'] },
    { id: '4', type: 'message',  source: 'whatsapp', timestamp: 4000, title: '',                   body: 'see you on friday',      people: ['alice@x.com'] },
  ]);
});

describe('PodSearch — text query', () => {
  it('matches across fts fields (title + body)', async () => {
    const r = await s.query({ text: 'alice' });
    expect(r.total).toBe(2);
    const ids = r.items.map((i) => i.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('AND semantics: all terms must appear', async () => {
    const r = await s.query({ text: 'alice friday' });
    // Item 1 has both "alice" and "friday" in title; item 2 has only alice; item 4 only friday.
    expect(r.total).toBe(1);
    expect(r.items[0].id).toBe('1');
  });

  it('higher weight for title over body', async () => {
    // Both "1" (alice in title) and "2" (alice in body) match;
    // 1 should rank first because title weight=2.
    const r = await s.query({ text: 'alice' });
    expect(r.items[0].id).toBe('1');
  });

  it('returns 0 results for unmatched query', async () => {
    const r = await s.query({ text: 'unicorns' });
    expect(r.total).toBe(0);
  });
});

describe('PodSearch — filters', () => {
  it('exact value', async () => {
    const r = await s.query({ filters: { type: 'email' } });
    expect(r.total).toBe(2);
  });

  it('multi-value (OR within field)', async () => {
    const r = await s.query({ filters: { type: ['email', 'photo'] } });
    expect(r.total).toBe(3);
  });

  it('range filter (timestamp from/to)', async () => {
    const r = await s.query({ filters: { timestamp: { from: 2000, to: 3000 } } });
    expect(r.total).toBe(2);
    expect(r.items.map((i) => i.id).sort()).toEqual(['2', '3']);
  });

  it('multi-value field (people contains)', async () => {
    const r = await s.query({ filters: { people: 'alice@x.com' } });
    expect(r.total).toBe(3);
  });
});

describe('PodSearch — facets', () => {
  it('counts by facet field across the result set', async () => {
    const r = await s.query({});
    expect(r.facets.type).toEqual({ email: 2, photo: 1, message: 1 });
    expect(r.facets.source).toMatchObject({ gmail: 1, icloud: 1, gphotos: 1, whatsapp: 1 });
    expect(r.facets.people['alice@x.com']).toBe(3);
    expect(r.facets.people['bob@x.com']).toBe(2);
  });

  it('facets reflect filtered subset', async () => {
    const r = await s.query({ filters: { type: 'email' } });
    expect(r.facets.type).toEqual({ email: 2 });
    expect(r.facets.source).toEqual({ gmail: 1, icloud: 1 });
  });
});

describe('PodSearch — rank + paging', () => {
  it('date-desc orders by sortable timestamp', async () => {
    const r = await s.query({ rank: 'date-desc' });
    expect(r.items.map((i) => i.id)).toEqual(['4', '3', '2', '1']);
  });

  it('date-asc orders by sortable timestamp ascending', async () => {
    const r = await s.query({ rank: 'date-asc' });
    expect(r.items.map((i) => i.id)).toEqual(['1', '2', '3', '4']);
  });

  it('limit + offset paginate', async () => {
    const p1 = await s.query({ rank: 'date-asc', limit: 2, offset: 0 });
    const p2 = await s.query({ rank: 'date-asc', limit: 2, offset: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(p2.items.map((i) => i.id)).toEqual(['3', '4']);
    expect(p1.total).toBe(4);
  });
});

describe('PodSearch — index management', () => {
  it('deleteById removes from results', async () => {
    await s.deleteById('1');
    const r = await s.query({});
    expect(r.total).toBe(3);
  });

  it('reindex wipes the index', async () => {
    await s.reindex();
    const r = await s.query({});
    expect(r.total).toBe(0);
  });

  it('throws when item missing primary field', async () => {
    await expect(s.indexBatch([{ title: 'no id' }])).rejects.toThrow(/primary field/);
  });
});
