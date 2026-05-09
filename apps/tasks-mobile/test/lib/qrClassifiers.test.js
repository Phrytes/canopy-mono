/**
 * qrClassifiers — verifies each Tasks-mobile QR shape classifies
 * correctly through the substrate's `classifyQrPayload(text, classifiers)`
 * dispatcher (Phase 41.0 L4 lift).
 *
 * Phase 41.3.7 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { classifyQrPayload } from '@canopy/react-native/qr';
import { TASKS_CLASSIFIERS, _internal } from '../../src/lib/qrClassifiers.js';

describe('qrClassifiers — invite', () => {
  const validInvite = {
    groupId:   'oss-tools',
    nonce:     'abc123',
    expiresAt: 1234567890,
    role:      'member',
    signature: 'sig-base64url',
  };

  it('classifies a tasks://invite?token=<base64url-json> URL', () => {
    const json = JSON.stringify(validInvite);
    const b64u = Buffer.from(json, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `tasks://invite?token=${b64u}`;
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
    expect(r.payload.token.groupId).toBe('oss-tools');
    expect(r.payload.token.signature).toBe('sig-base64url');
  });

  it('classifies a tasks://invite?token=<raw-json> URL (urlencoded)', () => {
    const url = `tasks://invite?token=${encodeURIComponent(JSON.stringify(validInvite))}`;
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
    expect(r.payload.token.groupId).toBe('oss-tools');
  });

  it('classifies bare-JSON invite (web → QR fallback)', () => {
    const r = classifyQrPayload(JSON.stringify(validInvite), TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
  });

  it('accepts the short-code shape (groupId + code) too', () => {
    const codeInvite = { groupId: 'oss-tools', code: 'abc123', expiresAt: 1234567890 };
    const r = classifyQrPayload(JSON.stringify(codeInvite), TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
    expect(r.payload.token.code).toBe('abc123');
  });

  it('rejects invite with no groupId', () => {
    expect(classifyQrPayload(JSON.stringify({ signature: 'sig' }), TASKS_CLASSIFIERS).kind)
      .toBe('unknown');
  });

  it('rejects invite with neither signature nor code', () => {
    expect(classifyQrPayload(JSON.stringify({ groupId: 'x' }), TASKS_CLASSIFIERS).kind)
      .toBe('unknown');
  });
});

describe('qrClassifiers — bot-token', () => {
  it('classifies tasks://bot-token?... with all required params', () => {
    const url = 'tasks://bot-token?chatId=123&webid=https%3A%2F%2Fid%2Fanne&tokenBlob=opaque-blob';
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('bot-token');
    expect(r.payload).toEqual({
      chatId:    '123',
      webid:     'https://id/anne',
      tokenBlob: 'opaque-blob',
    });
  });

  it('rejects bot-token URL missing required params', () => {
    expect(classifyQrPayload('tasks://bot-token?chatId=123', TASKS_CLASSIFIERS).kind)
      .toBe('unknown');
  });
});

describe('qrClassifiers — contact', () => {
  it('classifies a tasks-contact:// URI', () => {
    const r = classifyQrPayload('tasks-contact://example/anne', TASKS_CLASSIFIERS);
    expect(r.kind).toBe('contact');
    expect(r.payload.uri).toBe('tasks-contact://example/anne');
  });

  it('classifies a tasks://contact?uri=... URL', () => {
    const url = 'tasks://contact?uri=' + encodeURIComponent('tasks-contact://example/anne');
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('contact');
    expect(r.payload.uri).toBe('tasks-contact://example/anne');
  });
});

describe('qrClassifiers — recovery (BIP-39)', () => {
  it('classifies a 12-word phrase', () => {
    const phrase = Array(12).fill('apple').join(' ');
    const r = classifyQrPayload(phrase, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('recovery');
    expect(r.payload.words).toHaveLength(12);
  });

  it('classifies a 24-word phrase', () => {
    const phrase = Array(24).fill('apple').join(' ');
    const r = classifyQrPayload(phrase, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('recovery');
    expect(r.payload.words).toHaveLength(24);
  });

  it('rejects 13-word phrase (off-ladder)', () => {
    const phrase = Array(13).fill('apple').join(' ');
    expect(classifyQrPayload(phrase, TASKS_CLASSIFIERS).kind).toBe('unknown');
  });

  it('rejects phrase with digits', () => {
    const phrase = Array(11).fill('apple').concat(['app1e']).join(' ');
    expect(classifyQrPayload(phrase, TASKS_CLASSIFIERS).kind).toBe('unknown');
  });
});

describe('qrClassifiers — fallthrough', () => {
  it('returns kind=unknown for empty / non-Tasks input', () => {
    expect(classifyQrPayload('', TASKS_CLASSIFIERS).kind).toBe('unknown');
    expect(classifyQrPayload('https://example.com', TASKS_CLASSIFIERS).kind).toBe('unknown');
    expect(classifyQrPayload('stoop://invite?token=...', TASKS_CLASSIFIERS).kind).toBe('unknown');
  });
});
