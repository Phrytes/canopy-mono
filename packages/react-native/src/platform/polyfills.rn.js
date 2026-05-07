// Polyfills entry — React Native variant.
//
// Metro's RN bundler auto-resolves this file when an app imports
// `@canopy/react-native/platform/polyfills`.  Node / web bundlers
// see the sibling `polyfills.js` (no-op).
//
// Apps must import this BEFORE any other @canopy substrate.  The
// peer-deps (react-native-get-random-values, buffer) must be in the
// app's package.json — the substrate doesn't bundle them.
//
// Polyfills handled here (drawn from Folio's mobile bring-up — see
// ./shims/.. + docs/BRING-UP-NOTES.md for the full saga):
//
//   1. crypto.getRandomValues          — react-native-get-random-values
//   2. globalThis.Buffer                — buffer package
//   3. Blob.prototype.arrayBuffer + Blob.prototype.text (missing on RN)
//   4. Blob constructor patched to accept ArrayBuffer parts (text-only;
//      Folio writes utf8 text — see TRAP 13 in docs/BRING-UP-NOTES.md
//      for the binary-content caveat)
//
// Apps with stricter binary needs override individual polyfills after
// importing this module.

// ─── 1. crypto.getRandomValues ────────────────────────────────────
//
// @noble/hashes (pulled in by @scure/bip39 via @canopy/core's
// Mnemonic) looks up `globalThis.crypto` at module-load time.  On RN
// that global doesn't exist by default; react-native-get-random-values
// installs it synchronously.  Without this, the bundle crashes on
// startup with "property 'require' doesn't exist" as soon as Hermes
// tries to resolve the missing crypto object.
//
// MUST be the first import in this file.
import 'react-native-get-random-values';

// ─── 2. globalThis.Buffer ─────────────────────────────────────────
//
// @inrupt/solid-client + a long tail of npm libs assume Node's global
// `Buffer` is reachable as a free identifier.  The `buffer` polyfill
// package exports it as a named export but doesn't install it
// globally.  We do that here.  See trap 11.
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;

// ─── 3. Blob.prototype.arrayBuffer / .text ────────────────────────
//
// RN's Blob doesn't ship these.  @inrupt/solid-client reads pod-file
// bodies via `response.blob().then(b => b.arrayBuffer())` and similar
// — without these methods the chain throws "blob.arrayBuffer is not
// a function".  See trap 12.
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

  // ─── 4. Blob constructor patch ────────────────────────────────
  //
  // RN's Blob constructor doesn't accept ArrayBuffer / ArrayBufferView
  // (only string/Blob).  @inrupt/solid-client does `new Blob([content])`
  // when uploading file bytes.  Patch the constructor to UTF-8-decode
  // binary parts into strings so RN's underlying Blob accepts them.
  //
  // ⚠️ TEXT-ONLY: Folio writes utf8 text (.md, .txt) so the decode
  //    is lossless.  For TRULY BINARY content (images, etc.) this
  //    corrupts because UTF-8 decoding mangles non-text bytes.
  //    Apps that write binary should patch globalThis.Blob with a
  //    base64 / explicit-binary path AFTER importing this module.
  //    See trap 13.
  const OrigBlob = globalThis.Blob;
  function PatchedBlob(parts, options) {
    if (Array.isArray(parts) && globalThis.TextDecoder) {
      const td = new globalThis.TextDecoder('utf-8');
      parts = parts.map((p) => {
        if (p instanceof ArrayBuffer)         return td.decode(p);
        if (ArrayBuffer.isView?.(p))          return td.decode(p);
        return p;
      });
    }
    return new OrigBlob(parts, options);
  }
  PatchedBlob.prototype = OrigBlob.prototype;
  globalThis.Blob = PatchedBlob;
}

// ─── Sanity check ─────────────────────────────────────────────────
//
// If react-native-get-random-values didn't load (peer-dep missing or
// import order wrong), substrates that sign / generate keys will fail.
if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
  console.warn(
    '[@canopy/react-native/platform/polyfills] crypto.getRandomValues unavailable. ' +
    'Did react-native-get-random-values fail to load? It must be in app peer-deps + ' +
    'this file must be imported before any other @canopy substrate.',
  );
}
