/**
 * Canonical types — validation per-type.
 *
 * Sanity-checks that every shipped canonical type:
 *   - Registers cleanly via registerCanonicalTypes().
 *   - Accepts a minimal valid item.
 *   - Rejects missing-required-field cases.
 *   - Exposes its iri metadata.
 *
 * Sweep test — one minimal positive + one negative per type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
  registerCanonicalTypes,
  CANONICAL_TYPES,
  list,
  validate,
  metadata,
  schema,
  NAMESPACE,
} from '../index.js';

const NOW = '2026-05-11T10:00:00.000Z';
const AGENT = 'https://anne.example/profile#me/agent/laptop';

/** Build a baseline item with the common required fields populated. */
function baseItem(type, extra = {}) {
  return {
    type,
    id:        `dec:item/${type}/abc`,
    createdAt: NOW,
    createdBy: AGENT,
    ...extra,
  };
}

describe('Canonical types — registration via default registry', () => {
  it('the default registry has all 11 canonical types', () => {
    expect(list().sort()).toEqual([
      'announcement',
      'calendar-event',
      'chat-message',
      'claim',
      'contact',
      'neighbourhood-job',
      'note',
      'offer',
      'request',
      'reveal-request',
      'task',
    ]);
  });

  it('every canonical type exposes a `dec:` IRI', () => {
    for (const name of list()) {
      const m = metadata(name);
      expect(m).toBeTruthy();
      expect(m.iri).toMatch(new RegExp(`^${NAMESPACE.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
    }
  });

  it('registerCanonicalTypes works on a fresh registry too', () => {
    const r = createRegistry();
    registerCanonicalTypes(r);
    expect(r.list()).toHaveLength(11);
  });

  it('CANONICAL_TYPES exports the schema map', () => {
    expect(Object.keys(CANONICAL_TYPES)).toHaveLength(11);
    expect(CANONICAL_TYPES.task).toBeTruthy();
    expect(CANONICAL_TYPES.note).toBeTruthy();
  });
});

describe('Canonical types — minimal valid + missing-required-field sweep', () => {
  // Per-type minimal-valid extras to satisfy each schema's required fields.
  const MINIMAL = {
    'task':              { text:        'paint the fence' },
    'note':              { body:        'hello world' },
    'chat-message':      { body:        'hi!' },
    'offer':             { body:        'ladder available, lend it to whoever needs it' },
    'request':           { body:        'looking to borrow a drill this weekend' },
    'claim':             { itemRef:     'pseudo-pod://x/y/z' },
    'contact':           { displayName: 'Anne' },
    'calendar-event':    { title:       'Coffee', startsAt: NOW },
    'announcement':      { body:        'Heads up: code rotates Friday' },
    'reveal-request':    { requester:   'pk-a', target: 'pk-b' },
    'neighbourhood-job': { body:        'paint the wall' },
  };

  for (const [name, extra] of Object.entries(MINIMAL)) {
    it(`'${name}' validates a minimal item`, () => {
      const result = validate(baseItem(name, extra));
      if (!result.ok) {
        console.error(`unexpected fail for '${name}':`, result.errors);
      }
      expect(result.ok).toBe(true);
    });

    it(`'${name}' fails when a base required field is missing`, () => {
      const item = baseItem(name, extra);
      delete item.createdAt;
      const result = validate(item);
      expect(result.ok).toBe(false);
    });

    it(`'${name}' fails when an item-specific required field is missing`, () => {
      // Drop one required type-specific field per type.
      const dropKey = Object.keys(extra)[0];
      const item = baseItem(name, extra);
      delete item[dropKey];
      const result = validate(item);
      expect(result.ok).toBe(false);
    });
  }
});

describe('Canonical types — embeds field shape', () => {
  it('accepts a well-formed embeds array', () => {
    const result = validate(baseItem('task', {
      text:   'paint the fence',
      embeds: [
        { type: 'note',  ref: 'https://anne.pod/notes/x' },
        { type: 'offer', ref: 'pseudo-pod://anne-device/offers/abc' },
      ],
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects an embed missing the ref field', () => {
    const result = validate(baseItem('task', {
      text:   'x',
      embeds: [{ type: 'note' }],
    }));
    expect(result.ok).toBe(false);
  });

  it('accepts an embed with extra forward-compat fields', () => {
    const result = validate(baseItem('task', {
      text:   'x',
      embeds: [{ type: 'note', ref: 'https://x/y', sourceVersion: 'v3', cachedAt: NOW }],
    }));
    expect(result.ok).toBe(true);
  });
});

describe('Canonical types — extra-fields tolerance (forward-compat)', () => {
  it('allows undeclared fields on a task', () => {
    const result = validate(baseItem('task', {
      text: 'x',
      futureField:    'tomorrow this might be canonical',
      anotherFuture:  { nested: 'shape' },
    }));
    expect(result.ok).toBe(true);
  });
});

describe('offer / request kind enum (2026-05-12 vocab refresh)', () => {
  const SHIPPING_OFFER_KINDS  = ['lend', 'share', 'give', 'sell', 'help', 'other'];
  const SHIPPING_REQUEST_KINDS = ['borrow', 'share', 'receive', 'buy', 'help', 'other'];

  for (const kind of SHIPPING_OFFER_KINDS) {
    it(`offer accepts kind="${kind}"`, () => {
      const result = validate(baseItem('offer', { body: 'something', kind }));
      expect(result.ok).toBe(true);
    });
  }

  for (const kind of SHIPPING_REQUEST_KINDS) {
    it(`request accepts kind="${kind}"`, () => {
      const result = validate(baseItem('request', { body: 'something', kind }));
      expect(result.ok).toBe(true);
    });
  }

  it('offer rejects an unknown kind', () => {
    const result = validate(baseItem('offer', { body: 'x', kind: 'launder' }));
    expect(result.ok).toBe(false);
  });

  it('request rejects an unknown kind', () => {
    const result = validate(baseItem('request', { body: 'x', kind: 'launder' }));
    expect(result.ok).toBe(false);
  });

  it('kind is optional — UI may post under-specified items', () => {
    expect(validate(baseItem('offer',   { body: 'x' })).ok).toBe(true);
    expect(validate(baseItem('request', { body: 'x' })).ok).toBe(true);
  });
});

describe('Legacy vocabulary aliases (2026-05-12 vocab refresh)', () => {
  it('supply-offer routes to offer schema', () => {
    const result = validate(baseItem('supply-offer', { body: 'ladder' }));
    expect(result.ok).toBe(true);
    expect(metadata('supply-offer')?.name).toBe('offer');
  });

  it('demand-offer routes to request schema', () => {
    const result = validate(baseItem('demand-offer', { body: 'drill?' }));
    expect(result.ok).toBe(true);
    expect(metadata('demand-offer')?.name).toBe('request');
  });

  it('lend-request routes to claim schema', () => {
    const result = validate(baseItem('lend-request', { itemRef: 'pseudo-pod://x/y' }));
    expect(result.ok).toBe(true);
    expect(metadata('lend-request')?.name).toBe('claim');
  });

  it('schema() lookup via legacy name returns the canonical schema', () => {
    const direct = schema('offer');
    const viaAlias = schema('supply-offer');
    expect(viaAlias).toBe(direct);
  });
});
