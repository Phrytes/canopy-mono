/**
 * H4 V0 web UI smoke — Phase 7 product item (H4 mirror of H5's web UI).
 *
 * Boots a real H4 agent (admin actor + a 5-role permission table),
 * mounts the web UI on a free port via `mountLocalUi({staticDir,
 * a2aTLSLayer: new LocalUiAuth({localActor})})`, then verifies:
 *   1. Static files from `web/` are served (`/`, `/mine.html`, `/app.js`,
 *      `/style.css`).
 *   2. Agent card at `/.well-known/agent.json`.
 *   3. `/tasks-config.json` (an extraStaticFiles overlay) is reachable
 *      and surfaces the actor + role map to the frontend.
 *   4. `POST /tasks/send` invokes addTask end-to-end through `LocalUiAuth`
 *      with the configured webid as the role-policy actor.
 *   5. listMine reflects the actor's assignments.
 *   6. Path traversal is blocked.
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

import { createTasksAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const ROLES = { [ANNE]: 'admin', [FRITS]: 'coordinator' };
const MEMBERS = [
  { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
  { webid: FRITS, displayName: 'the author', role: 'coordinator' },
];
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

let bundle, ui, baseUrl;

beforeAll(async () => {
  const id  = await AgentIdentity.generate(new VaultMemory());
  const bus = new InternalBus();
  bundle = await createTasksAgent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey),
    label:     'H4-anne',
    roles:     ROLES,
    members:   MEMBERS,
  });

  ui = await mountLocalUi(bundle.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: ANNE }),
    extraStaticFiles: {
      '/tasks-config.json': JSON.stringify({ actor: ANNE, roles: ROLES }),
    },
  });
  baseUrl = ui.url;
});

afterAll(async () => {
  await ui?.stop();
});

describe('H4 V0 web UI smoke', () => {
  it('serves index.html on /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    // Phase 8 retitled the V0 page to "Tasks — Workspace".
    expect(html).toMatch(/Tasks — Workspace|H4 — Open tasks/);
    expect(html).toContain('add-form');
    expect(html).toContain('status-filter');
  });

  it('serves /mine.html', async () => {
    const res = await fetch(`${baseUrl}/mine.html`);
    expect(res.status).toBe(200);
    // Phase 8 renamed the V0 "My tasks" nav label to "My work" and
    // added 5 new pages alongside.
    expect((await res.text())).toContain('My work');
  });

  it('serves /app.js', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const js = await res.text();
    expect(js).toContain('export async function callSkill');
    expect(js).toContain('renderTasks');
  });

  it('serves /style.css', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/css/);
  });

  it('exposes the agent card', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('surfaces /tasks-config.json with actor + role map', async () => {
    const res = await fetch(`${baseUrl}/tasks-config.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const cfg = await res.json();
    expect(cfg.actor).toBe(ANNE);
    expect(cfg.roles[ANNE]).toBe('admin');
    expect(cfg.roles[FRITS]).toBe('coordinator');
  });

  it('blocks path traversal', async () => {
    const res = await fetch(`${baseUrl}/../package.json`);
    expect([403, 404]).toContain(res.status);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('POST /tasks/send invokes addTask end-to-end via LocalUiAuth', async () => {
    const body = {
      skillId: 'addTask',
      message: { parts: [{ type: 'DataPart', data: { type: 'task', text: 'Mow the lawn' } }] },
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
    expect(dp.data.task.text).toBe('Mow the lawn');
    expect(dp.data.task.addedBy).toBe(ANNE);   // LocalUiAuth-configured actor
  });

  it('listMine returns tasks the configured actor is assigned to', async () => {
    // Pre-seed: addTask + claimTask via direct skill calls, then list via A2A.
    const def = bundle.agent.skills.get('addTask');
    const { task } = await def.handler({
      parts: [{ type: 'DataPart', data: { type: 'task', text: 'review PR' } }],
      from:  ANNE, agent: bundle.agent, envelope: null,
    });
    await bundle.itemStore.claim(task.id, { actor: ANNE });

    const body = {
      skillId: 'listMine',
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
    expect(dp.data.items.every(t => t.assignee === ANNE)).toBe(true);
  });
});
