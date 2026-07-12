// J-security: adversarial breach attempts, each DEFENDED by the real machinery
// (the core PolicyEngine capability-token verifier + the nacl.box sealing) —
// forge, privilege-escalate, impersonate, steal, and read-others'-mail, all
// rejected. Mirrors the §7.1/§7.2/§7.4 breach suite, folded into the live matrix.
//
// HERMETIC: pure crypto + policy verification, no relay/pod. relayUrl is unused.
import { AgentIdentity, CapabilityToken, PolicyEngine, TrustRegistry, SkillRegistry } from '@canopy/core';
import { VaultMemory }                     from '@canopy/vault';
import { seal, open, generateKeypair }     from '@canopy/pod-client/sealing';
import { checker }                         from './_util.mjs';

export const name = 'J-security (adversarial: forgery / theft / confidentiality)';

/** Victim (issuer, trusted) + a legitimate subject + an attacker peer, behind a real PolicyEngine. */
async function makeVerifier(skillId = 'vault.read') {
  const idV        = await AgentIdentity.generate(new VaultMemory());  // victim / issuer
  const idSubject  = await AgentIdentity.generate(new VaultMemory());  // legitimate token holder
  const idAttacker = await AgentIdentity.generate(new VaultMemory());  // thief / forger
  const trust  = new TrustRegistry(new VaultMemory());
  const skills = new SkillRegistry();
  skills.register(skillId, async () => [], { visibility: 'authenticated', policy: 'requires-token' });
  const pe = new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: idV.pubKey });
  await trust.setTier(idSubject.pubKey,  'authenticated');
  await trust.setTier(idAttacker.pubKey, 'authenticated');
  await trust.setTier(idV.pubKey,        'trusted');
  return { idV, idSubject, idAttacker, pe, skillId };
}

const denial = async (p) => { try { await p; return null; } catch (e) { return e?.code ?? `THREW:${e?.name}`; } };

export async function run() {
  const { results, check } = checker();
  const { idV, idSubject, idAttacker, pe, skillId } = await makeVerifier();
  const mk = (issuer, over = {}) => CapabilityToken.issue(issuer, { subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000, ...over });
  const present = (peerPubKey, token) => pe.checkInbound({ peerPubKey, skillId, token });

  // CONTROL — isolate the attack variable: a legit token must be accepted.
  const legit = await present(idSubject.pubKey, (await mk(idV)).toJSON());
  check('CONTROL: a legitimate capability token is accepted', legit.allowed === true);

  // FORGE — a tampered signature is rejected.
  const tampered = (await mk(idV)).toJSON();
  tampered.sig = tampered.sig.slice(0, -2) + (tampered.sig.endsWith('A') ? 'BB' : 'AA');
  check('forged token (tampered signature) REJECTED', (await denial(present(idSubject.pubKey, tampered))) === 'INVALID_TOKEN');

  // FORGE — privileges escalated AFTER signing (skill widened to '*') is rejected.
  const escalated = { ...(await mk(idV)).toJSON(), skill: '*' };
  check('privilege-escalated token (skill → *) REJECTED', (await denial(present(idSubject.pubKey, escalated))) === 'INVALID_TOKEN');

  // FORGE — an unknown key claiming to be the victim's issuer is rejected.
  const impersonated = { ...(await mk(idAttacker)).toJSON(), issuer: idV.pubKey };
  check('impersonated issuer (unknown key claiming the victim) REJECTED', (await denial(present(idSubject.pubKey, impersonated))) === 'INVALID_TOKEN');

  // STEAL — a valid token, presented BY a different peer, is rejected (subject-binding).
  const stolen = (await mk(idV)).toJSON();
  check('stolen token presented by a DIFFERENT peer REJECTED (subject-binding)', (await denial(present(idAttacker.pubKey, stolen))) === 'INVALID_TOKEN');

  // …but the SAME token still works for its rightful subject (targeted, not a blanket break).
  const rightful = await present(idSubject.pubKey, stolen);
  check('the same token still works for its rightful subject (targeted, not blanket)', rightful.allowed === true);

  // CONFIDENTIALITY — a non-addressed peer cannot open sealed content, and the
  // ciphertext leaks no plaintext.
  const bob = generateKeypair(), eve = generateKeypair();
  const secret = 'de kluis-code is 4931';
  const sealed = seal(secret, [bob.publicKey]);
  let eveOpened; try { eveOpened = open(sealed, eve.privateKey); } catch { eveOpened = null; }
  check('sealed content: a non-addressed peer CANNOT open it', eveOpened !== secret);
  check('sealed ciphertext carries no plaintext of the secret', !JSON.stringify(sealed).includes('4931') && !JSON.stringify(sealed).includes('kluis'));

  // …and the rightful recipient DOES open it (isolates: the deny above is real, not a broken seal).
  let bobOpened; try { bobOpened = open(sealed, bob.privateKey); } catch { bobOpened = null; }
  check('the addressed recipient opens it (deny is real, not a broken seal)', bobOpened === secret);

  return results;
}
