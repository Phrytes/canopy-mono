# @canopy-app/e2e-journeys — end-to-end user-journey harness

Runs the flagship user journeys against a relay **in one process, with the real
SDK + app code** (no stubs). It's the repeatable "is the whole thing healthy
end-to-end" gate — the persistent home for the journeys that were validated live
against the tunnelled stack.

```bash
# from apps/e2e-journeys (after `pnpm install` at the repo root):
node run.mjs                     # self-contained: starts a LOCAL relay, runs all journeys
node run.mjs wss://your-relay    # against a DEPLOYED relay (or set RELAY_URL)
node run.mjs wss://url buurt      # only the journeys whose name matches a filter
```

Exit `0` = every journey fully green · `1` = a failure · `2` = usage error.

## The journeys

| key | what it proves |
|-----|----------------|
| `two-party` | two independent agents exchange messages (one-way both ways + request/response) |
| `offline`   | store-and-forward: offline peer's messages are held + flushed in order on reconnect |
| `multi-party` | a 4-person circle, one member offline during a broadcast, no loss / no self-delivery |
| `sealed`    | M2 durable sealed inbox on a companion node — sealed-only, owner-gated drain, ciphertext at rest |
| `j-buurt`   | the stoop neighbourhood flow: invite → admin-verified join → prikbord post → private 1:1 chat |

Each journey uses fresh identities, so they can share one relay without collision.
`two-party` / `offline` / `multi-party` are SDK-level (relay only). `sealed` spins up
a real `@canopy-app/companion-node` with the inbox enabled. `j-buurt` drives two
real `@canopy-app/stoop` `createNeighborhoodAgent` instances with the substrate mirror.

## Two modes

- **Local (CI gate):** `node run.mjs` starts an in-process `@canopy/relay`, runs the
  matrix, tears it down. Hermetic — no network, no deployment needed.
- **Against a deployment:** pass a `wss://` URL (a cloudflared tunnel, Koyeb, an
  Oracle VM — see [`../../deploy/DEPLOY-RUNBOOK.md`](../../deploy/DEPLOY-RUNBOOK.md)).
  This is what proved the stack live over the tunnel.

## Relation to the other test layers

- `deploy/smoke/smoke.mjs` — a portable, `ws`-only **wire-protocol** smoke test of a
  *deployed* relay (no workspace checkout). Coarser; checks reachability + brokering.
- **This harness** — the full **SDK/app-level** journeys (real `Agent`, sealing,
  stoop). Richer; needs the workspace.
- `packages/**/test`, `apps/*/test` — the hermetic unit/integration suites.
