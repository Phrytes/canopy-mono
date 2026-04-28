/**
 * Reference manifest — schema + parser unit tests.
 */

import { describe, it, expect } from 'vitest';

import {
  hashContent,
  isReferenceManifest,
  parseReferenceManifest,
  serializeReferenceManifest,
  REFERENCE_MANIFEST_TYPE,
  REFERENCE_MANIFEST_HASH_PATTERN,
} from '../../src/storage/reference-manifest.js';

const VALID = {
  $type:       'external-reference',
  uri:         's3://bucket/key',
  contentType: 'image/jpeg',
  size:        4_500_000,
  hash:        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

describe('reference-manifest — serialize / parse round-trip', () => {
  it('round-trips a valid manifest', () => {
    const json   = serializeReferenceManifest(VALID);
    const parsed = parseReferenceManifest(json);
    expect(parsed).toEqual(VALID);
  });

  it('serializes with deterministic field order', () => {
    const a = serializeReferenceManifest(VALID);
    // Reorder the input — the output should be byte-identical.
    const reordered = {
      hash:        VALID.hash,
      size:        VALID.size,
      contentType: VALID.contentType,
      uri:         VALID.uri,
      $type:       VALID.$type,
    };
    const b = serializeReferenceManifest(reordered);
    expect(a).toBe(b);
  });

  it('parses from a Uint8Array', () => {
    const json   = serializeReferenceManifest(VALID);
    const bytes  = new TextEncoder().encode(json);
    const parsed = parseReferenceManifest(bytes);
    expect(parsed).toEqual(VALID);
  });

  it('parses from a Buffer', () => {
    const json   = serializeReferenceManifest(VALID);
    const buf    = Buffer.from(json, 'utf8');
    const parsed = parseReferenceManifest(buf);
    expect(parsed).toEqual(VALID);
  });
});

describe('reference-manifest — non-manifest content returns null', () => {
  it('returns null for plain text', () => {
    expect(parseReferenceManifest('just a text file')).toBeNull();
  });

  it('returns null for arbitrary JSON without $type marker', () => {
    expect(parseReferenceManifest(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for JSON with a different $type', () => {
    expect(parseReferenceManifest(JSON.stringify({ $type: 'other', uri: 'x' }))).toBeNull();
  });

  it('returns null for null / non-string non-bytes input', () => {
    expect(parseReferenceManifest(null)).toBeNull();
    expect(parseReferenceManifest(undefined)).toBeNull();
    expect(parseReferenceManifest(42)).toBeNull();
    expect(parseReferenceManifest({ already: 'parsed' })).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseReferenceManifest('{ not: valid json')).toBeNull();
  });
});

describe('reference-manifest — malformed manifests throw INVALID_MANIFEST', () => {
  it('rejects missing uri', () => {
    const bad = { ...VALID, uri: undefined };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/uri must be a non-empty string/);
  });

  it('rejects missing contentType', () => {
    const bad = { ...VALID, contentType: undefined };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/contentType must be a non-empty string/);
  });

  it('rejects size that is not a number', () => {
    const bad = { ...VALID, size: 'big' };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/size must be a non-negative finite number/);
  });

  it('rejects negative size', () => {
    const bad = { ...VALID, size: -1 };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/size must be a non-negative finite number/);
  });

  it('rejects hash without sha256: prefix', () => {
    const bad = { ...VALID, hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/hash must match/);
  });

  it('rejects hash with wrong length', () => {
    const bad = { ...VALID, hash: 'sha256:abc' };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/hash must match/);
  });

  it('rejects hash with uppercase hex', () => {
    const bad = { ...VALID, hash: 'sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855' };
    expect(() => parseReferenceManifest(JSON.stringify(bad)))
      .toThrowError(/hash must match/);
  });

  it('attaches code = INVALID_MANIFEST to thrown errors', () => {
    const bad = { ...VALID, hash: 'nope' };
    try {
      parseReferenceManifest(JSON.stringify(bad));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('INVALID_MANIFEST');
    }
  });
});

describe('reference-manifest — isReferenceManifest', () => {
  it('returns true for a valid manifest string', () => {
    expect(isReferenceManifest(serializeReferenceManifest(VALID))).toBe(true);
  });

  it('returns false for a malformed manifest', () => {
    const bad = { ...VALID, hash: 'nope' };
    expect(isReferenceManifest(JSON.stringify(bad))).toBe(false);
  });

  it('returns false for non-manifest JSON', () => {
    expect(isReferenceManifest(JSON.stringify({ foo: 'bar' }))).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isReferenceManifest('just text')).toBe(false);
  });

  it('returns false for non-string / non-bytes input', () => {
    expect(isReferenceManifest(null)).toBe(false);
    expect(isReferenceManifest(undefined)).toBe(false);
    expect(isReferenceManifest(42)).toBe(false);
  });

  it('returns true when given a Uint8Array of a manifest', () => {
    const json  = serializeReferenceManifest(VALID);
    const bytes = new TextEncoder().encode(json);
    expect(isReferenceManifest(bytes)).toBe(true);
  });
});

describe('reference-manifest — hashContent', () => {
  it('produces sha256:<lowercase hex>', () => {
    const h = hashContent('hello world');
    expect(REFERENCE_MANIFEST_HASH_PATTERN.test(h)).toBe(true);
    // Known SHA-256 of "hello world"
    expect(h).toBe('sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('hashes Uint8Array and string identically when bytes match', () => {
    const text  = 'consistent';
    const bytes = new TextEncoder().encode(text);
    expect(hashContent(text)).toBe(hashContent(bytes));
  });

  it('hashes Buffer the same as Uint8Array', () => {
    const bytes = new TextEncoder().encode('foo');
    const buf   = Buffer.from(bytes);
    expect(hashContent(buf)).toBe(hashContent(bytes));
  });

  it('hashes ArrayBuffer the same as Uint8Array', () => {
    const bytes = new TextEncoder().encode('foo');
    const ab    = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(hashContent(ab)).toBe(hashContent(bytes));
  });

  it('throws for unsupported types', () => {
    expect(() => hashContent(42)).toThrow();
    expect(() => hashContent({ obj: true })).toThrow();
  });
});

describe('reference-manifest — exports', () => {
  it('exposes the manifest type marker', () => {
    expect(REFERENCE_MANIFEST_TYPE).toBe('external-reference');
  });
});
