/**
 * verbose.js — env-var gated logging + plaintext-leak detector.
 * See coding-plans/sdk-two-device-smoke.md (Q-Smoke.4, locked 2026-04-29).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logHop,
  isVerboseEnabled,
  setVerboseEnabled,
  findPlaintextLeak,
  shortId,
} from '../src/verbose.js';

describe('verbose — env-var gating', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    setVerboseEnabled(false);
    logSpy.mockRestore();
  });

  it('is silent when RELAY_VERBOSE is not set', () => {
    setVerboseEnabled(false);
    expect(isVerboseEnabled()).toBe(false);

    logHop({
      kind: 'send',
      from: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to:   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      envelope: { _p: 'mesh', body: 'opaque' },
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits a per-hop line when RELAY_VERBOSE is on', () => {
    setVerboseEnabled(true);
    expect(isVerboseEnabled()).toBe(true);

    logHop({
      kind: 'send',
      from: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to:   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      envelope: { _p: 'mesh', body: 'AB12CD34EF56==' },  // base64-noise; no leak
    });

    expect(logSpy).toHaveBeenCalled();
    const lines = logSpy.mock.calls.map(c => c[0]);
    const hopLine = lines.find(l => l.includes('kind=send'));
    expect(hopLine).toBeTruthy();
    expect(hopLine).toMatch(/aaaaaaaaaaaa…/);
    expect(hopLine).toMatch(/bbbbbbbbbbbb…/);
    expect(hopLine).toMatch(/_p=mesh/);
    expect(hopLine).toMatch(/bytes=\d+/);
  });

  it('flags an unsealed plaintext message as a potential leak', () => {
    setVerboseEnabled(true);

    logHop({
      kind: 'send',
      from: 'alice-pubkey-aaaaaaaa',
      to:   'bob-pubkey-bbbbbbbbbb',
      envelope: {
        _p: 'mesh',
        body: 'Hello Bob, this is Alice — meeting at 3pm.',
      },
    });

    const lines = logSpy.mock.calls.map(c => c[0]);
    const leak  = lines.find(l => l.includes('potential plaintext leak'));
    expect(leak).toBeTruthy();
    // Excerpt should include part of the plaintext.
    expect(leak).toMatch(/Hello Bob/);
    // Should also include the addressing info so the user can correlate.
    expect(leak).toMatch(/from=alice-pubkey/);
    expect(leak).toMatch(/to=bob-pubkey/);
  });

  it('does NOT flag a base64-noise body (sealed-forward stand-in)', () => {
    setVerboseEnabled(true);

    // Random-looking ciphertext: long, alphanumeric, no spaces.  This is the
    // shape of a sealed envelope's body field after JSON-encoding.
    const noise =
      'eyJjaXBoZXJ0ZXh0IjoiTjlSeDhWN0pMcEttd0F1OERvVHlSNkZMbWFTcUxpbW' +
      'JjV3JhYzVRRG10b2VuMTNoeFhsRkVnNXJZcXVOSlJqVzg4NEN5UE52VkdSakZS' +
      'NXp4S0M3a3IzcWlncTl3M0F0Q3hBcEY9PSIsIm5vbmNlIjoieHJZc1ZQRVNVbm' +
      '1NeFNuajNNTk5PWk1pNFE2RlVTVWNWdyIsImVwaCI6IjV2VkVEZHowU2pHRG9G' +
      'aHAxQzJDU3JpaGVQNGZxR3pVNlBQVU5OcGFybTAifQ==';

    logHop({
      kind: 'send',
      from: 'alice', to: 'bob',
      envelope: { _p: 'mesh', body: noise },
    });

    const lines = logSpy.mock.calls.map(c => c[0]);
    const leak  = lines.find(l => l.includes('potential plaintext leak'));
    expect(leak).toBeFalsy();
  });

  it('finds plaintext nested inside an envelope object', () => {
    expect(findPlaintextLeak({
      a: 1,
      b: { c: ['noise', 'this is a secret love letter to bob'] },
    })).toMatch(/this is a secret/);
  });

  it('returns null for shapes that contain no readable runs', () => {
    expect(findPlaintextLeak({ a: 1, b: 'short', c: ['x', 'y'] })).toBeNull();
    expect(findPlaintextLeak(null)).toBeNull();
    expect(findPlaintextLeak(123)).toBeNull();
  });
});

describe('verbose — shortId', () => {
  it('truncates long ids with an ellipsis', () => {
    expect(shortId('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl…');
  });
  it('passes short ids through unchanged', () => {
    expect(shortId('alice')).toBe('alice');
  });
  it('renders nullish ids as "?"', () => {
    expect(shortId(null)).toBe('?');
    expect(shortId(undefined)).toBe('?');
  });
});
