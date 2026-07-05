/**
 * Folio autoShare — ACP path integration (Phase 52.16.5 + 52.16.8).
 *
 * Verifies that `ensureShares({podClient})` mints ACP grants when the
 * pod supports ACP (Link header rel="...solid/acp#accessControl") and
 * falls back to cap-tokens otherwise.
 *
 * The Inrupt SDK is mocked via `_setInruptModuleForTests` (no real
 * RDF round-trip; we just verify the right primitives are called).
 *
 * Companion to `autoShare.test.js` which covers the legacy cap-token
 * path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';

import { AgentIdentity } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import {
  createClientSharing,
  _setInruptModuleForTests,
} from '@canopy/pod-client';

import {
  ensureShares,
  shareFolderName,
} from '../src/autoShare.js';

const POD_ROOT  = 'https://alice.example/notes/';
const ALICE_PUB = 'https://alice.example.com/profile/card#me';
const BOB_WEBID = 'https://bob.example.org/profile/card#me';
const ACP_LINK  = '<https://alice.example/notes?ext=acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"';
const WAC_LINK  = '<.acl>; rel="acl"';

/** Build a stub fetch that always returns ACP-friendly HEAD responses. */
function makeAuthFetch(linkHeader) {
  const calls = [];
  const f = async (uri, init = {}) => {
    calls.push({ uri, init });
    if ((init.method || 'GET').toUpperCase() === 'HEAD') {
      return {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === 'link' ? linkHeader : null;
          },
        },
      };
    }
    return { ok: true };
  };
  f.calls = calls;
  return f;
}

/** Fake Inrupt universalAccess module that logs calls. */
function makeFakeInrupt() {
  const log = { setAgent: [], setPublic: [] };
  return {
    log,
    universalAccess: {
      async setAgentAccess(uri, agent, access) { log.setAgent.push({ uri, agent, access }); },
      async setPublicAccess(uri, access)       { log.setPublic.push({ uri, access }); },
      async getAgentAccess()  { return { read: false, append: false, write: false, controlRead: false, controlWrite: false }; },
      async getPublicAccess() { return { read: false, append: false, write: false, controlRead: false, controlWrite: false }; },
    },
  };
}

/** Stub PodClient surface — only `.sharing` is consumed by ensureShares. */
function makePodClientWithSharing(linkHeader) {
  return {
    sharing: createClientSharing({ fetch: makeAuthFetch(linkHeader), podRoot: POD_ROOT }),
  };
}

let localRoot;
let identity;
let engine;
let fakeInrupt;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-autoshare-acp-'));
  identity  = await AgentIdentity.generate(new VaultMemory());
  engine    = { localRoot, podRoot: POD_ROOT };
  fakeInrupt = makeFakeInrupt();
  _setInruptModuleForTests(fakeInrupt);
});

afterEach(async () => {
  _setInruptModuleForTests(null);
  try { await fs.rm(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function makeShareFolder(webid) {
  const name = shareFolderName(webid);
  await fs.mkdir(join(localRoot, name), { recursive: true });
}

describe('ensureShares with ACP-supporting pod', () => {
  it('mints an ACP grant instead of a cap-token', async () => {
    await makeShareFolder(BOB_WEBID);
    const podClient = makePodClientWithSharing(ACP_LINK);
    const result = await ensureShares(engine, identity, { podClient });

    expect(result.minted).toBe(1);
    expect(result.acpMinted).toBe(1);
    expect(result.capTokenMinted).toBe(0);

    // The mock Inrupt SDK should have seen exactly one setAgentAccess call.
    expect(fakeInrupt.log.setAgent).toHaveLength(1);
    expect(fakeInrupt.log.setAgent[0].agent).toBe(BOB_WEBID);
    expect(fakeInrupt.log.setAgent[0].access).toEqual({
      read: true, append: false, write: true, controlRead: false, controlWrite: false,
    });

    // The persisted record has mode: 'acp'.
    const records = Object.values(result.shares);
    expect(records).toHaveLength(1);
    expect(records[0].mode).toBe('acp');
    expect(records[0].webid).toBe(BOB_WEBID);
    expect(records[0].issuer).toBe(identity.pubKey);
    expect(records[0].token).toBeUndefined();
    expect(records[0].grant?.agent).toBe(BOB_WEBID);
    expect(records[0].grant?.modes).toEqual(['read', 'write']);
  });

  it('records mode:"wac" on WAC-only pods', async () => {
    await makeShareFolder(BOB_WEBID);
    const podClient = makePodClientWithSharing(WAC_LINK);
    const result = await ensureShares(engine, identity, { podClient });
    expect(result.acpMinted).toBe(1);
    const rec = Object.values(result.shares)[0];
    expect(rec.mode).toBe('wac');
  });

  it('skips renewal on a same-pubkey ACP record (no expiry)', async () => {
    await makeShareFolder(BOB_WEBID);
    const podClient = makePodClientWithSharing(ACP_LINK);
    const first  = await ensureShares(engine, identity, { podClient });
    const second = await ensureShares(engine, identity, { podClient });
    expect(first.minted).toBe(1);
    expect(second.minted).toBe(0);   // no work to do
    expect(second.renewed).toBe(0);
    // Mock saw only the first grant call.
    expect(fakeInrupt.log.setAgent).toHaveLength(1);
  });

  it('re-mints after identity rotation', async () => {
    await makeShareFolder(BOB_WEBID);
    const podClient = makePodClientWithSharing(ACP_LINK);
    await ensureShares(engine, identity, { podClient });
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const result = await ensureShares(engine, newIdentity, { podClient });
    expect(result.renewed).toBe(1);
    expect(fakeInrupt.log.setAgent).toHaveLength(2);
  });
});

describe('ensureShares without ACP support', () => {
  it('falls back to cap-token when pod has neither ACP nor WAC', async () => {
    await makeShareFolder(BOB_WEBID);
    const podClient = makePodClientWithSharing(null);   // no Link header
    const result = await ensureShares(engine, identity, { podClient });
    expect(result.acpMinted).toBe(0);
    expect(result.capTokenMinted).toBe(1);
    const rec = Object.values(result.shares)[0];
    expect(rec.mode).toBe('cap-token');
    expect(rec.token).toBeDefined();
  });

  it('uses cap-token path when no podClient is supplied', async () => {
    await makeShareFolder(BOB_WEBID);
    const result = await ensureShares(engine, identity);
    expect(result.acpMinted ?? 0).toBe(0);
    expect(result.capTokenMinted ?? 0).toBe(1);
    const rec = Object.values(result.shares)[0];
    expect(rec.mode).toBe('cap-token');
  });
});

describe('ensureShares mixed pod modes (regression)', () => {
  it('a pod that supports ACP for one folder mints ACP for ALL folders', async () => {
    // Two share folders, same pod → both should go ACP since
    // capabilities are origin-scoped.
    await makeShareFolder(BOB_WEBID);
    await makeShareFolder('https://carol.example.org/profile/card#me');
    const podClient = makePodClientWithSharing(ACP_LINK);
    const result = await ensureShares(engine, identity, { podClient });
    expect(result.acpMinted).toBe(2);
    expect(result.capTokenMinted).toBe(0);
    expect(fakeInrupt.log.setAgent).toHaveLength(2);
  });
});
