import { describe, it, expect } from 'vitest';
import { verifyAttestation } from '../src/index.js';
import {
  makeReport, chainOk, chainBad, chainThrows,
  GOOD_MEASUREMENT, WRONG_MEASUREMENT, ROOTS,
} from './helpers.js';

const base = { expectedMeasurement: GOOD_MEASUREMENT, roots: ROOTS, verifyChain: chainOk };

describe('verifyAttestation — deny-by-default enclave quote check', () => {
  it('a valid, fresh, correctly-signed report => ok', async () => {
    const res = await verifyAttestation(makeReport(), base);
    expect(res.ok).toBe(true);
    expect(res.measurement).toBe(GOOD_MEASUREMENT);
    expect(res.rejected).toBeUndefined();
  });

  it('wrong measurement => rejected (enclave runs code we did NOT pin)', async () => {
    const res = await verifyAttestation(makeReport({ measurement: WRONG_MEASUREMENT }), base);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('measurement-mismatch');
    expect(res.ok).toBeUndefined();
  });

  it('stale timestamp (older than the freshness window) => rejected', async () => {
    const now = 1_000_000_000_000;
    const res = await verifyAttestation(
      makeReport({ timestamp: now - 60 * 60 * 1000 }), // 1h old
      { ...base, now, maxAgeMs: 5 * 60 * 1000 },
    );
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('stale');
  });

  it('a future-dated quote (beyond skew) => rejected as stale', async () => {
    const now = 1_000_000_000_000;
    const res = await verifyAttestation(
      makeReport({ timestamp: now + 60 * 60 * 1000 }),
      { ...base, now, maxAgeMs: 5 * 60 * 1000 },
    );
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('stale');
  });

  it('nonce mismatch => rejected (replayed quote, wrong challenge)', async () => {
    const res = await verifyAttestation(
      makeReport({ nonce: 'stale-nonce' }),
      { ...base, expectedNonce: 'fresh-nonce-123' },
    );
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('nonce-mismatch');
  });

  it('matching nonce => ok (anti-replay satisfied)', async () => {
    const res = await verifyAttestation(
      makeReport({ nonce: 'fresh-nonce-123' }),
      { ...base, expectedNonce: 'fresh-nonce-123' },
    );
    expect(res.ok).toBe(true);
  });

  it('bad signature (verifyChain returns false) => rejected', async () => {
    const res = await verifyAttestation(makeReport(), { ...base, verifyChain: chainBad });
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('bad-signature');
  });

  it('a verifyChain that THROWS => rejected, never opens the gate', async () => {
    const res = await verifyAttestation(makeReport(), { ...base, verifyChain: chainThrows });
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('bad-signature');
  });

  it('no verifyChain injected => rejected (we never assume an unchecked signature is good)', async () => {
    const res = await verifyAttestation(makeReport(), { expectedMeasurement: GOOD_MEASUREMENT, roots: ROOTS });
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('no-verify-chain');
  });

  it('signature that does not chain to OUR roots => rejected', async () => {
    const res = await verifyAttestation(makeReport(), { ...base, roots: ['not-amd'] });
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('bad-signature');
  });

  it('malformed / missing report => rejected, no throw', async () => {
    for (const bad of [null, undefined, {}, { measurement: '' }, { measurement: 'x' /* no signature */ }]) {
      const res = await verifyAttestation(bad, base);
      expect(res.rejected).toBe(true);
    }
  });

  it('no freshness at all (no nonce, no timestamp) => rejected (replayable)', async () => {
    const res = await verifyAttestation(makeReport({ timestamp: undefined }), base);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('no-freshness');
  });

  it('no expected measurement configured => rejected (nothing to pin against)', async () => {
    const res = await verifyAttestation(makeReport(), { roots: ROOTS, verifyChain: chainOk });
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('no-expected-measurement');
  });
});
