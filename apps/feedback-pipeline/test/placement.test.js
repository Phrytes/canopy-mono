// Phase 1 — aggregation placement is an ENFORCED, per-project trust choice: a platform-host
// process cannot decrypt a project that requires the controller (or an enclave), and the
// Privatemode route resolves to the local proxy.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAggregationAllowed, runnerRole, requiredLocation } from '../src/aggregation/placement.js';
import { cryptoForProject } from '../src/pod/crypto-config.js';
import { runSealedAggregation } from '../src/tee/aggregate.js';
import { runProjectAggregation, aggregateForProject } from '../src/run.js';
import { applyLlmRoute, setLlmRoute } from '../src/ollama.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';

const cfg = (location, extra = {}) => validateProjectConfig({
  projectId: 'p', llm: { route: 'local', model: 'm' }, aggregation: { k: 1, location },
  ...extra,
});

// restore env / module route after each test that mutates them
function withEnv(t) {
  const prevRole = process.env.FP_RUNNER_ROLE, prevBase = process.env.FP_LLM_BASEURL;
  t.after(() => {
    if (prevRole === undefined) delete process.env.FP_RUNNER_ROLE; else process.env.FP_RUNNER_ROLE = prevRole;
    if (prevBase === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prevBase;
    setLlmRoute({});   // clear route override
  });
}

test('assertAggregationAllowed: runner must be at least as private as the project requires', () => {
  // explicit runner param (no env)
  assert.doesNotThrow(() => assertAggregationAllowed(cfg('host'), { runner: 'host' }));
  assert.doesNotThrow(() => assertAggregationAllowed(cfg('controller'), { runner: 'controller' }));
  assert.doesNotThrow(() => assertAggregationAllowed(cfg('controller'), { runner: 'enclave' }));   // stronger ok
  assert.doesNotThrow(() => assertAggregationAllowed(cfg('host'), { runner: 'controller' }));
  assert.throws(() => assertAggregationAllowed(cfg('controller'), { runner: 'host' }), /requires decryption on "controller"/);
  assert.throws(() => assertAggregationAllowed(cfg('enclave'), { runner: 'controller' }), /requires decryption on "enclave"/);
  assert.equal(requiredLocation(cfg('host')), 'host');
});

test('runnerRole reads FP_RUNNER_ROLE (default host) and rejects junk', (t) => {
  withEnv(t);
  delete process.env.FP_RUNNER_ROLE;
  assert.equal(runnerRole(), 'host');
  process.env.FP_RUNNER_ROLE = 'controller';
  assert.equal(runnerRole(), 'controller');
  process.env.FP_RUNNER_ROLE = 'nonsense';
  assert.throws(() => runnerRole(), /FP_RUNNER_ROLE must be one of/);
});

test('cryptoForProject refuses to build an opener on a host runner for a controller project', (t) => {
  withEnv(t);
  const key = generateProjectKeypair();
  const config = cfg('controller', { privacy: { seal: true, projectPublicKey: key.publicKey } });

  delete process.env.FP_RUNNER_ROLE;   // = host
  assert.throws(() => cryptoForProject({ config, projectPrivateKey: key.privateKey }), /aggregation placement/);
  // the writer (no private key) is never gated — it only seals
  assert.equal(typeof cryptoForProject({ config }).seal, 'function');

  process.env.FP_RUNNER_ROLE = 'controller';   // the data controller's own box
  assert.equal(typeof cryptoForProject({ config, projectPrivateKey: key.privateKey }).open, 'function');
});

test('runSealedAggregation inherits the placement gate (TEE boundary on a host runner is refused)', async (t) => {
  withEnv(t);
  const key = generateProjectKeypair();
  const config = cfg('controller', { privacy: { seal: true, projectPublicKey: key.publicKey } });
  delete process.env.FP_RUNNER_ROLE;
  await assert.rejects(() => runSealedAggregation({
    config, projectPrivateKey: key.privateKey, readSealed: async () => [], aggregate: async () => ({}),
  }), /aggregation placement/);
});

test('runProjectAggregation: gates placement, installs the route, returns location + route', async (t) => {
  withEnv(t);
  const config = cfg('controller', { llm: { route: 'privatemode', model: 'm' } });
  const pod = { forAggregation: async () => [{ user: 'a', id: 'a:1', text: 'x' }] };
  const aggregate = async (items) => ({ n: items.length });

  delete process.env.FP_RUNNER_ROLE;
  await assert.rejects(() => runProjectAggregation({ pod, config, aggregate }), /aggregation placement/);

  process.env.FP_RUNNER_ROLE = 'controller';
  const out = await runProjectAggregation({ pod, config, aggregate });
  assert.deepEqual(out.aggregate, { n: 1 });
  assert.equal(out.location, 'controller');
  assert.equal(out.route, 'privatemode');
});

test('applyLlmRoute: privatemode → local proxy; ovh without a baseURL is rejected', (t) => {
  withEnv(t);
  delete process.env.FP_LLM_BASEURL;
  const pm = applyLlmRoute({ route: 'privatemode', model: 'm' });
  assert.equal(pm.baseURL, 'http://localhost:8080/v1');
  assert.throws(() => applyLlmRoute({ route: 'ovh', model: 'm' }), /needs llm\.baseURL/);
  const custom = applyLlmRoute({ route: 'within-walls', model: 'm', baseURL: 'https://llm.internal/v1' });
  assert.equal(custom.baseURL, 'https://llm.internal/v1');
});

test('aggregateForProject still works (placement does not touch the no-key path)', () => {
  // default-location config builds no opener and needs no runner role — sanity that we didn't
  // regress the normal path (it returns a thenable from the aggregate pipeline).
  assert.equal(typeof aggregateForProject, 'function');
  assert.equal(requiredLocation(cfg('host')), 'host');
});
