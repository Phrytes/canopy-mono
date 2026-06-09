// M0 — LLM route guardrail. privatemode must be loopback or attested (no plaintext to a plain
// remote host); the per-participant CLEAN call site may only use local or safe-privatemode.
// See docs/CONFIDENTIAL-LLM-TRANSPORT.md + docs/MENUKAART.md §4D.   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLlmRoute, assertCleanRouteSafe } from '../src/ollama.js';

test('applyLlmRoute: local route is fine', () => {
  assert.doesNotThrow(() => applyLlmRoute({ route: 'local', model: 'm' }));
});

test('applyLlmRoute: privatemode loopback is allowed', () => {
  assert.doesNotThrow(() => applyLlmRoute({ route: 'privatemode', model: 'm', baseURL: 'http://localhost:8080/v1' }));
  assert.doesNotThrow(() => applyLlmRoute({ route: 'privatemode', model: 'm', baseURL: 'http://127.0.0.1:8080/v1' }));
});

test('applyLlmRoute: privatemode default (no baseURL) is loopback → allowed', () => {
  assert.doesNotThrow(() => applyLlmRoute({ route: 'privatemode', model: 'm' }));
});

test('applyLlmRoute: privatemode non-loopback WITHOUT attestation throws', () => {
  assert.throws(
    () => applyLlmRoute({ route: 'privatemode', model: 'm', baseURL: 'https://pm.example.com/v1' }),
    /non-loopback|attestation/i,
  );
});

test('applyLlmRoute: privatemode non-loopback WITH attestation (config) is allowed', () => {
  assert.doesNotThrow(
    () => applyLlmRoute({ route: 'privatemode', model: 'm', baseURL: 'https://pm.example.com/v1', attestation: { verify: true } }),
  );
});

test('applyLlmRoute: privatemode non-loopback WITH attestation (env) is allowed', () => {
  process.env.PRIVATEMODE_ATTESTATION = '1';
  try {
    assert.doesNotThrow(
      () => applyLlmRoute({ route: 'privatemode', model: 'm', baseURL: 'https://pm.example.com/v1' }),
    );
  } finally { delete process.env.PRIVATEMODE_ATTESTATION; }
});

test('assertCleanRouteSafe: local ok; ovh / within-walls rejected', () => {
  assert.doesNotThrow(() => assertCleanRouteSafe({ route: 'local' }));
  assert.throws(() => assertCleanRouteSafe({ route: 'ovh', baseURL: 'https://ovh/v1' }), /remote|MENUKAART/i);
  assert.throws(() => assertCleanRouteSafe({ route: 'within-walls', baseURL: 'https://x/v1' }), /remote|MENUKAART/i);
});

test('assertCleanRouteSafe: privatemode loopback ok; non-loopback unattested rejected', () => {
  assert.doesNotThrow(() => assertCleanRouteSafe({ route: 'privatemode', baseURL: 'http://127.0.0.1:8080/v1' }));
  assert.doesNotThrow(() => assertCleanRouteSafe({ route: 'privatemode' })); // default loopback
  assert.throws(() => assertCleanRouteSafe({ route: 'privatemode', baseURL: 'https://pm/v1' }), /not safe|non-loopback/i);
  assert.doesNotThrow(() => assertCleanRouteSafe({ route: 'privatemode', baseURL: 'https://pm/v1', attestation: {} }));
});
