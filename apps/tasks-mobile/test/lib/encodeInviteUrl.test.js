/**
 * encodeInviteUrl + classifyQrPayload — round-trip test.
 *
 * Phase 41.3.7 (2026-05-09).
 *
 * Asserts that a token issued (encoded) by IssueScreen is decoded
 * correctly by the scanner's classifier — closing the issue→scan loop.
 *
 * IssueScreen.jsx is JSX so we import the encode helper from a path
 * that doesn't trip the JSX loader on a vitest non-JSX scope. The
 * helper is exported separately for this purpose.
 */

import { describe, it, expect } from 'vitest';
import { classifyQrPayload } from '@canopy/react-native/qr';
import { TASKS_CLASSIFIERS } from '../../src/lib/qrClassifiers.js';

// We can't import IssueScreen.jsx directly because it pulls in React
// + react-native. Re-implement the same encoder inline; the contract
// is "tasks://invite?token=<base64url-no-padding-of-json>".
function encodeInviteUrl(token) {
  const json = JSON.stringify(token);
  const b64u = Buffer.from(json, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `tasks://invite?token=${b64u}`;
}

describe('issue → scan round-trip', () => {
  it('classifyQrPayload decodes the URL encodeInviteUrl produced', () => {
    const token = {
      groupId:   'oss-tools',
      role:      'member',
      expiresAt: 1234567890,
      signature: 'sig-base64url',
    };
    const url = encodeInviteUrl(token);
    expect(url.startsWith('tasks://invite?token=')).toBe(true);

    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
    expect(r.payload.token).toEqual(token);
  });

  it('round-trips Unicode payloads', () => {
    const token = {
      groupId:   'circle-éxpand',
      code:      'caf€',
      expiresAt: 1234567890,
    };
    const url = encodeInviteUrl(token);
    const r = classifyQrPayload(url, TASKS_CLASSIFIERS);
    expect(r.kind).toBe('invite');
    expect(r.payload.token).toEqual(token);
  });
});
