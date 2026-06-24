/**
 * OBJ-2 device/agent pairing QR payload — makePairUri / parsePairUri round-trip + tolerance.
 */
import { describe, it, expect } from 'vitest';
import { makePairUri, parsePairUri, isQrUri, QR_PAIR_SCHEME } from '../../src/core/qrSchemes.js';

describe('pairing QR payload', () => {
  it('round-trips an address (and is recognised as a QR URI)', () => {
    const uri = makePairUri('nkn-abc123def456');
    expect(uri.startsWith(QR_PAIR_SCHEME)).toBe(true);
    expect(isQrUri(uri)).toBe(true);
    expect(parsePairUri(uri)).toEqual({ addr: 'nkn-abc123def456', name: null });
  });

  it('carries an optional human label', () => {
    const uri = makePairUri('addr-1', 'Frits’ phone');
    expect(parsePairUri(uri)).toEqual({ addr: 'addr-1', name: 'Frits’ phone' });
  });

  it('encodes/decodes addresses with URL-unsafe characters', () => {
    const addr = 'a/b+c=d e';
    expect(parsePairUri(makePairUri(addr))?.addr).toBe(addr);
  });

  it('accepts a bare address (pasted directly, no scheme)', () => {
    expect(parsePairUri('just-an-address')).toEqual({ addr: 'just-an-address', name: null });
  });

  it('rejects another QR scheme and empties', () => {
    expect(parsePairUri('stoop-contact://xyz')).toBeNull();
    expect(parsePairUri('')).toBeNull();
    expect(makePairUri('')).toBe('');
  });
});
