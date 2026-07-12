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
| `j-companion` | **[needs a real pod]** device delegates scoped pod access → companion acts on a REAL CSS via proxy (holds no secret) → out-of-scope denied → revoke denies |
| `task-claim` | **[hermetic]** the hard distributed case: mesh splits → both halves claim the same task → reconverge → the double-claim is surfaced as a conflict (never a silent overwrite), no work lost |
| `j-security` | **[hermetic]** adversarial: forge / privilege-escalate / impersonate / steal a capability token, and read another's sealed mail — each DEFENDED by the real PolicyEngine verifier + nacl.box sealing |
| `j-notifications` | reliable-wake nudge: a message for an away device fires ONE contentless wake (mutable-content, no sender/content) → device pulls the sealed content itself |
| `j-feedback` | **[needs a real pod + the feedback app]** multi-user central-pod route: several users' feedback lands in one central pod as PSEUDONYMOUS contributions (no identity in the body), aggregatable, duplicate-id rejected — the §6a server-side / Telegram on-ramp shape |
| `j-manage` | companion-node management (6d), BOTH surfaces: ① owner invokes owner-gated node ops over the relay (the canopy-chat path); ② the node-served `/manage` web + owner-pairing flow (browser gets a session token only after the owner approves its code from their phone); non-owners denied throughout |
| `j-bot` | **[hermetic registry]** a bot added to a shared circle with a CUSTOM NAME (`registerAgentBundle`); two users discover the SAME bot from one shared registry and each invoke it over the relay (6b) |
| `j-keyexchange` | cross-app scoped data/key access (6c), both models: (a) a scoped per-resource key GRANT the app opens offline (wrong-scope / stolen / revoked → no key); (b) PROXY — the app never holds a key, the custodian opens over the relay and returns plaintext only |

Each journey uses fresh identities, so they can share one relay without collision.
`two-party` / `offline` / `multi-party` are SDK-level (relay only). `sealed` spins up
a real `@canopy-app/companion-node` with the inbox enabled. `j-buurt` drives two
real `@canopy-app/stoop` `createNeighborhoodAgent` instances with the substrate mirror.
`task-claim` is **hermetic** — it uses the in-process partitionable transport (you
cannot tell a real relay to partition on command), so it ignores the relay URL and
reuses the real tasks-v0 claim + substrate-mirror conflict machinery.

**`j-companion` is gated on a real pod** and **skips cleanly** when none is reachable
(so the rest of the matrix stays green with no CSS). It provisions a fresh account +
client-credentials, runs a real on-device Solid-OIDC (DPoP) session, and proxies every
pod fetch back to the device. Boot a CSS and point the harness at it:
```bash
npx -y @solid/community-server@^7 -c @css:config/file.json -p 3001 -b http://localhost:3001/ -f /tmp/pod &
CSS_URL=http://localhost:3001/ node run.mjs      # now j-companion runs instead of skipping
```

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
