/**
 * canopy-chat — local built-ins tests.  /help today.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { canopyChatManifest }              from '../manifest.js';
import { mergeManifests }                  from '../src/manifestMerge.js';
import { createLocalBuiltins }             from '../src/core/localBuiltins.js';
import { initLocalisation, t, setLang }    from '../src/localisation.js';
import { ThreadStore }                     from '../src/threadStore.js';

const householdLite = {
  app:       'household', itemTypes: ['chore'],
  operations: [
    { id: 'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' },
                  chat:  { reply: 'list', hint: 'list open chores' } } },
    { id: 'markComplete', verb: 'complete', params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: { slash: { command: '/done' },
                  chat:  { reply: 'text', hint: 'mark a chore complete' } } },
  ],
  views: [{ id: 'chores', title: 'C', type: 'chore' }],
};

beforeAll(async () => {
  await initLocalisation({ lng: 'en' });
});

describe('/help', () => {
  it('lists every command from the merged catalog, grouped by app', async () => {
    const catalog  = mergeManifests([
      { manifest: canopyChatManifest },
      { manifest: householdLite },
    ]);
    const builtins = createLocalBuiltins({ catalog, t });
    const r = await builtins.help();
    expect(typeof r.message).toBe('string');
    expect(r.message).toMatch(/Available commands/);
    expect(r.message).toMatch(/Chat/);             // canopy-chat section first
    expect(r.message).toMatch(/\/help/);
    expect(r.message).toMatch(/household/);        // app section header
    expect(r.message).toMatch(/\/mine/);
    expect(r.message).toMatch(/\/done/);
    expect(r.message).toMatch(/list open chores/);
    expect(r.message).toMatch(/mark a chore complete/);
  });

  it("puts canopy-chat (built-ins) section first", async () => {
    const catalog = mergeManifests([
      { manifest: householdLite },
      { manifest: canopyChatManifest },
    ]);
    const r = await createLocalBuiltins({ catalog, t }).help();
    const chatIdx = r.message.indexOf('Chat');
    const appIdx  = r.message.indexOf('household');
    expect(chatIdx).toBeGreaterThan(-1);
    expect(appIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeLessThan(appIdx);
  });

  it("respects locale (Dutch heading)", async () => {
    const catalog = mergeManifests([{ manifest: canopyChatManifest }]);
    await setLang('nl');
    const r = await createLocalBuiltins({ catalog, t }).help();
    expect(r.message).toMatch(/Beschikbare commando's/);
    await setLang('en');
  });

  it("renders 'empty' message when catalog has no commands", async () => {
    const catalog = mergeManifests([]);
    const r = await createLocalBuiltins({ catalog, t }).help();
    expect(r.message).toBe('No commands available yet.');
  });

  it("sorts commands alphabetically within an app section", async () => {
    const catalog = mergeManifests([{ manifest: householdLite }]);
    const r = await createLocalBuiltins({ catalog, t }).help();
    const doneIdx = r.message.indexOf('/done');
    const mineIdx = r.message.indexOf('/mine');
    expect(doneIdx).toBeLessThan(mineIdx);   // /done before /mine alphabetically
  });
});

describe('canopyChatManifest now carries /help', () => {
  it("declares help op with /help slash + 'text' reply", () => {
    const help = canopyChatManifest.operations.find((o) => o.id === 'help');
    expect(help).toBeTruthy();
    expect(help.surfaces.slash.command).toBe('/help');
    expect(help.surfaces.chat.reply).toBe('text');
  });

  it("manifest still validates", async () => {
    const { validateManifest } = await import('@canopy/app-manifest');
    const result = validateManifest(canopyChatManifest);
    expect(result.ok).toBe(true);
  });

  it("/help appears in the merged catalog's commandMenu", () => {
    const catalog = mergeManifests([{ manifest: canopyChatManifest }]);
    const helpEntry = catalog.commandMenu.find((e) => e.command === '/help');
    expect(helpEntry).toBeTruthy();
    expect(helpEntry.appOrigin).toBe('canopy-chat');
    expect(helpEntry.opId).toBe('help');
  });
});

describe('/newthread', () => {
  let store, setActiveCalls;
  beforeAll(async () => { await initLocalisation({ lng: 'en' }); });
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    setActiveCalls = [];
  });

  it("creates a new thread + switches active", async () => {
    const catalog  = mergeManifests([{ manifest: canopyChatManifest }]);
    const builtins = createLocalBuiltins({
      catalog, t, threadStore: store,
      setActive: (id) => setActiveCalls.push(id),
    });
    const r = await builtins.newthread({ name: 'Project Alpha' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Created thread "Project Alpha"/);
    expect(r.threadId).toBeTruthy();
    expect(store.size).toBe(2);
    expect(store.getThread(r.threadId).name).toBe('Project Alpha');
    expect(setActiveCalls).toEqual([r.threadId]);
  });

  it("rejects empty name", async () => {
    const builtins = createLocalBuiltins({
      catalog: mergeManifests([{ manifest: canopyChatManifest }]),
      t, threadStore: store, setActive: () => {},
    });
    const r1 = await builtins.newthread({});
    const r2 = await builtins.newthread({ name: '   ' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/Please provide a name/);
    expect(r2.ok).toBe(false);
    expect(store.size).toBe(1);
  });

  it("fails gracefully when no threadStore wired", async () => {
    const builtins = createLocalBuiltins({
      catalog: mergeManifests([{ manifest: canopyChatManifest }]),
      t,
    });
    const r = await builtins.newthread({ name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available/);
  });
});

describe('/threads', () => {
  let store;
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main',  name: 'Main' });
    store.createThread({ id: 'inbox', name: 'Inbox',
                         filter: { eventTypes: ['notification'] } });
  });

  it('lists every thread with active marker', async () => {
    const builtins = createLocalBuiltins({
      catalog:     mergeManifests([{ manifest: canopyChatManifest }]),
      t,
      threadStore: store,
    });
    const r = await builtins.threads();
    expect(r.message).toMatch(/Threads:/);
    expect(r.message).toMatch(/Main ●/);   // active (created first)
    expect(r.message).toMatch(/Inbox/);
    expect(r.message).toMatch(/type:notification/);
  });

  it('shows "no threads" when store empty', async () => {
    const empty = new ThreadStore();
    const builtins = createLocalBuiltins({
      catalog: mergeManifests([{ manifest: canopyChatManifest }]),
      t, threadStore: empty,
    });
    const r = await builtins.threads();
    expect(r.message).toMatch(/No threads yet/);
  });
});

describe('canopyChatManifest now also carries /newthread + /threads', () => {
  it('declares both ops', () => {
    const ids = canopyChatManifest.operations.map((o) => o.id);
    expect(ids).toContain('newthread');
    expect(ids).toContain('threads');
  });

  it('newthread has a required name param', () => {
    const op = canopyChatManifest.operations.find((o) => o.id === 'newthread');
    expect(op.params).toEqual([{ name: 'name', kind: 'string', required: true }]);
    expect(op.surfaces.slash.command).toBe('/newthread');
  });

  it('threads has no params + /threads slash', () => {
    const op = canopyChatManifest.operations.find((o) => o.id === 'threads');
    expect(op.params).toEqual([]);
    expect(op.surfaces.slash.command).toBe('/threads');
  });
});
