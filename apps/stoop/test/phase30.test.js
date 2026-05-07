/**
 * Stoop V2 — Phase 30 tests.
 *
 *   30.1  validateMnemonicPhrase: valid mnemonic returns ok + pubKey;
 *         invalid returns error
 *   30.1  restoreFromMnemonic: writes seed to vault; returns new pubKey;
 *         requires confirm: true; clears stableId so the next restart
 *         issues a fresh one
 *   30.4  end-to-end: a fresh bundle booting from a vault that was
 *         written by restoreFromMnemonic uses the mnemonic's keypair
 */

import { describe, it, expect } from 'vitest';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  DataPart,
  generateMnemonic,
  mnemonicToSeed,
} from '@canopy/core';
import nacl from 'tweetnacl';

import { createNeighborhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle(vault) {
  const id = vault
    ? await AgentIdentity.generate(vault)
    : await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.skillMatch.start();
  return { bundle, id };
}

function pubKeyFromMnemonic(mnemonic) {
  const seed = mnemonicToSeed(mnemonic);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return Buffer.from(kp.publicKey).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('Stoop V2 Phase 30.1 — validateMnemonicPhrase', () => {
  it('valid mnemonic returns ok + pubKey matching Bootstrap-derived key', async () => {
    const { bundle } = await buildBundle();
    const phrase = generateMnemonic();
    const r = await callSkill(bundle.agent, 'validateMnemonicPhrase', { mnemonic: phrase });
    expect(r.ok).toBe(true);
    expect(r.pubKey).toBe(pubKeyFromMnemonic(phrase));
  });

  it('invalid mnemonic rejected', async () => {
    const { bundle } = await buildBundle();
    const r = await callSkill(bundle.agent, 'validateMnemonicPhrase',
      { mnemonic: 'not a valid bip39 phrase at all here' });
    expect(r.error).toBe('invalid-mnemonic');
  });

  it('empty rejected', async () => {
    const { bundle } = await buildBundle();
    expect(await callSkill(bundle.agent, 'validateMnemonicPhrase', {}))
      .toEqual({ error: 'mnemonic required' });
  });
});

describe('Stoop V2 Phase 30.1 — restoreFromMnemonic', () => {
  it('requires confirm: true', async () => {
    const { bundle } = await buildBundle();
    const phrase = generateMnemonic();
    expect(await callSkill(bundle.agent, 'restoreFromMnemonic', { mnemonic: phrase }))
      .toEqual({ error: 'confirm: true required (destructive op)' });
  });

  it('rejects invalid mnemonic even with confirm', async () => {
    const { bundle } = await buildBundle();
    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: 'garbage', confirm: true });
    expect(r.error).toBe('invalid-mnemonic');
  });

  it('writes seed to vault + clears stableId; returns the new pubKey', async () => {
    const vault = new VaultMemory();
    const { bundle } = await buildBundle(vault);
    const phrase = generateMnemonic();

    // Sanity: vault has an existing seed before restore.
    const beforeKey = await vault.get('agent-privkey');
    expect(beforeKey).toBeTruthy();

    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });
    expect(r.ok).toBe(true);
    expect(r.newPubKey).toBe(pubKeyFromMnemonic(phrase));

    // Vault carries the new mnemonic-derived seed; stableId is cleared.
    const afterKey = await vault.get('agent-privkey');
    expect(afterKey).toBeTruthy();
    expect(afterKey).not.toBe(beforeKey);
    const afterStableId = await vault.get('agent-stable-id');
    expect(afterStableId).toBeFalsy();   // cleared (or undefined)
  });
});

describe('Stoop V2 Phase 30.4 — restored bundle adopts the mnemonic identity', () => {
  it('a fresh bundle constructed from the post-restore vault uses the mnemonic\'s keypair', async () => {
    // 1. Original bundle.
    const vault = new VaultMemory();
    const { bundle } = await buildBundle(vault);
    const phrase = generateMnemonic();
    await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });

    // 2. Fresh AgentIdentity from the same vault — should adopt the
    //    mnemonic-derived keypair (AgentIdentity.restore reads
    //    `agent-privkey` from the vault).
    const restoredId = await AgentIdentity.restore(vault);
    expect(restoredId.pubKey).toBe(pubKeyFromMnemonic(phrase));

    // 3. New stableId issued on first read post-restore (clearing
    //    is intentional in V2; V2.5 will derive deterministic).
    expect(restoredId.stableId).toBeTruthy();
    expect(typeof restoredId.stableId).toBe('string');
  });
});
