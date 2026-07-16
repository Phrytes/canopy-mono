// controlAgent.js — the household control-agent. Applies pod ACL grant/revoke AND group-key rotation
// TOGETHER on membership events, so "join the circle → get pod access; leave → lose it" is one operation
// no human need be online for. Wraps `sharing` (ACL, packages/pod-client/src/sharing) + the versioned key
// resources (groupKeyResource.js). The agent is itself a key-holder (a recipient of every key resource),
// so it can always unwrap to re-wrap on grant.
//
// Invariants:
//   • at least one ADMIN always remains — removing the last admin throws (unless `force`);
//   • the pod OWNER is break-glass — a `force` removal bypasses the admin guard (they hold the pod anyway).
//
// Pure orchestration: pod I/O is injected — `sharing.grant/revoke`, and a `keyStore` {read,write} that
// persists the key resource to the pod (e.g. /.keys/group-vN.json via a SealedPodClient or PodClient).

import { grantMember, rotateGroupKeyResource, buildGroupKeyResource, banFromHistory } from './groupKeyResource.js';
import { generateGroupKey } from './envelope.js';

function normalizeMember(m) {
  if (!m || !m.webId || !m.publicKey) throw new Error('control-agent: member needs { webId, publicKey }');
  return { webId: String(m.webId), publicKey: String(m.publicKey), role: m.role === 'admin' ? 'admin' : 'member' };
}

/**
 * Create the household control-agent: applies pod ACL grant/revoke AND group-key rotation together
 * on membership events, so join/leave is a single operation. Enforces that at least one admin
 * remains (`force` bypasses); pure orchestration — pod I/O is injected via `sharing` + `keyStore`.
 *
 * @param {object} a
 * @param {{ grant: Function, revoke: Function }} a.sharing       ACL grant/revoke (createClientSharing)
 * @param {string} a.containerUri                                 the circle's shared container
 * @param {{ read: () => any, write: (res:any) => any }} a.keyStore  reads/writes the key resource on the pod
 * @param {{ publicKey: string, privateKey: string }} a.controllerKey  the agent's own keypair (always a recipient)
 * @param {string[]} [a.modes]                                    ACL modes granted to members (default read+write)
 * @param {Array<{webId,publicKey,role}>} [a.roster]             initial member roster
 */
export function createControlAgent({ sharing, containerUri, keyStore, controllerKey, modes = ['read', 'write'], roster = [], revokeMeshProof = null }) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.revoke !== 'function') {
    throw new Error('createControlAgent: sharing with grant/revoke required');
  }
  if (!keyStore || typeof keyStore.read !== 'function' || typeof keyStore.write !== 'function') {
    throw new Error('createControlAgent: keyStore with read/write required');
  }
  if (!controllerKey || !controllerKey.publicKey || !controllerKey.privateKey) {
    throw new Error('createControlAgent: controllerKey { publicKey, privateKey } required');
  }
  let members = roster.map(normalizeMember);
  const recipientsWithController = (pubs) => [...new Set([...pubs, controllerKey.publicKey])];

  /** Build the initial key resource for the current roster (idempotent — no-op if one exists). */
  async function bootstrap() {
    if (await keyStore.read()) return null;
    const pubs = recipientsWithController(members.map((m) => m.publicKey));
    const res = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: pubs });
    await keyStore.write(res);
    return res;
  }

  return {
    members: () => members.slice(),
    bootstrap,

    /** Join: grant ACL + add the member to the group key (O(1) re-wrap, or bootstrap the first key). */
    async addMember({ webId, publicKey, role = 'member' }) {
      const m = normalizeMember({ webId, publicKey, role });
      // Idempotent: a member already holding the group key (same sealing public key) is a
      // no-op — no re-grant, no re-wrap, no roster duplication. Re-wrapping the SAME key to
      // the SAME recipient set would be harmless (same version, same group key) but would
      // duplicate the roster entry and churn the resource; skipping keeps "provision only
      // when the member set actually changed".
      if (members.some((x) => x.publicKey === m.publicKey)) {
        return { keyResource: await keyStore.read(), members: members.slice() };
      }
      await sharing.grant({ containerUri, agent: m.webId, modes });
      const cur = await keyStore.read();
      const currentPubs = recipientsWithController(members.map((x) => x.publicKey));
      const next = cur
        ? grantMember(cur, { newRecipient: m.publicKey, granterPrivateKey: controllerKey.privateKey, currentRecipients: currentPubs })
        : buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [...currentPubs, m.publicKey] });
      await keyStore.write(next);
      members = [...members, m];
      return { keyResource: next, members: members.slice() };
    },

    /**
     * Leave / remove — enforce ≥1 admin, revoke ACL + rotate the group key (forward secrecy) + revoke the
     * departed's MESH PROOF (the coupling fix: removal is complete, not just content-key rotation).
     *
     * `policy`:
     *   • `'graceful'` (default) — a normal leave/removal. Forward secrecy (no new content/mesh), but retained
     *     `history[]` is left intact, so the departed keeps access to content they ALREADY had (on their device).
     *   • `'ban'` — maximal revocation (intruder/hostile). Additionally re-seals `history[]` to EXCLUDE the
     *     departed, so no server-fetchable old key remains for them. (Content they already downloaded can't be
     *     clawed back — no system can — but everything the pod holds is denied.)
     */
    async removeMember({ webId, force = false, policy = 'graceful' }) {
      const target = members.find((x) => x.webId === String(webId));
      if (!target) return { keyResource: await keyStore.read(), members: members.slice(), removed: false };
      const adminCount = members.filter((x) => x.role === 'admin').length;
      if (!force && target.role === 'admin' && adminCount <= 1) {
        throw new Error('control-agent: cannot remove the last admin (≥1-admin invariant)');
      }
      await sharing.revoke({ containerUri, agent: target.webId, modes });
      const remaining = members.filter((x) => x.webId !== target.webId);
      const cur = await keyStore.read();
      let next = rotateGroupKeyResource({
        previous: cur,
        recipients: recipientsWithController(remaining.map((x) => x.publicKey)),
      });
      if (policy === 'ban') {
        next = banFromHistory(next, { excludePubKey: target.publicKey, controllerPrivateKey: controllerKey.privateKey });
      }
      await keyStore.write(next);
      members = remaining;
      // ── Coupling: revoke the departed's mesh membership proof too (both policies). Best-effort:
      //    a failure is surfaced in the return, never silently swallowed and never left partial-then-thrown.
      let proofRevoked = false;
      if (typeof revokeMeshProof === 'function') {
        try { await revokeMeshProof(target); proofRevoked = true; }
        catch { proofRevoked = false; }
      }
      return { keyResource: next, members: members.slice(), removed: true, policy, banned: policy === 'ban', proofRevoked };
    },
  };
}
