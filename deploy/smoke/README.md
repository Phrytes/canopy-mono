# deploy/smoke — live relay smoke test

One command to check that a **deployed** relay is healthy end-to-end, over the
relay's documented wire protocol (`register` / `send` / `message`).

```bash
node deploy/smoke/smoke.mjs wss://your-relay.example
# or:
RELAY_URL=wss://your-relay.example node deploy/smoke/smoke.mjs
```

Exit `0` = all checks passed, `1` = a check failed, `2` = usage error. Suitable
for CI or a post-deploy gate.

## What it checks

1. **Reachability** — `wss://` TLS + WebSocket upgrade + the `registered` ack.
2. **Two-party delivery** — A→B and B→A.
3. **Offline hold** — messages to a disconnected peer are held and flushed, in
   order, when it reconnects (the relay's store-and-forward queue).
4. **Multi-party fan-out** — a small circle with one offline member: online
   members get the broadcast live, the offline one gets it on reconnect, and a
   sender never receives its own broadcast.

## Scope

This validates the **deployment** — is the public endpoint up, does it broker and
hold messages. It is deliberately self-contained: the only dependency is `ws`
(in this monorepo it resolves from the repo root; standalone, `npm i ws`), so you
can run it against any target — a cloudflared tunnel, Koyeb, an Oracle VM — with
no workspace checkout.

It is **not** the full integration suite. The real `Agent` / envelope-security /
sealed-inbox (M2) journeys run against the actual SDK and live in the workspace
tests (`packages/**`, `apps/companion-node`, `apps/tasks-v0/test/j-offline`).

## Runbook

Deployment paths (tunnel / Koyeb / Oracle) are in [`../DEPLOY-RUNBOOK.md`](../DEPLOY-RUNBOOK.md).
After bringing a relay up, point this script at its `wss://` URL as the last step.
