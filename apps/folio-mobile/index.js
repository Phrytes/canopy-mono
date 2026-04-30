// Crypto polyfill MUST be the first import — @noble/hashes (transitively
// pulled in by @scure/bip39 via @canopy/core's Mnemonic) looks up
// globalThis.crypto at module-load time.  On React Native that global
// doesn't exist by default; react-native-get-random-values installs it
// synchronously.  Without this line the bundle crashes on startup with
// "property 'require' doesn't exist" as soon as Hermes tries to resolve
// the missing crypto object.
import 'react-native-get-random-values';

// Buffer-on-globalThis polyfill — `@inrupt/solid-client` and a long tail
// of npm libs assume Node's global `Buffer` is reachable as a free
// identifier.  The buffer npm polyfill exports it as a named export but
// doesn't install it globally; we do that here.  Must run before any
// import that synthesizes Buffer at module-load time.
//   See docs/SOLID-RN-NOTES.md (trap 11).
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;

// Blob.arrayBuffer() / Blob.text() polyfills — not implemented by RN's
// Blob.  @inrupt/solid-client reads pod-file bodies via
// `response.blob().then(b => b.arrayBuffer())` and similar — without
// these methods the chain throws "blob.arrayBuffer is not a function".
//   See docs/SOLID-RN-NOTES.md (trap 12).
if (typeof Blob !== 'undefined') {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof Blob.prototype.text !== 'function') {
    Blob.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsText(this);
      });
    };
  }

  // RN's Blob constructor doesn't accept ArrayBuffer / ArrayBufferView
  // (only string/Blob).  @inrupt/solid-client does `new Blob([content])`
  // when uploading file bytes.  Patch the constructor to UTF-8-decode
  // binary parts into strings so RN's underlying Blob accepts them.
  //
  // ⚠️ This is text-correct: Folio writes utf8 text (.md, .txt) so the
  //    decode is lossless.  For TRULY BINARY content (images, etc.)
  //    this corrupts because UTF-8 decoding mangles non-text bytes.
  //    Revisit when Folio mobile starts writing binary.  Tracked in
  //    docs/SOLID-RN-NOTES.md (trap 13).
  const OrigBlob = globalThis.Blob;
  function PatchedBlob(parts, options) {
    if (Array.isArray(parts) && globalThis.TextDecoder) {
      const td = new globalThis.TextDecoder('utf-8');
      parts = parts.map((p) => {
        if (p instanceof ArrayBuffer)        return td.decode(p);
        if (ArrayBuffer.isView?.(p))         return td.decode(p);
        return p;
      });
    }
    return new OrigBlob(parts, options);
  }
  PatchedBlob.prototype = OrigBlob.prototype;
  globalThis.Blob = PatchedBlob;
}

import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
