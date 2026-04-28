import { describe, it, expect } from 'vitest';

import {
  PodClientError,
  AuthError,
  CapabilityError,
  NotFoundError,
  ConflictError,
  NetworkError,
  PolicyError,
  MalformedResourceError,
  EncryptionError,
  ConventionError,
  mapSourceCode,
  Auth,
} from '../src/index.js';

describe('Errors taxonomy', () => {
  const subclasses = [
    ['AuthError',              AuthError,              'UNAUTHORIZED',         false],
    ['CapabilityError',        CapabilityError,        'FORBIDDEN',            false],
    ['NotFoundError',          NotFoundError,          'NOT_FOUND',            false],
    ['ConflictError',          ConflictError,          'CONFLICT',             false],
    ['NetworkError',           NetworkError,           'NETWORK_ERROR',        true ],
    ['PolicyError',            PolicyError,            'RATE_LIMITED',         false],
    ['MalformedResourceError', MalformedResourceError, 'MALFORMED_RESOURCE',   false],
    ['EncryptionError',        EncryptionError,        'ENCRYPTION_FAILED',    false],
    ['ConventionError',        ConventionError,        'CONVENTION_ERROR',     false],
  ];

  for (const [label, Cls, defaultCode, defaultRetryable] of subclasses) {
    it(`${label}: constructable + instanceof Error/PodClientError + has default code/name/retryable`, () => {
      const err = new Cls(`${label} happened`);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PodClientError);
      expect(err).toBeInstanceOf(Cls);
      expect(err.name).toBe(label);
      expect(err.code).toBe(defaultCode);
      expect(err.retryable).toBe(defaultRetryable);
      expect(err.message).toBe(`${label} happened`);
    });

    it(`${label}: opts override defaults (uri, cause, retryable, code)`, () => {
      const cause = new Error('boom');
      const err = new Cls('msg', {
        uri: '/foo',
        cause,
        code: 'CUSTOM_CODE',
        retryable: !defaultRetryable,
      });
      expect(err.uri).toBe('/foo');
      expect(err.cause).toBe(cause);
      expect(err.code).toBe('CUSTOM_CODE');
      expect(err.retryable).toBe(!defaultRetryable);
    });
  }

  it('PodClientError: constructable directly with code + retryable defaults', () => {
    const err = new PodClientError('base', { code: 'X' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PodClientError');
    expect(err.code).toBe('X');
    expect(err.retryable).toBe(false);
    expect(err.uri).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe('mapSourceCode', () => {
  const cases = [
    ['NOT_FOUND',                    NotFoundError,    'NOT_FOUND'],
    ['UNAUTHORIZED',                 AuthError,        'UNAUTHORIZED'],
    ['FORBIDDEN',                    CapabilityError,  'FORBIDDEN'],
    ['CONFLICT',                     ConflictError,    'CONFLICT'],
    ['RATE_LIMITED',                 PolicyError,      'RATE_LIMITED'],
    ['SERVER_ERROR',                 NetworkError,     'NETWORK_ERROR'],
    ['HTTP_ERROR',                   NetworkError,     'NETWORK_ERROR'],
    ['NETWORK_ERROR',                NetworkError,     'NETWORK_ERROR'],
    ['HASH_MISMATCH',                ConventionError,  'HASH_MISMATCH'],
    ['INVALID_MANIFEST',             ConventionError,  'INVALID_MANIFEST'],
    ['EXTERNAL_STORE_NOT_CONFIGURED', ConventionError, 'EXTERNAL_STORE_NOT_CONFIGURED'],
    ['EXTERNAL_STORE_BAD_RESPONSE',  ConventionError,  'EXTERNAL_STORE_BAD_RESPONSE'],
  ];

  for (const [input, ExpectedCls, expectedCode] of cases) {
    it(`${input} → ${ExpectedCls.name} (code ${expectedCode})`, () => {
      const err = mapSourceCode(input);
      expect(err).toBeInstanceOf(ExpectedCls);
      expect(err).toBeInstanceOf(PodClientError);
      expect(err.code).toBe(expectedCode);
    });
  }

  it('NETWORK_ERROR is retryable', () => {
    const err = mapSourceCode('NETWORK_ERROR');
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.retryable).toBe(true);
  });

  it('SERVER_ERROR + HTTP_ERROR are retryable (mapped via NetworkError)', () => {
    expect(mapSourceCode('SERVER_ERROR').retryable).toBe(true);
    expect(mapSourceCode('HTTP_ERROR').retryable).toBe(true);
  });

  it('INVALID_ARGUMENT returns base PodClientError, not retryable', () => {
    const err = mapSourceCode('INVALID_ARGUMENT');
    expect(err).toBeInstanceOf(PodClientError);
    // Specifically NOT one of the typed subclasses.
    expect(err).not.toBeInstanceOf(NotFoundError);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.retryable).toBe(false);
  });

  it('Unknown code returns base PodClientError preserving the raw code', () => {
    const err = mapSourceCode('UNRECOGNIZED_FOO');
    expect(err).toBeInstanceOf(PodClientError);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(NotFoundError);
    expect(err.code).toBe('UNRECOGNIZED_FOO');
    expect(err.retryable).toBe(false);
  });

  it('Threads { uri, cause } through to the resulting error', () => {
    const cause = new Error('underlying');
    const err = mapSourceCode('NOT_FOUND', { uri: '/x', cause });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.uri).toBe('/x');
    expect(err.cause).toBe(cause);
  });
});

describe('Auth interface (abstract)', () => {
  it('getAuthHeaders + identity throw "not implemented" by default', async () => {
    const a = new Auth();
    await expect(a.getAuthHeaders('https://x', 'GET')).rejects.toThrow(/not implemented/);
    expect(() => a.identity()).toThrow(/not implemented/);
  });

  it('refresh + close are no-ops by default (resolve undefined)', async () => {
    const a = new Auth();
    await expect(a.refresh()).resolves.toBeUndefined();
    await expect(a.close()).resolves.toBeUndefined();
  });
});
