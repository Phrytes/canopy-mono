#!/usr/bin/env node
/**
 * Runnable three-agent mesh demo.
 *
 * Same scenario as packages/core/test/integration/mesh-scenario.test.js —
 * but logged to stdout and with a non-zero exit code on assertion failure,
 * so CI can run it as a smoke test and humans can use it to understand
 * the SDK without wiring up phones.
 *
 * Usage:
 *   node examples/mesh-demo/index.js
 */
import {
  buildMesh,
  gossipOnce,
  gossipOracle,
  TextPart,
  Parts,
  Task,
}                         from '../../packages/core/test/integration/scenario.js';

const log = (msg) => console.log(`  ${msg}`);

function assert(cond, msg) {
  if (!cond) { console.error(`\n  ✗ ${msg}\n`); process.exit(1); }
  log(`✓ ${msg}`);
}

async function main() {
  console.log('\n@canopy mesh demo — three agents\n');

  const m = await buildMesh({ log });

  console.log('\n— phase 1-2: hello\n');
  await m.alice.hello(m.pubKeys.bob);
  await m.bob.hello(m.pubKeys.carol);
  assert(m.alice.security.getPeerKey(m.pubKeys.bob),   'alice has bob\'s key');
  assert(m.bob.security.getPeerKey(m.pubKeys.carol),   'bob has carol\'s key');

  console.log('\n— phase 3: gossip — alice learns about carol via bob\n');
  const added = await gossipOnce(m.alice, m.pubKeys.bob);
  assert(added === 1, `alice added ${added} indirect peer(s)`);
  const carolRec = await m.alice.peers.get(m.pubKeys.carol);
  assert(carolRec?.hops === 1 && carolRec.via === m.pubKeys.bob,
    `alice has carol as hops:${carolRec.hops}, via:${m.pubKeys.bob.slice(0, 8)}…`);

  await gossipOnce(m.carol, m.pubKeys.bob);      // so carol can also invoke alice

  console.log('\n— phase 4-5: hop messages with origin attribution\n');
  await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('hi carol')]);
  const rc = m.received.carol.at(-1);
  assert(rc?.text === 'hi carol',                  'carol got the text');
  assert(rc.originFrom === m.pubKeys.alice,        'carol sees originFrom=alice');
  assert(rc.relayedBy === m.pubKeys.bob,           'carol sees relayedBy=bob');

  await m.carol.invokeWithHop(m.pubKeys.alice, 'receive-message', [TextPart('hi alice')]);
  const ra = m.received.alice.at(-1);
  assert(ra?.originFrom === m.pubKeys.carol,       'alice sees originFrom=carol');

  console.log('\n— phase 6: forget + re-hello\n');
  await m.alice.forget(m.pubKeys.bob);
  assert(!m.alice.security.getPeerKey(m.pubKeys.bob), 'bob dropped from alice security layer');
  await m.alice.hello(m.pubKeys.bob);
  assert(!!m.alice.security.getPeerKey(m.pubKeys.bob), 'bob re-hello\'d');

  console.log('\n— phase 9 (T): oracle picks the right bridge on the first try\n');
  m.alice.enableReachabilityOracle({ ttlMs: 60_000 });
  m.bob.enableReachabilityOracle({ ttlMs: 60_000 });
  m.carol.enableReachabilityOracle({ ttlMs: 60_000 });

  // After forget + re-hello we lost the gossip entry, so re-gossip.
  await gossipOnce(m.alice, m.pubKeys.bob);
  const ok = await gossipOracle(m.alice, m.pubKeys.bob);
  assert(ok, 'alice verified and cached bob\'s reachability claim');

  // Spy on alice.invoke to check call order.
  const calls = [];
  const origInvoke = m.alice.invoke.bind(m.alice);
  m.alice.invoke = async (peerId, skillId, ...rest) => {
    calls.push({ peerId, skillId });
    return origInvoke(peerId, skillId, ...rest);
  };

  await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('oracle hello')]);

  const firstRelay = calls.find(c => c.skillId === 'relay-forward');
  assert(firstRelay?.peerId === m.pubKeys.bob,
    'first relay-forward targets bob — oracle picked correctly');

  const rc2 = m.received.carol.at(-1);
  assert(rc2?.text === 'oracle hello', 'carol got the oracle-routed text');

  // Expire the claim and confirm probe-retry fallback still works.
  const rec = await m.alice.peers.get(m.pubKeys.bob);
  rec.knownPeersTs = 0;
  await m.alice.peers.upsert(rec);

  m.received.carol.length = 0;
  await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('after expiry')]);
  assert(m.received.carol.at(-1)?.text === 'after expiry',
    'message still delivered via probe-retry after oracle expiry');

  // ── Phase 11 (BB) — blind relay-forward ──────────────────────────────────
  // Alice enables sealed-forward on a test group; routes a message to Carol
  // via Bob; we prove Bob's forwarded call went through relay-receive-sealed
  // and did NOT contain the plaintext text.
  console.log('\n— phase 11 (BB): blind relay-forward — bob cannot read content\n');

  m.received.carol.length = 0;
  m.bobOutbound.length = 0;
  m.alice.enableSealedForwardFor('home');

  await m.alice.invokeWithHop(
    m.pubKeys.carol, 'receive-message',
    [TextPart('sealed hi carol')],
    { group: 'home' },
  );

  assert(m.received.carol.at(-1)?.text === 'sealed hi carol',
    'carol got the sealed text');
  assert(m.received.carol.at(-1)?.originVerified === true,
    'carol verified the origin signature');
  const fwd = m.bobOutbound.find(e => e.peerId === m.pubKeys.carol);
  assert(fwd?.skillId === 'relay-receive-sealed',
    'bob forwarded via relay-receive-sealed, not the raw skill');
  assert(!fwd?.payload.includes('sealed hi carol'),
    'bob\'s forwarded payload did NOT contain the plaintext');

  await m.teardown();

  // ── Phase 12 (CC) — hop-aware task tunnel ────────────────────────────────
  // Rebuilds the mesh with tunneling enabled on Bob.  Alice calls a
  // streaming generator skill on Carol over the hop and consumes the
  // chunks as an async iterator — exactly the same API as a direct call.
  console.log('\n— phase 12 (CC): streaming + IR + cancel over a hop\n');
  const mt = await buildMesh({ log, tunnel: true });
  await gossipOnce(mt.alice, mt.pubKeys.bob);

  // 12a — streaming
  mt.carol.register('slow-count', async function* () {
    yield [TextPart('one')];
    yield [TextPart('two')];
    yield [TextPart('three')];
  });
  const tStream = mt.alice.callWithHop(mt.pubKeys.carol, 'slow-count', []);
  const chunks = [];
  for await (const c of tStream.stream()) chunks.push(Parts.text(c));
  const streamSnap = await tStream.done();
  assert(streamSnap.state === 'completed',  'streaming task completed');
  assert(chunks.join(',') === 'one,two,three',
    `alice received chunks in order (got: ${chunks.join(',')})`);

  // 12b — input-required round-trip
  mt.carol.register('ask-name', async ({ parts }) => {
    if (Parts.text(parts) === 'start') {
      throw new Task.InputRequired([TextPart('Name?')]);
    }
    return [TextPart(`hi ${Parts.text(parts)}`)];
  });
  const tIr = mt.alice.callWithHop(mt.pubKeys.carol, 'ask-name', [TextPart('start')]);
  const prompt = await new Promise(res => tIr.once('input-required', res));
  assert(Parts.text(prompt) === 'Name?', 'alice sees the IR prompt');
  await tIr.send([TextPart('demo')]);
  const irSnap = await tIr.done();
  assert(irSnap.state === 'completed', 'IR round-trip completes');
  assert(Parts.text(irSnap.parts) === 'hi demo', `alice got \"hi demo\" (got: ${Parts.text(irSnap.parts)})`);

  // 12c — cancel propagates
  let sawAbort = false;
  mt.carol.register('long-runner', async ({ signal }) => {
    await new Promise((_, reject) => {
      const id = setInterval(() => {
        if (signal?.aborted) { sawAbort = true; clearInterval(id); reject(new Error('aborted')); }
      }, 20);
    });
  });
  const tCancel = mt.alice.callWithHop(mt.pubKeys.carol, 'long-runner', []);
  await new Promise(r => setTimeout(r, 60));
  await tCancel.cancel();
  await new Promise(r => setTimeout(r, 120));
  assert(sawAbort, 'carol saw signal.aborted after alice cancelled');
  assert(tCancel.state === 'cancelled', 'alice-side task state is cancelled');

  await mt.teardown();

  // ── Phase 10 (AB) — rendezvous auto-upgrade ──────────────────────────────
  // Rebuilds the mesh with rendezvous enabled (requires node-datachannel
  // polyfill). If the polyfill isn't installed, we log a notice and skip —
  // phases 1-9 are the core demo; 10 is a bonus for showing WebRTC.
  let rtcLib = null;
  try {
    const mod = await import('node-datachannel/polyfill');
    rtcLib = {
      RTCPeerConnection:     mod.RTCPeerConnection,
      RTCSessionDescription: mod.RTCSessionDescription,
      RTCIceCandidate:       mod.RTCIceCandidate,
    };
  } catch {
    console.log('\n— phase 10 (AB): rendezvous — SKIPPED (node-datachannel/polyfill not installed)\n');
    console.log('  all phases passed.\n');
    return;
  }

  console.log('\n— phase 10 (AB): alice ↔ bob auto-upgrade to a WebRTC DataChannel\n');
  const m2 = await buildMesh({ log, rendezvous: true, rtcLib });
  const upgraded = new Promise(res => m2.alice.once('rendezvous-upgraded', res));
  await m2.alice.hello(m2.pubKeys.bob);
  const up = await Promise.race([
    upgraded,
    new Promise((_, rej) => setTimeout(() => rej(new Error('upgrade timeout')), 15_000)),
  ]);
  assert(up.peer === m2.pubKeys.bob, 'rendezvous-upgraded fired for bob');
  assert(m2.alice.isRendezvousActive(m2.pubKeys.bob), 'alice has an open DataChannel to bob');

  await m2.alice.invoke(m2.pubKeys.bob, 'receive-message', [TextPart('via DataChannel')]);
  assert(m2.received.bob.at(-1).text === 'via DataChannel', 'bob received the direct message');

  console.log('\n— phase 10b (AB): force-close the channel — next send falls back to relay\n');
  const downgraded = new Promise(res => m2.alice.once('rendezvous-downgraded', res));
  await m2.alice.getTransport('rendezvous').disconnect();
  await downgraded;
  assert(!m2.alice.isRendezvousActive(m2.pubKeys.bob), 'alice no longer has a DataChannel to bob');

  await m2.alice.invoke(m2.pubKeys.bob, 'receive-message', [TextPart('after downgrade')]);
  assert(m2.received.bob.at(-1).text === 'after downgrade', 'message still delivered via relay');

  await m2.teardown();

  console.log('\n  all phases passed.\n');

  // node-datachannel holds a native worker that can keep Node's event
  // loop alive after teardown. Explicitly release it and exit.
  try {
    const ndc = await import('node-datachannel');
    ndc.cleanup?.();
  } catch { /* optional dep not installed — we'd have returned earlier */ }
  process.exit(0);
}

main().catch(err => {
  console.error('\n  ✗ demo crashed:', err);
  process.exit(1);
});
