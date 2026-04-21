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

  await m.teardown();

  console.log('\n  all phases passed.\n');
}

main().catch(err => {
  console.error('\n  ✗ demo crashed:', err);
  process.exit(1);
});
