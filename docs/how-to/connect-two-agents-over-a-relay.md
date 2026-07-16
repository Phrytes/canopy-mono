# How to connect two agents over a relay

The tutorials run everything in one process over `InternalTransport`. This guide moves the same
two agents onto a **self-hosted WebSocket relay**, so they can talk across processes and
machines. Nothing in the agent code changes except the transport.

Assumes you have done [Tutorial 1](../tutorials/01-first-agent.md).

## 1. Run a relay

From a checkout of this repo:

```sh
npm run relay:start          # listens on ws://0.0.0.0:8787 (PORT env overrides)
```

For a hosted deployment, `node deploy/relay/entrypoint.mjs` is a ready PaaS entrypoint that
additionally wires the optional media blob-gate and push-wake seams from env; behind a PaaS
proxy the relay listens on plain HTTP and the proxy terminates TLS, so the public URL is
`wss://…`. The relay routes encrypted envelopes between registered agents; peers encrypt for
each other, so the relay operator never holds the content keys.

## 2. Swap the transport

Take the two agents from Tutorial 1 and replace each `InternalTransport` with a
`RelayTransport` pointed at your relay:

```js
import { Agent, AgentIdentity, Parts, callSkill, sendMessage } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';

const relayUrl = 'ws://localhost:8787';   // wss://relay.example.org in production

const hostId = await AgentIdentity.generate(new VaultMemory());
const host = new Agent({
  identity:  hostId,
  transport: new RelayTransport({ identity: hostId, relayUrl }),
  label:     'host',
});

const botId = await AgentIdentity.generate(new VaultMemory());
const bot = new Agent({
  identity:  botId,
  transport: new RelayTransport({ identity: botId, relayUrl }),
  label:     'bot',
});
```

`agent.start()` does not block on relay reachability — the transport connects in the
background with backoff, and outgoing sends queue until the socket is registered.

## 3. Register peers and talk

Identical to the in-process version. With `RelayTransport`, an agent's address **is** its
public key, so exchanging public keys (out of band: a QR code, a config file, a directory) is
all the introduction two machines need:

```js
host.register('greet', async ({ parts }) => {
  const args = Parts.data(parts) ?? {};
  return { greeting: `Hello, ${args.name ?? 'stranger'}!` };
}, { description: 'Greets the caller by name' });

await host.start();
await bot.start();

bot.addPeer(host.address, host.pubKey);
host.addPeer(bot.address, bot.pubKey);

await sendMessage(bot, host.address, 'ping over the relay');

const task   = callSkill(bot, host.address, 'greet', Parts.wrap({ name: 'Relay Bot' }));
const result = await task.done();
Parts.data(result.parts);   // → { greeting: 'Hello, Relay Bot!' }
```

To run this across two machines, split the script: the host half on one machine, the bot half
on the other, both constructed with the same `relayUrl`. Only the public keys cross between
them.

## Notes

**No relay of your own?** `NknTransport` (same package) rides the public NKN network instead;
`RendezvousTransport` upgrades a pair to a direct WebRTC channel and uses the relay only for
signaling. All satisfy the same `Transport` port — the agent code above stays unchanged. The
relay's server implementation lives in `packages/relay`.

Related: [`@onderling/transports` README](../../packages/transports/README.md) ·
[building compatible agents](../building-compatible-agents.md).
