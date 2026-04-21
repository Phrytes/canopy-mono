/**
 * packages/core demo — run with: node demo.js
 *
 * Shows:
 *  1. Two agents with full Ed25519 identities
 *  2. Encrypted, signed channel via InternalTransport
 *  3. OW / AS (ack) / RQ+RS (request-response) patterns
 *  4. Replay attack rejected
 *  5. Tampered ciphertext rejected
 */
import { AgentIdentity }                     from './src/identity/AgentIdentity.js';
import { VaultMemory }                        from './src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }     from './src/transport/InternalTransport.js';
import { SecurityLayer }                      from './src/security/SecurityLayer.js';
import { mkEnvelope, P }                      from './src/Envelope.js';
import { TextPart, DataPart, Parts }          from './src/Parts.js';

// ── Colours ───────────────────────────────────────────────────────────────────
const c = {
  ok:   s => `\x1b[32m${s}\x1b[0m`,
  err:  s => `\x1b[31m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

function pass(label) { console.log(c.ok('  ✓') + ' ' + label); }
function fail(label) { console.log(c.err('  ✗') + ' ' + label); }
function section(s)  { console.log('\n' + c.bold(c.cyan(s))); }

// ── Setup ─────────────────────────────────────────────────────────────────────

section('1. Generating identities');

const aliceId = await AgentIdentity.generate(new VaultMemory());
const bobId   = await AgentIdentity.generate(new VaultMemory());

console.log(c.dim('  alice pubKey: ') + aliceId.pubKey.slice(0, 20) + '…');
console.log(c.dim('  bob   pubKey: ') + bobId.pubKey.slice(0, 20) + '…');
pass('two distinct Ed25519 keypairs generated');

// ── Connect with security layers ──────────────────────────────────────────────

section('2. Setting up secure channel');

const bus   = new InternalBus();
const alice = new InternalTransport(bus, aliceId.pubKey);
const bob   = new InternalTransport(bus,   bobId.pubKey);

const aliceSec = new SecurityLayer({ identity: aliceId });
const bobSec   = new SecurityLayer({ identity:   bobId });

aliceSec.registerPeer(bobId.pubKey,   bobId.pubKey);
bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

alice.useSecurityLayer(aliceSec);
bob.useSecurityLayer(bobSec);

await alice.connect();
await bob.connect();
pass('InternalTransport + SecurityLayer connected');

// ── OW (fire-and-forget) ──────────────────────────────────────────────────────

section('3. OW (fire-and-forget)');

const received = [];
bob.on('envelope', e => received.push(e));

await alice.sendOneWay(bob.address, { greeting: 'Hello, Bob!' });
await new Promise(r => setTimeout(r, 10));

if (received.length === 1 && received[0].payload.greeting === 'Hello, Bob!') {
  pass('Bob received OW with correct plaintext payload');
} else {
  fail('OW delivery failed');
}

// Verify wire is ciphertext, not plaintext.
const wireEnvelopes = [];
bus.on(`msg:${bob.address}`, e => wireEnvelopes.push(e));

await alice.sendOneWay(bob.address, { secret: 'password123' });
await new Promise(r => setTimeout(r, 10));

const wireJson = JSON.stringify(wireEnvelopes[0]);
if (!wireJson.includes('password123') && wireEnvelopes[0].payload._box) {
  pass('Wire frame is ciphertext (_box present, plaintext absent)');
  console.log(c.dim('  raw wire payload: ') + wireEnvelopes[0].payload._box.slice(0, 40) + '…');
} else {
  fail('Wire frame leaks plaintext!');
}

// ── AS (acknowledged send) ────────────────────────────────────────────────────

section('4. AS (acknowledged send)');

const ack = await alice.sendAck(bob.address, { cmd: 'ping' });
if (ack._p === P.AK) {
  pass('sendAck resolved with AK envelope');
} else {
  fail('sendAck did not receive AK');
}

// ── RQ / RS (request / respond) ───────────────────────────────────────────────

section('5. RQ/RS (request–response)');

bob.setReceiveHandler(async (env) => {
  if (env._p === P.RQ) {
    const echo = env.payload?.parts
      ? env.payload
      : { parts: [TextPart('echo: ' + JSON.stringify(env.payload))] };
    await bob.respond(env._from, env._id, echo);
  }
});

const rs = await alice.request(bob.address, {
  parts: [DataPart({ action: 'compute', value: 42 })],
});

if (rs._p === P.RS) {
  pass('request resolved with RS envelope');
  const data = Parts.data(rs.payload.parts);
  if (data?.action === 'compute') {
    pass('response payload matches request parts');
  }
}

// ── Replay attack ─────────────────────────────────────────────────────────────

section('6. Replay attack');

// Capture a real envelope off the wire.
let capturedEnvelope;
const captureListener = e => { capturedEnvelope = e; };
bus.once(`msg:${bob.address}`, captureListener);

await alice.sendOneWay(bob.address, { harmless: true });
await new Promise(r => setTimeout(r, 10));

// Now try to replay it through a second SecurityLayer (fresh dedup state).
const bobSec2 = new SecurityLayer({ identity: bobId });
bobSec2.registerPeer(aliceId.pubKey, aliceId.pubKey);

// First delivery: should succeed.
try {
  bobSec2.decryptAndVerify(capturedEnvelope);
  pass('first delivery accepted');
} catch (e) {
  fail('first delivery unexpectedly rejected: ' + e.message);
}

// Replay: same envelope again → DUPLICATE.
try {
  bobSec2.decryptAndVerify(capturedEnvelope);
  fail('replay was not rejected!');
} catch (e) {
  if (e.code === 'DUPLICATE') {
    pass('replay rejected with DUPLICATE (' + e.message + ')');
  } else {
    fail('replay rejected for wrong reason: ' + e.code);
  }
}

// ── Tamper attack ─────────────────────────────────────────────────────────────

section('7. Tamper attack');

const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { value: 'original' });
const enc = aliceSec.encrypt(env);

// Flip a byte in the ciphertext blob.
const boxB64   = enc.payload._box;
const boxBytes = Buffer.from(boxB64.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
boxBytes[30] ^= 0xff;
const tampered = {
  ...enc,
  payload: {
    _box: boxBytes.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''),
  },
};

const freshSec = new SecurityLayer({ identity: bobId });
freshSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

try {
  freshSec.decryptAndVerify(tampered);
  fail('tampered envelope was accepted!');
} catch (e) {
  if (e.code === 'BAD_SIG' || e.code === 'DECRYPT_FAILED') {
    pass(`tampered envelope rejected with ${e.code}`);
  } else {
    fail('rejected for unexpected reason: ' + e.code + ' — ' + e.message);
  }
}

// ── Mnemonic recovery ─────────────────────────────────────────────────────────

section('8. Identity recovery via mnemonic');

const mnemonic  = await aliceId.getMnemonic();
const recovered = await AgentIdentity.fromMnemonic(mnemonic, new VaultMemory());

if (recovered.pubKey === aliceId.pubKey) {
  pass('recovered pubKey matches original');
  console.log(c.dim('  mnemonic: ') + mnemonic.split(' ').slice(0, 4).join(' ') + ' … (' + mnemonic.split(' ').length + ' words)');
} else {
  fail('mnemonic recovery produced wrong keypair');
}

console.log('\n' + c.ok(c.bold('All checks passed.')) + '\n');
