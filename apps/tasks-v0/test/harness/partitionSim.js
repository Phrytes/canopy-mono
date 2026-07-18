/**
 * partitionSim — a reusable in-process partition-simulation harness for the
 * task-claiming-under-partition journey (PLAN-task-claim-partition) and later
 * journeys (J-offline / J-security) that need "split the mesh, both sides
 * work, reconverge, drain".
 *
 * WHAT IT SIMULATES
 *   N real `AgentIdentity`s, each running a real tasks-v0 circle bundle
 *   (`createCircleAgent`) over a real in-process transport, all sharing one
 *   `InternalBus` and one task substrate (circleId). This is the same wiring
 *   the existing `v2-substrate-mirror.test.js` proves, plus a controllable
 *   PARTITION seam:
 *     - `partition([...webids], [...webids])` drops cross-half envelope
 *       delivery (buffering blocked envelopes), so each half evolves
 *       independently — the "circle splits" case.
 *     - `reconverge()` heals the split and FLUSHES every buffered envelope
 *       (drains the offline/write-through queue), replaying the two halves'
 *       writes at each other — the "merge" case.
 *
 * WHY IN-PROCESS (not docker / not a live relay): the substrate logic under
 * test — the tasks mirror's claim-conflict guard + `ItemStore` — is
 * transport-agnostic. An in-process bus makes the partition deterministic
 * (no network flakiness), reuses `createCircleAgent` verbatim, and matches the
 * repo's existing mirror e2e pattern. docker-compose is for later live-stack
 * journeys.
 *
 * TOPOLOGIES
 *   - `p2p` (default): pseudo-pod-only mesh — no shared serialization point.
 *     This is where the silent-last-writer-wins bug lived and where the
 *     claim-conflict guard is proven.
 *   - central-pod one-winner (etag-CAS) is exercised separately at the
 *     `ItemStore` seam via `makeCasPodSource()` below (a shared conditional-
 *     write DataSource = "the pod"); see `claim-cas.test.js`.
 */

import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleAgent } from '../../src/Circle.js';
import { buildBundle } from '../../src/storage/buildBundle.js';

// ── Partition control ───────────────────────────────────────────────────────

/**
 * Shared policy consulted by every PartitionableTransport before delivery.
 * Addresses are transport addresses (agent pubKeys).
 */
export class PartitionController {
  /** @type {Array<Set<string>>|null} */ #groups = null;
  /** @type {Array<() => void>} */       #buffered = [];

  /** Split the mesh: each argument is a group of addresses; cross-group
   *  delivery is dropped (buffered) until `heal()`. */
  partition(...groups) {
    this.#groups = groups.map((g) => new Set(g));
  }

  /** Heal the split and flush every buffered cross-group envelope. */
  heal() {
    this.#groups = null;
    const pending = this.#buffered;
    this.#buffered = [];
    for (const deliver of pending) { try { deliver(); } catch { /* best-effort */ } }
  }

  get partitioned() { return this.#groups != null; }

  isBlocked(from, to) {
    if (!this.#groups) return false;
    const gf = this.#groups.find((g) => g.has(from));
    const gt = this.#groups.find((g) => g.has(to));
    if (!gf || !gt) return false;     // unpartitioned address → always reachable
    return gf !== gt;
  }

  buffer(deliver) { this.#buffered.push(deliver); }
}

/** InternalTransport that gates `_put` through a PartitionController. */
export class PartitionableTransport extends InternalTransport {
  #controller;
  constructor(bus, address, controller, opts = {}) {
    super(bus, address, opts);
    this.#controller = controller;
  }
  async _put(to, envelope) {
    if (this.#controller.isBlocked(this.address, to)) {
      // Cross-partition: buffer for replay on reconverge (the drain).
      this.#controller.buffer(() => { this.bus.emit(`msg:${to}`, envelope); });
      return;
    }
    await Promise.resolve();          // preserve async microtask delivery
    this.bus.emit(`msg:${to}`, envelope);
  }
}

// ── DataPart skill invocation (mirrors the existing mirror test) ─────────────

export async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// ── The harness ─────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.circleId
 * @param {Array<{webid:string, role?:string}>} opts.members
 * @returns {Promise<object>} the sim controls
 */
export async function createPartitionSim({ circleId, members }) {
  const bus = new InternalBus();
  const controller = new PartitionController();

  const circleConfig = {
    circleId,
    name: circleId,
    kind: 'project',
    members: members.map((m) => ({ webid: m.webid, role: m.role ?? 'member' })),
  };

  /** @type {Map<string, {webid, id, bundle}>} */
  const byWebid = new Map();

  for (const m of members) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const transport = new PartitionableTransport(bus, id.pubKey, controller);
    const bundle = await createCircleAgent({
      circleConfig,
      localStoreBundle: buildBundle(),
      identity: id,
      transport,
      label: m.webid,
    });
    byWebid.set(m.webid, { webid: m.webid, id, bundle });
  }

  // Full mesh: cross-register pubKeys at the SecurityLayer + seed each
  // mirror's recipient roster with every peer.
  const nodes = [...byWebid.values()];
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b) continue;
      a.bundle.agent.addPeer(b.id.pubKey, b.id.pubKey);
      await a.bundle.tasksMirror?.addPeer(b.id.pubKey);
    }
  }

  const bundleOf = (webid) => {
    const n = byWebid.get(webid);
    if (!n) throw new Error(`partitionSim: unknown member ${webid}`);
    return n.bundle;
  };
  const addrOf = (webid) => byWebid.get(webid).id.pubKey;

  return {
    bus,
    controller,
    circleId,
    members: [...byWebid.keys()],
    bundleOf,
    itemStoreOf: (webid) => bundleOf(webid).itemStore,
    mirrorOf:    (webid) => bundleOf(webid).tasksMirror,

    /** Split the mesh into two halves by webid. */
    partition(groupA, groupB) {
      controller.partition(groupA.map(addrOf), groupB.map(addrOf));
    },
    /** Heal + drain all buffered cross-half envelopes. */
    async reconverge() { controller.heal(); await settle(); },
    settle,

    addTaskAs: (webid, args) =>
      callSkill(bundleOf(webid).agent, 'addTask', { circleId, ...args }, webid),
    claimAs: (webid, id) =>
      callSkill(bundleOf(webid).agent, 'claimTask', { circleId, id }, webid),
    listOpenAs: (webid) => bundleOf(webid).itemStore.listOpen(),
    call: (webid, skillId, args) =>
      callSkill(bundleOf(webid).agent, skillId, { circleId, ...args }, webid),

    async stop() {
      for (const n of nodes) { try { await n.bundle.close?.(); } catch { /* best-effort */ } }
    },
  };
}

// ── central-pod topology: a shared conditional-write "pod" DataSource ─────────

/**
 * A minimal CAS-capable DataSource ("the central pod"): tracks a per-path
 * etag and enforces an `If-Match` precondition on write, throwing
 * `{code:'CONFLICT'}` on mismatch. Two `ItemStore`s pointed at ONE of these
 * share the pod — the etag-CAS is the one-winner serialization point
 * threads through `ItemStore.claim`.
 */
export function makeCasPodSource() {
  const store = new Map();   // path -> { data, etag }
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    async read(path) { return store.get(path)?.data ?? null; },
    async readEtag(path) { return store.get(path)?.etag ?? null; },
    async write(path, data, opts = {}) {
      const cur = store.get(path);
      if (opts && opts.ifMatch != null) {
        const curEtag = cur?.etag ?? null;
        if (curEtag !== opts.ifMatch) {
          throw Object.assign(new Error(`If-Match failed on ${path}`), { code: 'CONFLICT', status: 412 });
        }
      }
      const etag = nextEtag();
      store.set(path, { data, etag });
      return { etag };
    },
    async delete(path) { store.delete(path); },
    async list(prefix = '') {
      return [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
