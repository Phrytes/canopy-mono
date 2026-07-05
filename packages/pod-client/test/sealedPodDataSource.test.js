// sealedPodDataSource — always-run unit tests over an in-memory pod backing.
//
// Proves the L1b contract: the sealed pod-backed DataSource round-trips plaintext to a KEY-HOLDER, a
// NON-key-holder reading the raw pod sees only ciphertext (no plaintext leak, ciphertext-at-rest),
// list/delete behave, and the p0/plaintext posture stores bytes verbatim.

import { describe, it, expect } from 'vitest';
import { createSealedPodDataSource, podGroupPrefix } from '../src/sealedPodDataSource.js';
import { generateGroupKey, isSealed } from '../src/sealing/index.js';

// A Map-backed fake of the `SolidPodSource` shape: read → { content } (bytes here, to mirror the real
// source), write stores the raw body, list → { entries:[{uri,type}] }. The `.map` is the host's view.
function fakeSolidSource() {
  const map = new Map();
  return {
    map,
    async read(uri) {
      if (!map.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; e.status = 404; throw e; }
      return { content: new TextEncoder().encode(map.get(uri)), contentType: 'application/json' };
    },
    async write(uri, content) { map.set(uri, String(content)); return { uri }; },
    async delete(uri) { map.delete(uri); },
    async list(container) {
      const entries = [...map.keys()]
        .filter((k) => k.startsWith(container))
        .map((uri) => ({ uri, type: uri.endsWith('/') ? 'container' : 'resource' }));
      return { container, entries };
    },
  };
}

const CONTAINER = 'https://alice.pod/group/fam/items/';
const URI = `${CONTAINER}01.json`;
const PLAINTEXT = JSON.stringify({ id: '01', type: 'list-item', text: 'milk, bread, soap' });

describe('createSealedPodDataSource — sealed (group-key) over a pod', () => {
  it('round-trips plaintext to a key-holder while the host holds only ciphertext', async () => {
    const groupKey = generateGroupKey();
    const source = fakeSolidSource();
    const ds = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey });
    expect(ds.sealed).toBe(true);

    await ds.write(URI, PLAINTEXT);

    // Ciphertext-at-rest: the host's raw bytes are a sealed envelope, NOT the plaintext.
    const raw = source.map.get(URI);
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain('milk');
    expect(raw).not.toContain('list-item');

    // The key-holder reads back the exact plaintext.
    expect(await ds.read(URI)).toBe(PLAINTEXT);
  });

  it('a non-key-holder cannot open the sealed body (wrong group key throws)', async () => {
    const source = fakeSolidSource();
    const writer = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey: generateGroupKey() });
    await writer.write(URI, PLAINTEXT);

    // A second DataSource with a DIFFERENT group key over the same raw pod cannot decrypt.
    const intruder = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey: generateGroupKey() });
    await expect(intruder.read(URI)).rejects.toThrow();
  });

  it('accepts an explicit { seal, open } strategy (e.g. control-agent.sealingStrategy result)', async () => {
    const groupKey = generateGroupKey();
    const source = fakeSolidSource();
    // Mirror the app path, where getCircleSealStrategy returns the resolved strategy object.
    const { groupKeyStrategy } = await import('../src/sealing/index.js');
    const ds = createSealedPodDataSource({ podSource: source, strategy: groupKeyStrategy({ groupKey }) });
    await ds.write(URI, PLAINTEXT);
    expect(isSealed(source.map.get(URI))).toBe(true);
    expect(await ds.read(URI)).toBe(PLAINTEXT);
  });

  it('list returns the resource URIs under a container prefix (not sub-containers)', async () => {
    const groupKey = generateGroupKey();
    const source = fakeSolidSource();
    const ds = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey });
    await ds.write(`${CONTAINER}01.json`, PLAINTEXT);
    await ds.write(`${CONTAINER}02.json`, PLAINTEXT);
    // A resource under a DIFFERENT container must not appear.
    await ds.write('https://alice.pod/group/fam/notes/09.json', PLAINTEXT);
    // A stray sub-container marker under the prefix must be filtered out.
    source.map.set(`${CONTAINER}sub/`, '');

    const keys = await ds.list(CONTAINER);
    expect(keys.sort()).toEqual([`${CONTAINER}01.json`, `${CONTAINER}02.json`]);
  });

  it('delete removes the resource; a missing read is null; delete of a missing key is a no-op', async () => {
    const groupKey = generateGroupKey();
    const source = fakeSolidSource();
    const ds = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey });

    expect(await ds.read(URI)).toBeNull();     // not written yet
    await ds.delete(URI);                       // no-op, no throw

    await ds.write(URI, PLAINTEXT);
    expect(await ds.read(URI)).toBe(PLAINTEXT);
    await ds.delete(URI);
    expect(await ds.read(URI)).toBeNull();
    expect(source.map.has(URI)).toBe(false);
  });

  it('an empty/absent container lists as [] (parity with the memory/IDB sources)', async () => {
    const throwingSource = {
      async read() { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; },
      async write() {},
      async delete() {},
      async list() { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; },
    };
    const ds = createSealedPodDataSource({ podSource: throwingSource, posture: 'p2', groupKey: generateGroupKey() });
    expect(await ds.list(CONTAINER)).toEqual([]);
  });
});

describe('createSealedPodDataSource — plaintext posture (p0/no strategy)', () => {
  it('stores bytes verbatim (no client seal) and round-trips', async () => {
    const source = fakeSolidSource();
    const ds = createSealedPodDataSource({ podSource: source, posture: 'p0' });
    expect(ds.sealed).toBe(false);
    await ds.write(URI, PLAINTEXT);
    expect(source.map.get(URI)).toBe(PLAINTEXT);   // NOT sealed
    expect(isSealed(source.map.get(URI))).toBe(false);
    expect(await ds.read(URI)).toBe(PLAINTEXT);
  });
});

describe('podGroupPrefix — URI reconciliation with resourceUriFor', () => {
  it('yields <podRoot>/group/ so CircleItemStore keys become canonical pod URIs', () => {
    expect(podGroupPrefix('https://alice.pod/')).toBe('https://alice.pod/group/');
    expect(podGroupPrefix('https://alice.pod')).toBe('https://alice.pod/group/');
    // createCircleStores appends `<circleId>/`, CircleItemStore appends `items/<id>.json` →
    // https://alice.pod/group/fam/items/01.json — the resourceUriFor('fam','01.json') target.
    const rootPrefix = podGroupPrefix('https://alice.pod/');
    expect(`${rootPrefix}fam/items/01.json`).toBe('https://alice.pod/group/fam/items/01.json');
  });
});
