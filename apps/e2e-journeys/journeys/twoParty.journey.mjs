// Two independent SDK agents exchange messages over the relay (one-way both
// directions + a request/response round-trip).
import { Agent, AgentIdentity, TextPart, Parts } from '@onderling/core';
import { VaultMemory }    from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'two-party messaging';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const annId = await AgentIdentity.generate(new VaultMemory());
  const bobId = await AgentIdentity.generate(new VaultMemory());
  const ann = new Agent({ identity: annId, transport: new RelayTransport({ relayUrl, identity: annId }) });
  const bob = new Agent({ identity: bobId, transport: new RelayTransport({ relayUrl, identity: bobId }) });
  ann.addPeer(bob.address, bob.pubKey);
  bob.addPeer(ann.address, ann.pubKey);
  bob.register('echo', async ({ parts }) => parts);
  const bobInbox = [], annInbox = [];
  bob.on('message', (m) => bobInbox.push(Parts.text(m.parts)));
  ann.on('message', (m) => annInbox.push(Parts.text(m.parts)));

  try {
    await ann.start(); await bob.start();
    await wait(1500);
    check('both agents connected', ann.transport.connected && bob.transport.connected);

    await ann.message(bob.address, 'ping A→B'); await wait(700);
    check('A→B one-way delivered', bobInbox.includes('ping A→B'));

    await bob.message(ann.address, 'pong B→A'); await wait(700);
    check('B→A one-way delivered', annInbox.includes('pong B→A'));

    let echoOk = false;
    try { echoOk = Parts.text(await ann.invoke(bob.address, 'echo', [TextPart('rt')])) === 'rt'; } catch { /* */ }
    check('request/response round-trip (invoke echo)', echoOk);
  } finally {
    await ann.transport.disconnect().catch(() => {});
    await bob.transport.disconnect().catch(() => {});
  }
  return results;
}
