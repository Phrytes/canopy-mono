# Contributing to @onderling

## CI / PR gating

PRs are gated on `.github/workflows/test.yml`. Jobs run in parallel — one per
package — on every PR and on every push to `master` / `track-H-folio`.

**Required** (must pass before merge):

- `core`
- `pod-client`
- `relay`
- `integration-tests`
- `folio`

**Informational** (does not block merge):

- `react-native` — yellow / `continue-on-error: true` until the
  `BleTransport.test.js` + `MdnsTransport.test.js` parser failures are sorted.

See `.github/workflows/README.md` for a quick "what runs when" reference.

## Local dev

```bash
# Run every package's tests (matches what CI runs, minus the parallelism)
npm test

# Or per-package
npm run test:core
npm run test:pod-client
npm run test:relay
npm run test:rn
npm run test:scenarios          # integration-tests
npm test --prefix apps/folio    # folio
```

Tests use [Vitest](https://vitest.dev). Unit tests live under
`packages/*/test/`; cross-component scenarios under
`packages/integration-tests/`.

## Other expectations

- Read `CLAUDE.md` for the project's working agreements before touching the kernel
  or its adapters (transport primitives, security wrapping, decisions already made).
- Don't add top-level dependencies without an explicit conversation.
- Design-first: spec lives under `Design/` — code follows docs.
