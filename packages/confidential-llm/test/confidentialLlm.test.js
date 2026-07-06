import { describe, it, expect } from 'vitest';
import { LlmClient } from '@canopy/llm-client';
import { mockProvider } from '@canopy/llm-client/providers/mock';
import { createConfidentialLlm } from '../src/index.js';
import {
  makeReport, makeSpyLlm, chainOk, chainBad, chainThrows,
  GOOD_MEASUREMENT, WRONG_MEASUREMENT, TLS_PUBKEY, OTHER_PUBKEY, ROOTS,
} from './helpers.js';

const endpoint = { name: 'enclave', baseUrl: 'https://enclave.example', model: 'qwen3-4b', tlsPublicKey: TLS_PUBKEY };
const REQ = { system: 'you are helpful', messages: [{ role: 'user', content: 'TOP SECRET PROMPT' }] };

function base(overrides = {}) {
  return {
    endpoint,
    attestation: makeReport(),
    verifyChain: chainOk,
    expectedMeasurement: GOOD_MEASUREMENT,
    roots: ROOTS,
    ...overrides,
  };
}

describe('createConfidentialLlm — attest-first gateway, refuse-on-failure', () => {
  it('passing attestation => routes through the injected llm and returns its result', async () => {
    const llm = makeSpyLlm({ replyText: 'enclave says hi', toolCall: null, raw: {} });
    const gw = createConfidentialLlm(base({ llm }));

    const res = await gw.invoke(REQ, { customerId: 'acme' });
    expect(res.replyText).toBe('enclave says hi');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].req).toBe(REQ);
    expect(llm.calls[0].ctx).toEqual({ customerId: 'acme' });
  });

  it('interops with a real @canopy/llm-client LlmClient + mockProvider', async () => {
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'via LlmClient' }] }),
    });
    const gw = createConfidentialLlm(base({ llm }));
    const res = await gw.invoke(REQ);
    expect(res.replyText).toBe('via LlmClient');
  });

  // ── THE HEADLINE: a failed attestation ⇒ invoke REFUSES and NO request reaches the llm. ──

  it('wrong measurement => REFUSED, llm never called (no prompt bytes leave the device)', async () => {
    const llm = makeSpyLlm();
    const gw = createConfidentialLlm(base({ llm, attestation: makeReport({ measurement: WRONG_MEASUREMENT }) }));

    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(res.code).toBe('attestation-failed');
    expect(res.reason).toBe('measurement-mismatch');
    expect(llm.calls).toHaveLength(0);            // <-- the guarantee
    // The refusal carries NO prompt content — only an endpoint label + reason code.
    expect(JSON.stringify(res)).not.toContain('TOP SECRET');
  });

  it('bad signature => REFUSED, llm never called', async () => {
    const llm = makeSpyLlm();
    const gw = createConfidentialLlm(base({ llm, verifyChain: chainBad }));
    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(res.reason).toBe('bad-signature');
    expect(llm.calls).toHaveLength(0);
  });

  it('a throwing chain verifier => REFUSED, llm never called (no crash, no route)', async () => {
    const llm = makeSpyLlm();
    const gw = createConfidentialLlm(base({ llm, verifyChain: chainThrows }));
    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('channel binding mismatch (MITM) => REFUSED, llm never called', async () => {
    const llm = makeSpyLlm();
    // Attestation is valid, but the report binds to a DIFFERENT TLS pubkey than the endpoint presents.
    const gw = createConfidentialLlm(base({
      llm,
      endpoint: { ...endpoint, tlsPublicKey: OTHER_PUBKEY },
    }));
    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(res.code).toBe('channel-unbound');
    expect(llm.calls).toHaveLength(0);
  });

  it('a throwing attestation producer => REFUSED, llm never called', async () => {
    const llm = makeSpyLlm();
    const gw = createConfidentialLlm(base({
      llm,
      attestation: async () => { throw new Error('could not fetch quote'); },
    }));
    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(res.code).toBe('attestation-error');
    expect(llm.calls).toHaveLength(0);
  });

  it('stale quote => REFUSED, llm never called', async () => {
    const llm = makeSpyLlm();
    const nowMs = 2_000_000_000_000;
    const gw = createConfidentialLlm(base({
      llm,
      attestation: makeReport({ timestamp: nowMs - 24 * 60 * 60 * 1000 }),
      now: () => nowMs,
    }));
    const res = await gw.invoke(REQ);
    expect(res.refused).toBe(true);
    expect(res.reason).toBe('stale');
    expect(llm.calls).toHaveLength(0);
  });

  it('NO silent downgrade: a refused gateway never routes even after repeated invokes', async () => {
    const llm = makeSpyLlm();
    const gw = createConfidentialLlm(base({ llm, verifyChain: chainBad }));
    await gw.invoke(REQ);
    await gw.invoke(REQ);
    await gw.invoke(REQ);
    expect(llm.calls).toHaveLength(0);            // never falls back to a plain endpoint
  });

  it("policy:'once' attests a single time across many invokes (cached success)", async () => {
    const llm = makeSpyLlm();
    let attestCount = 0;
    const gw = createConfidentialLlm(base({
      llm,
      attestation: () => { attestCount++; return makeReport(); },
    }));
    await gw.invoke(REQ);
    await gw.invoke(REQ);
    expect(attestCount).toBe(1);
    expect(llm.calls).toHaveLength(2);
  });

  it("policy:'always' re-attests on every invoke; a quote that goes bad stops routing", async () => {
    const llm = makeSpyLlm();
    let good = true;
    const gw = createConfidentialLlm(base({
      llm,
      policy: 'always',
      attestation: () => (good ? makeReport() : makeReport({ measurement: WRONG_MEASUREMENT })),
    }));
    const ok = await gw.invoke(REQ);
    expect(ok.refused).toBeUndefined();
    good = false;                                  // enclave rotated to unpinned code
    const refused = await gw.invoke(REQ);
    expect(refused.refused).toBe(true);
    expect(llm.calls).toHaveLength(1);             // only the first, attested call routed
  });

  it('constructor rejects missing injected contracts (fail closed on misconfig)', () => {
    expect(() => createConfidentialLlm({ endpoint, verifyChain: chainOk, expectedMeasurement: GOOD_MEASUREMENT }))
      .toThrow(/llm/);
    expect(() => createConfidentialLlm({ endpoint, llm: makeSpyLlm(), expectedMeasurement: GOOD_MEASUREMENT }))
      .toThrow(/verifyChain/);
    expect(() => createConfidentialLlm({ endpoint, llm: makeSpyLlm(), verifyChain: chainOk }))
      .toThrow(/expectedMeasurement/);
    expect(() => createConfidentialLlm({ endpoint: { baseUrl: 'x' }, llm: makeSpyLlm(), verifyChain: chainOk, expectedMeasurement: GOOD_MEASUREMENT }))
      .toThrow(/tlsPublicKey/);
  });
});
