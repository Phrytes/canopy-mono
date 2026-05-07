/**
 * H5 V0 web UI smoke — Phase 7 product item #1.
 *
 * Boots a real H5 cluster (alice + bob with paint skill), mounts the
 * web UI on a free port via `mountLocalUi({staticDir, a2aTLSLayer:
 * new LocalUiAuth({localActor: ALICE})})`, then verifies:
 *   1. Static files from `web/` are served on `/` (index.html), `/app.js`,
 *      `/style.css`, `/mine.html`.
 *   2. The agent card is reachable at `/.well-known/agent.json`.
 *   3. `POST /tasks/send` calls a skill (`postRequest`) end-to-end and
 *      returns the H5 result shape — exercising LocalUiAuth's tier-1
 *      authentication for the configured actor.
 *   4. Path traversal is blocked.
 *
 * The frontend itself (the HTML/JS in `web/`) is not exercised — that
 * needs a real browser. The smoke validates the contract the frontend
 * relies on (same-origin static + A2A endpoints behind LocalUiAuth).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
} from '@canopy/core';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';

import { createNeighborhoodAgent } from '../src/index.js';

const ALICE   = 'https://id.example/alice';
const BOB     = 'https://id.example/bob';
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

let bundles, ui, baseUrl;

beforeAll(async () => {
  // Two-agent cluster, alice (requester) + bob (paint responder).
  const bus = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());

  const alice = await createNeighborhoodAgent({
    identity:  aliceId,
    transport: new InternalTransport(bus, aliceId.pubKey),
    label:     'H5-alice',
    members:   [{ webid: ALICE, displayName: 'Alice' }, { webid: BOB, displayName: 'Bob' }],
    skillMatch: {
      group:      'block-42',
      localActor: ALICE,
      peers:      [{ pubKey: bobId.pubKey }],
    },
  });
  const bob = await createNeighborhoodAgent({
    identity:  bobId,
    transport: new InternalTransport(bus, bobId.pubKey),
    label:     'H5-bob',
    skillMatch: {
      group:      'block-42',
      localActor: BOB,
      peers:      [{ pubKey: aliceId.pubKey }],
      skills:     ['paint'],
      posture:    { paint: 'always' },
    },
  });
  bundles = { alice, bob };

  alice.agent.addPeer(bobId.pubKey,   bobId.pubKey);
  bob.agent.addPeer(aliceId.pubKey,   aliceId.pubKey);
  await alice.skillMatch.start();
  await bob.skillMatch.start();
  bob.skillMatch.subscribe(async () => {});

  ui = await mountLocalUi(alice.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: ALICE }),
  });
  baseUrl = ui.url;
});

afterAll(async () => {
  await ui?.stop();
});

describe('H5 V0 web UI smoke', () => {
  it('serves index.html on /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('Stoop');
    expect(html).toContain('post-form');
  });

  it('serves /mine.html', async () => {
    const res = await fetch(`${baseUrl}/mine.html`);
    expect(res.status).toBe(200);
    expect((await res.text())).toMatch(/Mijn posts|My requests/);
  });

  it('serves /app.js with javascript content-type', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const js = await res.text();
    expect(js).toContain('export async function callSkill');
  });

  // Regression: app.js parsed as a JS module — catches syntax errors
  // (e.g. `await` inside a non-async callback) that would otherwise
  // silently break every page that imports from /app.js.
  it('app.js parses as a JS module + has the expected exports', async () => {
    const url = new URL('../web/app.js', import.meta.url).href;
    const mod = await import(url);
    for (const name of [
      'callSkill', 'getActor', 'mountGroupSwitcher', 'mountLive',
      'mountNotifyBanner', 'renderItems', 'renderMyItems',
      'renderPostMenu', 'showBanner',
    ]) {
      expect(typeof mod[name]).toBe('function');
    }
  });

  it('serves /style.css with css content-type', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/css/);
  });

  it('exposes the agent card at /.well-known/agent.json', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('blocks path traversal', async () => {
    // Try to escape the staticDir root via ../
    const res = await fetch(`${baseUrl}/../package.json`);
    // Either 403 (caught by traversal hardening) or 404 (Node URL-normalises
    // away from staticDir before reaching us). Both are acceptable.
    expect([403, 404]).toContain(res.status);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('POST /tasks/send invokes postRequest end-to-end via LocalUiAuth', async () => {
    const body = {
      skillId: 'postRequest',
      message: { parts: [{ type: 'DataPart', data: {
        text:           'Paint my fence',
        requiredSkills: ['paint'],
        timeoutMs:      300,
        expectClaims:   1,           // legacy V0: caller wants to wait for the claim
      } }] },
    };
    const res = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('completed');
    const dp = (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart');
    expect(dp).toBeTruthy();
    expect(dp.data).toHaveProperty('requestId');
    expect(dp.data.claims).toHaveLength(1);
    expect(dp.data.claims[0].actor).toBe(BOB);
  });

  it('listMyRequests filters by the LocalUiAuth-configured actor (ALICE)', async () => {
    // The previous test posted as ALICE — ALICE should see her own item.
    const body = {
      skillId: 'listMyRequests',
      message: { parts: [{ type: 'DataPart', data: {} }] },
    };
    const res = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const dp = (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart');
    expect(dp.data.items.length).toBeGreaterThanOrEqual(1);
    expect(dp.data.items[0].addedBy).toBe(ALICE);
  });
});

// ── Stoop V1 Phase 5 — kind tabs + moderation skills via REST ─────────────

async function callRest(skillId, data) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data }] } }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('completed');
  return (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart')?.data ?? {};
}

describe('Stoop V1 web UI — Phase 5 (kind tabs + moderation)', () => {
  it('listOpen({kind: "lend"}) returns only lends', async () => {
    await callRest('postRequest', { text: 'aanhanger', kind: 'lend',  expectClaims: 0, timeoutMs: 1 });
    await callRest('postRequest', { text: 'tax help',  kind: 'offer', expectClaims: 0, timeoutMs: 1 });

    const lends = await callRest('listOpen', { kind: 'lend' });
    expect(lends.items.every(i => i.type === 'lend')).toBe(true);
    expect(lends.items.some(i => i.text === 'aanhanger')).toBe(true);

    const offers = await callRest('listOpen', { kind: 'offer' });
    expect(offers.items.every(i => i.type === 'offer')).toBe(true);
  });

  it('mutePeer + listMutedPeers via REST', async () => {
    const m = await callRest('mutePeer', { peerWebid: 'https://id.example/marie' });
    expect(m).toEqual({ muted: 'https://id.example/marie' });

    const list = await callRest('listMutedPeers', {});
    expect(list.peers).toContain('https://id.example/marie');

    await callRest('unmutePeer', { peerWebid: 'https://id.example/marie' });
    const list2 = await callRest('listMutedPeers', {});
    expect(list2.peers).not.toContain('https://id.example/marie');
  });

  it('reportPost via REST creates a kind:"report" item', async () => {
    const post = await callRest('postRequest', {
      text: 'something problematic',
      kind: 'ask',
      expectClaims: 0,
      timeoutMs: 1,
    });
    const r = await callRest('reportPost', { itemId: post.requestId, reason: 'irrelevant' });
    expect(r.reportId).toBeTruthy();

    const reports = await callRest('listOpen', { kind: 'report' });
    expect(reports.items.some(it => it.id === r.reportId)).toBe(true);
  });
});

describe('Stoop V1 web UI — Phase 6 (profile)', () => {
  it('serves /profile.html', async () => {
    const res = await fetch(`${baseUrl}/profile.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Mijn profiel/);
  });

  it('setMyHandle + getMyProfile via REST', async () => {
    const set = await callRest('setMyHandle', { handle: '@Alice-Test' });
    expect(set.handle).toBe('alice-test');

    const profile = await callRest('getMyProfile', {});
    expect(profile.entry.handle).toBe('alice-test');
    expect(profile.renderForCurrentGroup.render).toBe('@alice-test');
  });

  it('setMyHandle rejects invalid input over REST', async () => {
    const r = await callRest('setMyHandle', { handle: 'an' });
    expect(r.error).toBe('invalid-handle');
    expect(r.reason).toBe('too-short');
  });
});
