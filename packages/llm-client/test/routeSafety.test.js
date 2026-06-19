// Shared confidential-route guard — the leak-prevention contract every consumer relies on.
import { describe, it, expect, afterEach } from 'vitest';
import {
  isLoopbackBase,
  attestationConfigured,
  isConfidentialRouteSafe,
  assertConfidentialRouteSafe,
} from '../src/routeSafety.js';

describe('isLoopbackBase', () => {
  it('recognises localhost / 127.0.0.1 / ::1 (incl. ports + paths)', () => {
    expect(isLoopbackBase('http://localhost:8080/v1')).toBe(true);
    expect(isLoopbackBase('http://127.0.0.1:8080')).toBe(true);
    expect(isLoopbackBase('http://[::1]:8080/v1')).toBe(true);
  });
  it('rejects LAN / remote hosts and junk', () => {
    expect(isLoopbackBase('http://192.168.2.20:8080/v1')).toBe(false);
    expect(isLoopbackBase('https://enclave.example/v1')).toBe(false);
    expect(isLoopbackBase('')).toBe(false);
    expect(isLoopbackBase(null)).toBe(false);
    expect(isLoopbackBase('not a url')).toBe(false);
  });
});

describe('attestationConfigured', () => {
  const had = process.env.PRIVATEMODE_ATTESTATION;
  afterEach(() => { if (had === undefined) delete process.env.PRIVATEMODE_ATTESTATION; else process.env.PRIVATEMODE_ATTESTATION = had; });
  it('true when the caller asserts it', () => { expect(attestationConfigured({ attestation: true })).toBe(true); });
  it('true when the env opts in', () => { process.env.PRIVATEMODE_ATTESTATION = '1'; expect(attestationConfigured()).toBe(true); });
  it('false otherwise', () => { delete process.env.PRIVATEMODE_ATTESTATION; expect(attestationConfigured()).toBe(false); });
});

describe('isConfidentialRouteSafe', () => {
  it('non-confidential routes are not this gate (local model, explicit cloud opt-in)', () => {
    expect(isConfidentialRouteSafe({ confidential: false, baseUrl: 'https://anything/v1' })).toBe(true);
    expect(isConfidentialRouteSafe({ baseUrl: 'https://anything/v1' })).toBe(true);
  });
  it('confidential + loopback = safe', () => {
    expect(isConfidentialRouteSafe({ confidential: true, baseUrl: 'http://localhost:8080/v1' })).toBe(true);
  });
  it('confidential + non-loopback + no attestation = UNSAFE', () => {
    expect(isConfidentialRouteSafe({ confidential: true, baseUrl: 'http://192.168.2.20:8080/v1' })).toBe(false);
  });
  it('confidential + non-loopback + attestation asserted = safe', () => {
    expect(isConfidentialRouteSafe({ confidential: true, baseUrl: 'http://192.168.2.20:8080/v1', attestation: true })).toBe(true);
  });
});

describe('assertConfidentialRouteSafe', () => {
  it('throws on the LAN-leak case, naming the call site', () => {
    expect(() => assertConfidentialRouteSafe({ confidential: true, baseUrl: 'http://192.168.2.20:8080/v1', label: 'household' }))
      .toThrow(/household/);
    expect(() => assertConfidentialRouteSafe({ confidential: true, baseUrl: 'http://192.168.2.20:8080/v1' }))
      .toThrow(/non-loopback/);
  });
  it('passes loopback + attested + non-confidential without throwing', () => {
    expect(() => assertConfidentialRouteSafe({ confidential: true, baseUrl: 'http://localhost:8080/v1' })).not.toThrow();
    expect(() => assertConfidentialRouteSafe({ confidential: true, baseUrl: 'https://enclave/v1', attestation: true })).not.toThrow();
    expect(() => assertConfidentialRouteSafe({ confidential: false, baseUrl: 'https://anything/v1' })).not.toThrow();
  });
});
