/**
 * bufferPolyfill — the browser Buffer shim that adds base64url (the bundled `buffer` polyfill predates
 * it). Feedback signing runs on-device through this, so base64url must be byte-exact: a wrong char or
 * padding bug silently produces invalid signatures. We validate the transform against standard base64
 * (trusted) + round-trips, and that other encodings still delegate.
 */
import { describe, it, expect } from 'vitest';
import { Buffer as B } from '../src/web/shims/bufferPolyfill.js';

// url-safe = base64 with +→-, /→_, and no `=` padding.
const manualB64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('bufferPolyfill base64url', () => {
  // Byte lengths mod 3 = 1, 2, 0 → the three base64 padding cases (==, =, none).
  const vectors = [
    Uint8Array.from([0x66]),                                  // len 1 → 2 pad
    Uint8Array.from([0x66, 0x6f]),                            // len 2 → 1 pad
    Uint8Array.from([0x66, 0x6f, 0x6f]),                      // len 3 → 0 pad
    Uint8Array.from([0xff, 0xef, 0xbe, 0xfe, 0x00, 0x10]),    // exercises + and / in standard base64
    Uint8Array.from(Array.from({ length: 40 }, (_, i) => (i * 37) % 256)),
  ];

  it('encodes to url-safe, unpadded base64url matching the manual transform', () => {
    for (const bytes of vectors) {
      const buf = B.from(bytes);
      const got = buf.toString('base64url');
      expect(got).toBe(manualB64Url(buf.toString('base64')));   // matches standard base64, url-safed
      expect(got).not.toMatch(/[+/=]/);                          // no +, /, or padding
    }
  });

  it('round-trips: from(base64url) decodes back to the original bytes', () => {
    for (const bytes of vectors) {
      const url = B.from(bytes).toString('base64url');
      const back = B.from(url, 'base64url');
      expect(Uint8Array.from(back)).toEqual(bytes);
    }
  });

  it('still delegates non-base64url encodings (utf8, hex, base64)', () => {
    const buf = B.from('Jan de Vries — café', 'utf8');
    expect(buf.toString('utf8')).toBe('Jan de Vries — café');
    expect(B.from('deadbeef', 'hex').toString('hex')).toBe('deadbeef');
    const b64 = buf.toString('base64');
    expect(B.from(b64, 'base64').toString('utf8')).toBe('Jan de Vries — café');
  });

  it('installs a global Buffer', () => {
    expect(typeof globalThis.Buffer).toBe('function');
  });
});
