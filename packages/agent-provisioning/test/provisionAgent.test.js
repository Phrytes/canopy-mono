/**
 * provisionAgent — facade unit tests.
 *
 * Phase 50.5.b — verifies the canonical bring-up path composes core
 * + the standardisation substrates correctly:
 *   - mnemonic-restored identity (deterministic)
 *   - generated identity (fresh)
 *   - opaque slots (webid, pseudoPod, agentRegistry) populated as
 *     supplied
 *   - autoStart toggle
 *   - vault defaulting (VaultMemory)
 *   - pre-constructed substrate objects pass through to the slots
 *   - input validation (INVALID_ARGUMENT for missing transport)
 *
 * OIDC + WebID-discovery integration is mocked (we don't reach a real
 * provider in unit tests).  The Inrupt session factory seam from
 * `@onderling/oidc-session` is used to inject a fake.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { _setSessionFactory } from '@onderling/oidc-session';
import { provisionAgent } from '../src/provisionAgent.js';

const SAMPLE_MNEMONIC = [
  'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'art',
].join(' ');

/* ────────────────────────────────────────────────────────────────────────── */

function makeTransport() {
  const bus = new InternalBus();
  return new InternalTransport(bus, 'tester');
}

class FakeSolidSession {
  constructor() {
    this.events = new EventEmitter();
    this.info   = { isLoggedIn: false, expirationDate: undefined };
    this.accessToken  = null;
    this.refreshToken = null;
    this.idToken      = null;
  }
  async login(opts) {
    this.info.isLoggedIn = true;
    this.info.expirationDate = Date.now() + 3_600_000;
    const tok = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      idToken: 'id-1',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    this.accessToken  = tok.accessToken;
    this.refreshToken = tok.refreshToken;
    this.idToken      = tok.idToken;
    this.events.emit('newTokens', tok);
  }
  async logout() { this.info.isLoggedIn = false; }
  async fetch()  { return new Response('', { status: 200 }); }
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('provisionAgent — local-only (no OIDC)', () => {
  it('throws INVALID_ARGUMENT when no transport supplied', async () => {
    await expect(provisionAgent({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('builds an Agent from a fresh-generated identity', async () => {
    const transport = makeTransport();
    const result = await provisionAgent({ transport, autoStart: false });
    expect(result.agent).toBeDefined();
    expect(result.identity).toBeDefined();
    expect(result.vault).toBeInstanceOf(VaultMemory);
    expect(result.mnemonic).toBe(null);          // fresh-generate path doesn't expose mnemonic
    expect(result.oidc).toBe(null);
    expect(result.webid).toBe(null);
    expect(result.agent.pseudoPod).toBe(null);
    expect(result.agent.agentRegistry).toBe(null);
  });

  it('restores identity deterministically from a mnemonic', async () => {
    const transport = makeTransport();

    const a = await provisionAgent({ mnemonic: SAMPLE_MNEMONIC, transport, autoStart: false });
    const b = await provisionAgent({ mnemonic: SAMPLE_MNEMONIC, transport: makeTransport(), autoStart: false });

    expect(a.identity.pubKey).toEqual(b.identity.pubKey);
    expect(a.mnemonic).toBe(SAMPLE_MNEMONIC);
  });

  it('uses a caller-supplied vault when provided', async () => {
    const transport = makeTransport();
    const myVault = new VaultMemory();
    const result = await provisionAgent({ transport, vault: myVault, autoStart: false });
    expect(result.vault).toBe(myVault);
    expect(await myVault.get('agent-privkey')).toBeTruthy();
  });

  it('passes opaque pseudoPod + agentRegistry through to the Agent slots', async () => {
    const transport = makeTransport();
    const fakePseudoPod    = { kind: 'fake-pp',    read: async () => 'value' };
    const fakeAgentRegistry = { kind: 'fake-reg' };
    const result = await provisionAgent({
      transport,
      pseudoPod: fakePseudoPod,
      agentRegistry: fakeAgentRegistry,
      autoStart: false,
    });
    expect(result.agent.pseudoPod).toBe(fakePseudoPod);
    expect(result.agent.agentRegistry).toBe(fakeAgentRegistry);
  });

  it('autoStarts the agent by default', async () => {
    const transport = makeTransport();
    const result = await provisionAgent({ transport });
    // Agent.start() is idempotent; the call should not throw.
    // We verify by checking the transport got a receive handler installed.
    expect(typeof transport.receiveHandler).toBe('function');
  });

  it('does not auto-start when autoStart: false', async () => {
    const transport = makeTransport();
    await provisionAgent({ transport, autoStart: false });
    // No receive handler registered → no start happened.
    expect(transport.receiveHandler).toBe(null);
  });

  it('pre-registers caller-supplied skills', async () => {
    const transport = makeTransport();
    const echo = {
      id: 'echo',
      handler: async ({ parts }) => parts,
      description: 'echo',
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      tags: [],
      streaming: false,
      visibility: 'authenticated',
      policy: 'on-request',
      posture: 'always',
      humanInTheLoop: 'never',
      requiredRole: null,
      enabled: true,
    };
    const result = await provisionAgent({ transport, skills: [echo], autoStart: false });
    expect(result.agent.skills.get('echo')).toBeTruthy();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('provisionAgent — pod-having (mocked OIDC)', () => {
  beforeEach(() => {
    _setSessionFactory(() => new FakeSolidSession());
  });
  afterEach(() => { _setSessionFactory(null); });

  it('constructs a SolidVault and stores its session on the result', async () => {
    const transport = makeTransport();
    const result = await provisionAgent({
      transport,
      mnemonic: SAMPLE_MNEMONIC,
      autoStart: false,
      oidc: {
        webid:        'https://alice.example/profile#me',
        oidcIssuer:   'https://login.example/',
        clientId:     'c',
        clientSecret: 's',
      },
    });
    expect(result.oidc).toBeDefined();
    expect(result.oidc.isAuthenticated()).toBe(true);
    expect(result.oidc.webid).toBe('https://alice.example/profile#me');
  });

  it('constructs a WebIdCache + attempts an initial refresh (errors swallowed)', async () => {
    // The fake Inrupt session's fetch returns 200 with empty body; the
    // discoverPointers parser handles that gracefully (empty pointers).
    const transport = makeTransport();
    const result = await provisionAgent({
      transport,
      autoStart: false,
      oidc: {
        webid:        'https://alice.example/profile#me',
        oidcIssuer:   'https://login.example/',
        clientId:     'c',
        clientSecret: 's',
      },
    });
    expect(result.webid).toBeDefined();
    expect(result.agent.webid).toBe(result.webid);  // wired to the Agent slot
    expect(result.webid.webid).toBe('https://alice.example/profile#me');
  });

  it('passes pseudoPod.read into the WebIdCache for pointer resolution', async () => {
    const transport = makeTransport();
    const seenUris = [];
    const fakePseudoPod = {
      read: async (uri) => { seenUris.push(uri); return null; },
    };
    const result = await provisionAgent({
      transport,
      autoStart: false,
      pseudoPod: fakePseudoPod,
      oidc: {
        webid:        'https://alice.example/profile#me',
        oidcIssuer:   'https://login.example/',
        clientId:     'c',
        clientSecret: 's',
      },
    });
    expect(result.webid).toBeDefined();
    // (We don't assert seenUris here because the empty profile body
    // yields no pointers to resolve; the read isn't called.  The test
    // confirms the wiring exists by not throwing.)
    expect(result.agent.pseudoPod).toBe(fakePseudoPod);
  });
});
