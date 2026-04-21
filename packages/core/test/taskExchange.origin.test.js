/**
 * Origin attribution at the callSkill / handleTaskRequest seam (Group Z3).
 *
 * Unit tests for the path between two agents — no relay/hop logic here.
 * We drive the three origin fields (`_origin`, `_originSig`, `_originTs`)
 * directly via the low-level `opts.origin*` parameters that `relay-forward`
 * would normally set, and assert:
 *
 *   • valid sig  → ctx.originFrom === signer,  originVerified: true
 *   • missing sig → ctx.originFrom === envelope._from, verified: false,
 *     NO security-warning (pre-Z compat path)
 *   • bad sig / stale ts / wrong target → fallback + security-warning
 *
 * Ref: Design-v3/origin-signature.md §5 / CODING-PLAN.md Z3.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                           from '../src/Agent.js';
import { AgentIdentity }                   from '../src/identity/AgentIdentity.js';
import { VaultMemory }                     from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }  from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts }       from '../src/Parts.js';
import { signOrigin }                      from '../src/security/originSignature.js';
import { canonicalize }                    from '../src/Envelope.js';

async function pair() {
  const bus     = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());

  const alice = new Agent({
    identity:  aliceId,
    transport: new InternalTransport(bus, aliceId.pubKey, { identity: aliceId }),
  });
  const bob   = new Agent({
    identity:  bobId,
    transport: new InternalTransport(bus, bobId.pubKey, { identity: bobId }),
  });

  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer  (alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  const received = [];
  const warnings = [];
  bob.register('receive-message', async (ctx) => {
    received.push({
      parts:          ctx.parts,
      from:           ctx.from,
      originFrom:     ctx.originFrom,
      originVerified: ctx.originVerified,
      relayedBy:      ctx.relayedBy,
    });
    return [DataPart({ ack: true })];
  }, { visibility: 'public' });
  bob.on('security-warning', w => warnings.push(w));

  return { alice, bob, received, warnings };
}

// Alice would normally be the real origin in a hopped message. For these
// unit tests we simulate the relay by having Alice *directly* invoke Bob
// while passing the originSig we pre-computed with a third identity's key
// ("carol") — that way we can drive valid / invalid combos without
// standing up a full three-agent mesh.
async function carol() {
  return AgentIdentity.generate(new VaultMemory());
}

describe('callSkill + handleTaskRequest — origin signature (Z3)', () => {

  it('valid sig → ctx.originFrom = signer, originVerified = true, no warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    const carolId = await carol();
    const parts   = [TextPart('hello from carol')];

    const { sig, originTs } = signOrigin(carolId, {
      target: bob.pubKey,
      skill:  'receive-message',
      parts,
    });

    await alice.invoke(bob.address, 'receive-message', parts, {
      origin:    carolId.pubKey,
      originSig: sig,
      originTs,
    });

    expect(received).toHaveLength(1);
    expect(received[0].originFrom).toBe(carolId.pubKey);
    expect(received[0].originVerified).toBe(true);
    expect(received[0].relayedBy).toBe(alice.pubKey);
    expect(warnings).toHaveLength(0);

    await alice.stop(); await bob.stop();
  });

  it('missing sig → fallback to envelope._from, verified = false, NO warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    const carolId = await carol();
    const parts   = [TextPart('pre-Z traffic')];

    // _origin present, but no sig/ts — pre-Z client.
    await alice.invoke(bob.address, 'receive-message', parts, {
      origin: carolId.pubKey,
    });

    expect(received).toHaveLength(1);
    expect(received[0].originFrom).toBe(alice.pubKey);
    expect(received[0].originVerified).toBe(false);
    expect(warnings).toHaveLength(0);

    await alice.stop(); await bob.stop();
  });

  it('tampered parts → fallback + security-warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    const carolId = await carol();

    // Sign over the original parts…
    const signedParts = [TextPart('original')];
    const { sig, originTs } = signOrigin(carolId, {
      target: bob.pubKey,
      skill:  'receive-message',
      parts:  signedParts,
    });

    // …but send different parts.
    await alice.invoke(bob.address, 'receive-message', [TextPart('TAMPERED')], {
      origin:    carolId.pubKey,
      originSig: sig,
      originTs,
    });

    expect(received[0].originFrom).toBe(alice.pubKey);
    expect(received[0].originVerified).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('origin-signature');
    expect(warnings[0].reason).toMatch(/bad signature/);

    await alice.stop(); await bob.stop();
  });

  it('stale ts (past window) → fallback + security-warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    const carolId = await carol();
    const parts   = [TextPart('old')];

    // Sign with a timestamp 20 min in the past (window is 10 min).
    const staleTs = Date.now() - 20 * 60_000;
    const { sig } = signOrigin(carolId, {
      target: bob.pubKey,
      skill:  'receive-message',
      parts,
      ts:     staleTs,
    });

    await alice.invoke(bob.address, 'receive-message', parts, {
      origin:    carolId.pubKey,
      originSig: sig,
      originTs:  staleTs,
    });

    expect(received[0].originVerified).toBe(false);
    expect(warnings[0].reason).toMatch(/outside.*window/);

    await alice.stop(); await bob.stop();
  });

  it('wrong signer (sig key ≠ _origin) → fallback + security-warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    const carolId = await carol();
    const daveId  = await carol();       // another random identity
    const parts   = [TextPart('forged')];

    // Dave signs, but we claim carol as the origin.
    const { sig, originTs } = signOrigin(daveId, {
      target: bob.pubKey,
      skill:  'receive-message',
      parts,
    });

    await alice.invoke(bob.address, 'receive-message', parts, {
      origin:    carolId.pubKey,     // claim carol
      originSig: sig,                // actually signed by dave
      originTs,
    });

    expect(received[0].originVerified).toBe(false);
    expect(received[0].originFrom).toBe(alice.pubKey);
    expect(warnings[0].reason).toMatch(/bad signature/);

    await alice.stop(); await bob.stop();
  });

  it('no _origin at all → originFrom = envelope._from, no warning', async () => {
    const { alice, bob, received, warnings } = await pair();
    await alice.invoke(bob.address, 'receive-message', [TextPart('direct')]);

    expect(received[0].originFrom).toBe(alice.pubKey);
    expect(received[0].originVerified).toBe(false);
    expect(received[0].relayedBy).toBe(null);
    expect(warnings).toHaveLength(0);

    await alice.stop(); await bob.stop();
  });
});
