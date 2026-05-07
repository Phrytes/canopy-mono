/**
 * contacts — pure-helper coverage for ContactsScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesContactQuery, filterContacts, sortContactsByName,
} from '../src/lib/contacts.js';

const CONTACTS = [
  { id: '1', handle: 'oosterpoort-bird-23' },
  { id: '2', handle: 'anne',  displayName: 'Anne van Dijk', revealed: true },
  { id: '3', handle: 'cor',   displayName: 'Cor de Boer',  revealed: true },
  { id: '4', handle: 'bob' },
];

describe('matchesContactQuery', () => {
  it('matches handle (case-insensitive)', () => {
    expect(matchesContactQuery({ handle: 'anne' }, 'AN')).toBe(true);
    expect(matchesContactQuery({ handle: 'anne' }, 'bob')).toBe(false);
  });
  it('matches displayName', () => {
    expect(matchesContactQuery({ handle: 'a', displayName: 'Anne' }, 'AN'))
      .toBe(true);
  });
  it('empty query → match everything', () => {
    expect(matchesContactQuery(CONTACTS[0], '')).toBe(true);
    expect(matchesContactQuery(CONTACTS[0], '   ')).toBe(true);
  });
  it('null contact → false', () => {
    expect(matchesContactQuery(null, 'x')).toBe(false);
  });
});

describe('filterContacts', () => {
  it('returns matches', () => {
    const r = filterContacts(CONTACTS, 'anne');
    expect(r.map((c) => c.id)).toEqual(['2']);
  });
  it('substring + case-insensitive', () => {
    const r = filterContacts(CONTACTS, 'BIRD');
    expect(r.map((c) => c.id)).toEqual(['1']);
  });
  it('empty query → all', () => {
    expect(filterContacts(CONTACTS, '')).toHaveLength(4);
  });
  it('non-array → []', () => {
    expect(filterContacts(null, 'x')).toEqual([]);
  });
});

describe('sortContactsByName', () => {
  it('alphabetical by displayName-or-handle', () => {
    const r = sortContactsByName(CONTACTS);
    expect(r.map((c) => c.id)).toEqual(['2', '4', '3', '1']);
    // 2: 'Anne van Dijk' → 'anne van dijk'
    // 4: 'bob'
    // 3: 'Cor de Boer' → 'cor de boer'
    // 1: 'oosterpoort-bird-23'
  });
  it('returns a copy', () => {
    const orig = CONTACTS.slice();
    sortContactsByName(orig);
    expect(orig).toEqual(CONTACTS);
  });
  it('empty / non-array', () => {
    expect(sortContactsByName(null)).toEqual([]);
    expect(sortContactsByName([])).toEqual([]);
  });
});
