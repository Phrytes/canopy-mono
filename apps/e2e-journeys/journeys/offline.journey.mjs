// Store-and-forward: Bob goes offline, Ann keeps sending, the relay holds the
// messages and flushes them in order when Bob reconnects.
import { Agent, AgentIdentity, Parts } from '@onderling/core';
import { VaultMemory }    from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'offline store-and-forward';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const annId = await AgentIdentity.generate(new VaultMemory());
  const bobId = await AgentIdentity.generate(new VaultMemory());
  const ann = new Agent({ identity: annId, transport: new RelayTransport({ relayUrl, identity: annId }) });
  const bob = new Agent({ identity: bobId, transport: new RelayTransport({ relayUrl, identity: bobId }) });
  ann.addPeer(bob.address, bob.pubKey);
  bob.addPeer(ann.address, ann.pubKey);
  const inbox = [];
  bob.on('message', (m) => inbox.push(Parts.text(m.parts)));

  try {
    await ann.start(); await bob.start(); await wait(1500);
    check('both online at start', ann.transport.connected && bob.transport.connected);

    await bob.transport.disconnect(); await wait(600);
    check('Bob offline', !bob.transport.connected);

    const held = ['held-1', 'held-2', 'held-3'];
    for (const m of held) { await ann.message(bob.address, m); await wait(140); }
    await wait(600);
    check('nothing delivered while offline', inbox.length === 0);

    await bob.transport.connect(); await wait(1800);
    check('all held messages flushed in order on reconnect',
      JSON.stringify(inbox.filter((x) => held.includes(x))) === JSON.stringify(held));
  } finally {
    await ann.transport.disconnect().catch(() => {});
    await bob.transport.disconnect().catch(() => {});
  }
  return results;
}
