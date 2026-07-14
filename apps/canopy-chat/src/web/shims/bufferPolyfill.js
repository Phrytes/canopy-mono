// Browser Buffer polyfill WITH base64url support — installed for side effects (import first).
//
// The feedback signing path (feedback-pipeline pod/signing.js: canonicalContribution + b64u) is built
// on Node's `Buffer` and its `'base64url'` encoding, but it now runs ON-DEVICE in this browser bundle
// (the no-login signed central-pod route). The bundled `buffer` npm polyfill provides Buffer but
// predates `'base64url'`, so we patch `from`/`toString` to translate base64url ⇄ base64 ourselves.
import { Buffer as NodeBuffer } from 'buffer';

const toB64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);

const origToString = NodeBuffer.prototype.toString;
NodeBuffer.prototype.toString = function (encoding, ...rest) {
  if (encoding === 'base64url') return toB64Url(origToString.call(this, 'base64'));
  return origToString.call(this, encoding, ...rest);
};

const origFrom = NodeBuffer.from.bind(NodeBuffer);
NodeBuffer.from = function (value, encoding, ...rest) {
  if (encoding === 'base64url' && typeof value === 'string') return origFrom(fromB64Url(value), 'base64');
  return origFrom(value, encoding, ...rest);
};

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = NodeBuffer;

export { NodeBuffer as Buffer };
