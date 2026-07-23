import { describe, it } from 'vitest';
import nknMod from 'nkn-sdk';
import nacl from 'tweetnacl';
import { b64decode } from '@onderling/core';
import { bootRealAgentNode, teardown } from '../support/pairRealAgents.js';

function nknAddressFromChatPubKey(to) {
  if (typeof to !== 'string' || !to) return to;
  const bare = to.includes('.') ? to.slice(to.lastIndexOf('.') + 1) : to;
  if (/^[0-9a-f]{64}$/i.test(bare)) return to;
  const bytes = b64decode(to);
  if (!bytes || bytes.length !== 32) return to;
  const pub = nacl.sign.keyPair.fromSeed(bytes).publicKey;
  return Array.from(pub).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// STEP-BY-STEP NKN probe: does my pubKey->NKN-address converter match the address
// NKN actually registers each agent under? And can A reach B at that address?
describe.skip('NKN address probe — validated converter === real NKN addr; raw A->B delivery dead in sandbox (network)', () => {
  it('actual NKN addr vs converter, then raw reachability A->B', async () => {
    const nknLib = nknMod.default ?? nknMod;
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');

    // capture inbound on B at the transport level (before any secure-agent logic)
    let bGotRaw = null;
    const txA = await A.agent.connectPeerTransport({ nknLib, onPeerMessage: (e) => A._routerRef.fn?.(e) });
    const txB = await B.agent.connectPeerTransport({ nknLib, onPeerMessage: (e) => { bGotRaw = e; B._routerRef.fn?.(e); } });

    const aConv = nknAddressFromChatPubKey(A.pubKey);
    const bConv = nknAddressFromChatPubKey(B.pubKey);
    console.log('[probe] A chatPubKey :', A.pubKey);
    console.log('[probe] A actual addr:', txA.address);
    console.log('[probe] A converter  :', aConv, '| MATCH:', txA.address === aConv);
    console.log('[probe] B actual addr:', txB.address);
    console.log('[probe] B converter  :', bConv, '| MATCH:', txB.address === bConv);

    // Raw reachability: send a bare HI directly to B's ACTUAL addr, wait a bit.
    try {
      await txA.sendHello(txB.address, { pubKey: A.pubKey });
      console.log('[probe] sent raw HI to B.actual — no throw');
    } catch (e) { console.log('[probe] raw HI to B.actual threw:', e?.message); }
    await new Promise((r) => setTimeout(r, 6000));
    console.log('[probe] B got a raw inbound?', !!bGotRaw, bGotRaw ? JSON.stringify(bGotRaw).slice(0, 120) : '');

    await teardown(A, B);
  }, 60_000);
});
