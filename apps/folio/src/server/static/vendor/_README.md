# Folio static vendor bundles

Third-party JS/CSS dropped into the static dir as plain files so the SPA can
reference them via `<script>` / `<link>` tags without a build step.  Each
entry below records the **source-of-truth URL**, the **version**, and a
**sha256** so future bumps can be reproduced byte-for-byte.

To re-vendor any of these, run from a tmp dir:

```bash
npm pack <pkg>@<version>          # produces <pkg>-<version>.tgz
tar xzf <pkg>-<version>.tgz       # extracts to ./package/
cp package/<dist-file> <vendor-path>
sha256sum <vendor-path>           # confirm the digest matches below
```

## marked.min.js — markdown renderer

- **Package:** [`marked`](https://www.npmjs.com/package/marked) on npm.
- **Version:** `15.0.12`
- **Source-of-truth:** `npm pack marked@15.0.12` → `package/marked.min.js`
  (the upstream pre-built UMD bundle that exposes `window.marked`).
- **Size:** 39 903 bytes.
- **sha256:** `3e7e7d7feb3e5d58cb6c804f68ab5c24cc7e5eb6270fd6e5cbb9124739217d0c`
- **Used by:** `markdownView.js`, included from `index.html` as a classic
  `<script>` so that `window.marked` is available before the ES-module
  app code runs.

## codemirror.min.js + codemirror.min.css — code editor

- **Package:** legacy CodeMirror 5 single-file build.
- See `app.js` / `conflicts.js` for usage.  Pre-existing; not changed by
  Folio v2.4.
