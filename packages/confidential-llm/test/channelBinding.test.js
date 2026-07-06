import { describe, it, expect } from 'vitest';
import { verifyChannelBinding } from '../src/index.js';
import { makeReport, TLS_PUBKEY, OTHER_PUBKEY } from './helpers.js';

describe('verifyChannelBinding — RA-TLS: the attested enclave IS the TLS peer', () => {
  it('reportData commits to the presented TLS pubkey => bound (true)', () => {
    expect(verifyChannelBinding(makeReport({ reportData: TLS_PUBKEY }), TLS_PUBKEY)).toBe(true);
  });

  it('different TLS pubkey (MITM / relay) => not bound (false)', () => {
    expect(verifyChannelBinding(makeReport({ reportData: TLS_PUBKEY }), OTHER_PUBKEY)).toBe(false);
  });

  it('accepts a Uint8Array pubkey when it encodes the same commitment', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const report = makeReport({ reportData: new Uint8Array([1, 2, 3, 4]) });
    expect(verifyChannelBinding(report, bytes)).toBe(true);
    expect(verifyChannelBinding(report, new Uint8Array([1, 2, 3, 9]))).toBe(false);
  });

  it('missing reportData or missing pubkey => not bound (false), never throws', () => {
    expect(verifyChannelBinding(makeReport({ reportData: undefined }), TLS_PUBKEY)).toBe(false);
    expect(verifyChannelBinding(makeReport(), undefined)).toBe(false);
    expect(verifyChannelBinding(null, TLS_PUBKEY)).toBe(false);
  });
});
