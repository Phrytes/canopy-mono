// J-manage: the companion-node management surface (6d), surface ① — the OWNER
// manages the node by invoking owner-gated ops OVER THE RELAY (exactly how
// canopy-chat would); a non-owner is denied. This is the manifest half of the
// "one contract, two projectors" design (plans/NOTE-companion-node-management.md).
import { Agent, AgentIdentity, Parts, DataPart } from '@canopy/core';
import { VaultMemory }        from '@canopy/vault';
import { RelayTransport }     from '@canopy/transports';
import { startCompanionNode } from '../../companion-node/src/index.js';
import { rm }     from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { wait, checker } from './_util.mjs';

export const name = 'J-manage (companion-node management surface)';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const cfg = join(tmpdir(), `e2e-manage-${process.pid}-${Math.floor(Math.random() * 1e6)}`);

  const ownerId    = await AgentIdentity.generate(new VaultMemory());   // the node's owner (phone role)
  const attackerId = await AgentIdentity.generate(new VaultMemory());   // a non-owner peer
  const owner    = new Agent({ identity: ownerId,    transport: new RelayTransport({ relayUrl, identity: ownerId }) });
  const attacker = new Agent({ identity: attackerId, transport: new RelayTransport({ relayUrl, identity: attackerId }) });

  const node = await startCompanionNode({
    relayUrl, configDir: cfg, gate: false,
    inbox: true, inboxOwnerPubKey: owner.address,           // a real tenant to report
    management: true, managementOwnerPubKey: owner.address, // owner-gated management
  });
  const C = node.agent.address;
  owner.addPeer(C, C);    node.agent.addPeer(owner.address, owner.address);
  attacker.addPeer(C, C); node.agent.addPeer(attacker.address, attacker.address);
  const invoke = async (from, op, data) => Parts.data(await from.invoke(C, op, [DataPart(data ?? {})], { timeout: 9000 }));

  try {
    await owner.start(); await attacker.start(); await wait(1800);
    check('owner + non-owner + node on the relay',
      owner.transport.connected && attacker.transport.connected && node.agent.transport.connected);

    // Owner manages over the relay (the canopy-chat path).
    const status = await invoke(owner, 'node.status', {});
    check('owner reads node.status over the relay', status?.ok === true && status.connected === true && typeof status.uptimeMs === 'number');

    const tenants = await invoke(owner, 'node.listTenants', {});
    const sealed = (tenants?.tenants ?? []).find((t) => t.id === 'sealed-inbox');
    check('owner lists tenants (sealed-inbox reported ON)', tenants?.ok === true && sealed?.on === true);

    // A non-owner is DENIED, deny-by-default.
    const bad = await invoke(attacker, 'node.status', {});
    check('a NON-owner is denied node.status (owner-gated)', bad?.ok === false && bad?.error === 'forbidden');

    const badRevoke = await invoke(attacker, 'grant.revoke', { tokenId: 'anything' });
    check('a NON-owner is denied grant.revoke (owner-gated)', badRevoke?.ok === false && badRevoke?.error === 'forbidden');

    // The owner CAN reach grant.revoke (validates input; gate is off here so no ledger).
    const ownerRevoke = await invoke(owner, 'grant.revoke', {});
    check('owner reaches grant.revoke (reachable + validates)', ownerRevoke?.ok === false && ownerRevoke?.error === 'tokenId required');
  } finally {
    await owner.transport.disconnect().catch(() => {});
    await attacker.transport.disconnect().catch(() => {});
    await node.stop?.().catch?.(() => {});
    await rm(cfg, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}
