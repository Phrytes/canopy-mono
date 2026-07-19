# Tutorial 1 — your first agent

Build two agents that talk to each other — no server, no network, no account. Everything in this
tutorial runs in one Node process; swapping the in-process transport for a real one
(`@onderling/transports`) is a one-line change at the end.

Runnable version: [`apps/sdk-journeys/j1-wire-bot.mjs`](../../apps/sdk-journeys/j1-wire-bot.mjs)
(`node apps/sdk-journeys/j1-wire-bot.mjs`).

## 1. Identities

Every agent owns a cryptographic identity, stored in a vault. For a first run, the in-memory
vault is enough:

```js
import { Agent, AgentIdentity, InternalBus, InternalTransport, invokeAgentSkill, sendMessage, Parts } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const hostId = await AgentIdentity.generate(new VaultMemory());
const botId  = await AgentIdentity.generate(new VaultMemory());
```

## 2. Agents on a shared bus

An `InternalTransport` carries messages inside the process — ideal for development and tests:

```js
const bus  = new InternalBus();
const host = new Agent({
  identity:  hostId,
  transport: new InternalTransport(bus, hostId.pubKey, { identity: hostId }),
  label:     'host',
});
const bot = new Agent({
  identity:  botId,
  transport: new InternalTransport(bus, botId.pubKey, { identity: botId }),
  label:     'wire-bot',
});
```

## 3. A skill

A skill is a named function another agent can call. Register one on the host, then start both
agents:

```js
host.register('greet', async ({ parts }) => {
  const args = Parts.data(parts) ?? {};
  return { greeting: `Hello, ${args.name ?? 'stranger'}!` };
}, { description: 'Greets the caller by name' });

await host.start();
await bot.start();
```

## 4. Introduce the peers

Agents encrypt for each other, so they exchange public keys once:

```js
bot.addPeer(host.address, host.pubKey);
host.addPeer(bot.address, bot.pubKey);
```

## 5. Talk

A plain message, and a skill call over the task protocol:

```js
await sendMessage(bot, host.address, 'ping from the wire bot');

const task   = invokeAgentSkill(bot, host.address, 'greet', Parts.wrap({ name: 'Journey Bot' }));
const result = await task.done();
Parts.data(result.parts);   // → { greeting: 'Hello, Journey Bot!' }
```

That is the whole model: identities, agents, skills, messages. Any Onderling application —
including the Basis client — is reachable through exactly this protocol.

## Going on-network

Replace the transport and nothing else changes:

```js
import { RelayTransport } from '@onderling/transports';

const transport = new RelayTransport({ identity: botId, relayUrl: 'wss://relay.example.org' });
```

Next: [Tutorial 2 — one manifest, every surface](02-slash-commands.md).
