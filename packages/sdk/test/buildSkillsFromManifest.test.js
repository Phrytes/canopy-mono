/**
 * buildSkillsFromManifest (HIGH layer) — the shared manifest-op → core → wire
 * loop factored out of folio (browser + node) and agents.
 *
 * Guards the shared path itself (the per-app `describeLocalWireFitness` suites
 * pin op⟷core⟷wire parity per app; these pin the helper's own contract):
 *   - it wires every op to its core, preserving id + order,
 *   - it carries visibility (op.visibility by default, or a visibilityFor override),
 *   - it produces a working handler through a real agent,
 *   - it THROWS on a missing core when requireCore (default), and skips when not.
 */
import { describe, it, expect } from 'vitest';
import { createAgent, buildSkillsFromManifest, Parts } from '../src/index.js';

const OPS = [
  { id: 'addTask', params: [{ name: 'text', kind: 'string', required: true }], visibility: 'authenticated' },
  { id: 'listTasks', params: [], visibility: 'public' },
];

function addTaskCore(store, args) {
  const item = { id: store.length + 1, text: args.text };
  store.push(item);
  return item;
}
function listTasksCore(store) {
  return { items: store.slice() };
}
const CORES = { addTask: addTaskCore, listTasks: listTasksCore };

describe('buildSkillsFromManifest', () => {
  it('wires each op to its core, preserving id + order + op.visibility', () => {
    const store = [];
    const defs = buildSkillsFromManifest({ operations: OPS, cores: CORES, storeFor: () => store });
    expect(defs.map((d) => d.id)).toEqual(['addTask', 'listTasks']);
    expect(defs.map((d) => d.visibility)).toEqual(['authenticated', 'public']);
    expect(defs.every((d) => typeof d.handler === 'function')).toBe(true);
  });

  it('visibilityFor overrides op.visibility (agents constant-visibility case)', () => {
    const defs = buildSkillsFromManifest({
      operations: OPS,
      cores: CORES,
      storeFor: () => [],
      visibilityFor: () => 'authenticated',
    });
    expect(defs.map((d) => d.visibility)).toEqual(['authenticated', 'authenticated']);
  });

  it('THROWS on a missing core when requireCore (default), naming the label', () => {
    expect(() => buildSkillsFromManifest({
      operations: OPS,
      cores: { addTask: addTaskCore },   // listTasks core missing
      storeFor: () => [],
      label: 'buildXSkills',
    })).toThrow(/buildXSkills: no core for manifest op "listTasks"/);
  });

  it('skips ops without a core when requireCore=false', () => {
    const defs = buildSkillsFromManifest({
      operations: OPS,
      cores: { addTask: addTaskCore },
      storeFor: () => [],
      requireCore: false,
    });
    expect(defs.map((d) => d.id)).toEqual(['addTask']);
  });

  it('produces handlers that run end-to-end through a real agent', async () => {
    const store = [];
    const agent = await createAgent();
    for (const { id, handler, visibility } of buildSkillsFromManifest({ operations: OPS, cores: CORES, storeFor: () => store })) {
      agent.register(id, handler, { visibility });
    }
    const result = await agent.invoke(agent.address, 'addTask', Parts.wrap({ text: 'hi' }));
    expect(Parts.data(result)).toEqual({ id: 1, text: 'hi' });
    expect(store).toHaveLength(1);
    await agent.stop();
  });

  it('validates its own arguments', () => {
    expect(() => buildSkillsFromManifest({ operations: 'nope', cores: CORES, storeFor: () => [] }))
      .toThrow(/operations must be an array/);
    expect(() => buildSkillsFromManifest({ operations: OPS, cores: null, storeFor: () => [] }))
      .toThrow(/cores must be/);
    expect(() => buildSkillsFromManifest({ operations: OPS, cores: CORES, storeFor: 'x' }))
      .toThrow(/storeFor must be a function/);
  });
});
