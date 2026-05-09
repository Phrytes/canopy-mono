/**
 * issueBotTokenUrl — encoder + classifier round-trip.
 *
 * Phase 41.13 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { encodeIssueBotTokenUrl } from '../../src/lib/issueBotTokenUrl.js';
import { classifyQrPayload } from '@canopy/react-native/qr';
import { TASKS_CLASSIFIERS } from '../../src/lib/qrClassifiers.js';

describe('encodeIssueBotTokenUrl', () => {
  it('produces a tasks://bot-token URL with all three params', () => {
    const url = encodeIssueBotTokenUrl({
      chatId:    '123456789',
      webid:     'https://id.example/anne',
      tokenBlob: 'opaque-base64',
    });
    expect(url.startsWith('tasks://bot-token?')).toBe(true);
    expect(url).toContain('chatId=123456789');
    expect(url).toContain('webid=https%3A%2F%2Fid.example%2Fanne');
    expect(url).toContain('tokenBlob=opaque-base64');
  });

  it('round-trips through the classifier', () => {
    const url = encodeIssueBotTokenUrl({
      chatId:    'tg-12345',
      webid:     'https://id.example/anne',
      tokenBlob: 'cap-token-XYZ',
    });
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('bot-token');
    expect(r.payload).toEqual({
      chatId:    'tg-12345',
      webid:     'https://id.example/anne',
      tokenBlob: 'cap-token-XYZ',
    });
  });

  it('throws when any required field is missing', () => {
    expect(() => encodeIssueBotTokenUrl({ webid: 'w', tokenBlob: 't' })).toThrow(/chatId/);
    expect(() => encodeIssueBotTokenUrl({ chatId: 'c', tokenBlob: 't' })).toThrow(/webid/);
    expect(() => encodeIssueBotTokenUrl({ chatId: 'c', webid: 'w' })).toThrow(/tokenBlob/);
  });
});
