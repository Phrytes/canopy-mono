// A 4-person circle: one member is offline during a broadcast (gets it on
// reconnect), a reply reaches everyone, and senders never receive their own.
import { Agent, AgentIdentity, Parts } from '@canopy/core';
import { VaultMemory }    from '@canopy/vault';
import { RelayTransport } from '@canopy/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'multi-party circle';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  async function member() {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }) });
    a._inbox = [];
    a.on('message', (m) => a._inbox.push(Parts.text(m.parts)));
    return a;
  }
  const ann = await member(), bob = await member(), carol = await member(), dave = await member();
  const circle = [ann, bob, carol, dave];
  for (const a of circle) for (const b of circle) if (a !== b) a.addPeer(b.address, b.address);
  const bcast = async (s, t) => { for (const m of circle) if (m !== s) await s.message(m.address, t); };

  try {
    for (const a of circle) await a.start();
    await wait(1800);
    check('all four members online', circle.every((a) => a.transport.connected));

    await dave.transport.disconnect(); await wait(600);
    const m1 = 'circle: koffie zaterdag 10:00';
    await bcast(ann, m1); await wait(800);
    check('online members get broadcast; offline Dave does not',
      bob._inbox.includes(m1) && carol._inbox.includes(m1) && !dave._inbox.includes(m1));

    await dave.transport.connect(); await wait(1800);
    check('offline Dave gets the broadcast on reconnect', dave._inbox.includes(m1));

    const m2 = 'ik neem taart mee';
    await bcast(carol, m2); await wait(900);
    check('reply reaches Ann, Bob and Dave',
      ann._inbox.includes(m2) && bob._inbox.includes(m2) && dave._inbox.includes(m2));
    check('no self-delivery', !ann._inbox.includes(m1) && !carol._inbox.includes(m2));
  } finally {
    for (const a of circle) await a.transport.disconnect().catch(() => {});
  }
  return results;
}
