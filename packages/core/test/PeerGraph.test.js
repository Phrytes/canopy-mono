import { describe, it, expect, vi } from 'vitest';
import { PeerGraph } from '../src/discovery/PeerGraph.js';

function makeGraph() { return new PeerGraph(); }

// ── upsert / get / all ────────────────────────────────────────────────────────

describe('PeerGraph upsert / get / all', () => {
  it('upserts a native peer by pubKey', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', type: 'native' });
    const r = await g.get('pk1');
    expect(r.pubKey).toBe('pk1');
    expect(r.type).toBe('native');
  });

  it('upserts an A2A peer by url', async () => {
    const g = makeGraph();
    await g.upsert({ url: 'https://agent.example.com', type: 'a2a' });
    const r = await g.get('https://agent.example.com');
    expect(r.type).toBe('a2a');
  });

  it('throws if no pubKey or url', async () => {
    const g = makeGraph();
    await expect(g.upsert({ label: 'x' })).rejects.toThrow();
  });

  it('merges into existing record on second upsert', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', label: 'Alice', skills: ['echo'] });
    await g.upsert({ pubKey: 'pk1', label: 'Alice Updated', skills: ['ping'] });
    const r = await g.get('pk1');
    expect(r.label).toBe('Alice Updated');
    expect(r.skills).toContain('echo');
    expect(r.skills).toContain('ping');
  });

  it('merges transport configs', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', transports: { relay: { url: 'wss://a' } } });
    await g.upsert({ pubKey: 'pk1', transports: { nkn:   { address: 'abc.nkn' } } });
    const r = await g.get('pk1');
    expect(r.transports.relay).toBeDefined();
    expect(r.transports.nkn).toBeDefined();
  });

  it('all() returns every stored record', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    await g.upsert({ pubKey: 'pk2' });
    const all = await g.all();
    expect(all).toHaveLength(2);
  });

  it('get() returns null for unknown peer', async () => {
    const g = makeGraph();
    expect(await g.get('unknown')).toBeNull();
  });

  it('defaults reachable to true', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    expect((await g.get('pk1')).reachable).toBe(true);
  });

  it('defaults discoverable to true', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    expect((await g.get('pk1')).discoverable).toBe(true);
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('PeerGraph remove', () => {
  it('removes a peer from the graph', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    await g.remove('pk1');
    expect(await g.get('pk1')).toBeNull();
  });

  it('is a no-op for unknown peers', async () => {
    const g = makeGraph();
    await expect(g.remove('unknown')).resolves.toBeUndefined();
  });
});

// ── filtered queries ──────────────────────────────────────────────────────────

describe('PeerGraph queries', () => {
  it('withSkill filters by skill', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', skills: ['echo', 'ping'] });
    await g.upsert({ pubKey: 'pk2', skills: ['translate'] });
    const r = await g.withSkill('echo');
    expect(r).toHaveLength(1);
    expect(r[0].pubKey).toBe('pk1');
  });

  it('withSkill excludes A2A peers when includeA2A=false', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', type: 'native', skills: ['echo'] });
    await g.upsert({ url: 'https://a2a.example', type: 'a2a', skills: ['echo'] });
    const r = await g.withSkill('echo', { includeA2A: false });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('native');
  });

  it('inGroup filters by group', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', groups: ['home', 'work'] });
    await g.upsert({ pubKey: 'pk2', groups: ['work'] });
    const r = await g.inGroup('home');
    expect(r).toHaveLength(1);
    expect(r[0].pubKey).toBe('pk1');
  });

  it('reachable returns only reachable peers', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', reachable: true  });
    await g.upsert({ pubKey: 'pk2', reachable: false });
    const r = await g.reachable();
    expect(r).toHaveLength(1);
    expect(r[0].pubKey).toBe('pk1');
  });

  it('fastest returns peers sorted by min latency', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', latency: { relay: 100, nkn: 200 } });
    await g.upsert({ pubKey: 'pk2', latency: { relay: 30  } });
    await g.upsert({ pubKey: 'pk3', latency: { nkn:  80  } });
    const r = await g.fastest(2);
    expect(r[0].pubKey).toBe('pk2');
    expect(r[1].pubKey).toBe('pk3');
  });

  it('a2aAgents returns only a2a and hybrid peers', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1',                 type: 'native' });
    await g.upsert({ url:    'https://a',           type: 'a2a'    });
    await g.upsert({ pubKey: 'pk2', url: 'https://b', type: 'hybrid' });
    const r = await g.a2aAgents();
    expect(r).toHaveLength(2);
  });

  it('canHandle filters by skill and streaming', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', type: 'native', skills: ['video'] });
    await g.upsert({ url: 'https://a', type: 'a2a',   skills: ['video'] });
    const native = await g.canHandle({ skill: 'video', streaming: true });
    expect(native).toHaveLength(1);
    expect(native[0].type).toBe('native');
  });

  it('canHandle bidi mode excludes A2A peers', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', type: 'native', skills: ['voice'] });
    await g.upsert({ url: 'https://a', type: 'a2a',   skills: ['voice'] });
    const r = await g.canHandle({ skill: 'voice', mode: 'bidi' });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('native');
  });
});

// ── setReachable / updateLatency / updateTier ─────────────────────────────────

describe('PeerGraph update helpers', () => {
  it('setReachable(false) marks peer unreachable', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    await g.setReachable('pk1', false);
    expect((await g.get('pk1')).reachable).toBe(false);
  });

  it('setReachable(true) updates lastSeen', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', reachable: false });
    const before = Date.now();
    await g.setReachable('pk1', true);
    const after = Date.now();
    const r = await g.get('pk1');
    expect(r.lastSeen).toBeGreaterThanOrEqual(before);
    expect(r.lastSeen).toBeLessThanOrEqual(after);
  });

  it('updateLatency stores latency per transport', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1' });
    await g.updateLatency('pk1', 'relay', 42);
    expect((await g.get('pk1')).latency.relay).toBe(42);
  });

  it('updateTier changes the tier', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', tier: 'authenticated' });
    await g.updateTier('pk1', 'trusted');
    expect((await g.get('pk1')).tier).toBe('trusted');
  });
});

// ── Events ────────────────────────────────────────────────────────────────────

describe('PeerGraph events', () => {
  it('emits "added" on first upsert', async () => {
    const g = makeGraph();
    const added = [];
    g.on('added', r => added.push(r));
    await g.upsert({ pubKey: 'pk1' });
    expect(added).toHaveLength(1);
    expect(added[0].pubKey).toBe('pk1');
  });

  it('does NOT emit "added" on subsequent upserts', async () => {
    const g = makeGraph();
    const added = [];
    g.on('added', r => added.push(r));
    await g.upsert({ pubKey: 'pk1' });
    await g.upsert({ pubKey: 'pk1', label: 'Updated' });
    expect(added).toHaveLength(1);
  });

  it('emits "removed" when peer is removed', async () => {
    const g = makeGraph();
    const removed = [];
    g.on('removed', r => removed.push(r));
    await g.upsert({ pubKey: 'pk1' });
    await g.remove('pk1');
    expect(removed).toHaveLength(1);
  });

  it('emits "reachable" when peer recovers', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', reachable: false });
    const events = [];
    g.on('reachable', r => events.push(r));
    await g.setReachable('pk1', true);
    expect(events).toHaveLength(1);
  });

  it('emits "unreachable" when peer goes down', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', reachable: true });
    const events = [];
    g.on('unreachable', r => events.push(r));
    await g.setReachable('pk1', false);
    expect(events).toHaveLength(1);
  });

  it('emits "tiered" with old and new tier', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', tier: 'authenticated' });
    const events = [];
    g.on('tiered', (r, old, neu) => events.push({ old, neu }));
    await g.updateTier('pk1', 'trusted');
    expect(events[0]).toEqual({ old: 'authenticated', neu: 'trusted' });
  });
});

// ── export / import ───────────────────────────────────────────────────────────

describe('PeerGraph export / import', () => {
  it('round-trips through export/import', async () => {
    const g1 = makeGraph();
    await g1.upsert({ pubKey: 'pk1', skills: ['echo'], label: 'Alice' });
    await g1.upsert({ pubKey: 'pk2', skills: ['ping'], label: 'Bob'   });

    const exported = await g1.export();

    const g2 = makeGraph();
    await g2.import(exported);

    const r = await g2.get('pk1');
    expect(r.label).toBe('Alice');
    expect(r.skills).toContain('echo');
    expect(await g2.all()).toHaveLength(2);
  });

  it('import merges with existing graph', async () => {
    const g = makeGraph();
    await g.upsert({ pubKey: 'pk1', skills: ['a'] });

    await g.import([{ pubKey: 'pk1', skills: ['b'] }, { pubKey: 'pk2' }]);

    expect((await g.get('pk1')).skills).toContain('a');
    expect((await g.get('pk1')).skills).toContain('b');
    expect(await g.all()).toHaveLength(2);
  });
});
