/**
 * canopy-chat — app-registry tests.  v0.6 OQ-4.B catch-up.
 */
import { describe, it, expect } from 'vitest';

import { AppRegistry, filterCatalog } from '../src/appRegistry.js';

describe('AppRegistry', () => {
  it("defaults to enabled for any new app (forward-additive)", () => {
    const r = new AppRegistry();
    expect(r.isEnabled('newApp')).toBe(true);
  });

  it("setEnabled persists + isEnabled reflects", () => {
    const r = new AppRegistry();
    r.setEnabled('stoop', false);
    expect(r.isEnabled('stoop')).toBe(false);
    r.setEnabled('stoop', true);
    expect(r.isEnabled('stoop')).toBe(true);
  });

  it("syncWithCatalog drops unknown apps + adds new ones as enabled", () => {
    const r = new AppRegistry();
    r.setEnabled('oldApp', false);
    r.syncWithCatalog(['household', 'stoop', 'folio']);
    // oldApp gone:
    expect(r.snapshot().find((e) => e.appOrigin === 'oldApp')).toBeUndefined();
    // new apps default to enabled:
    expect(r.isEnabled('household')).toBe(true);
    expect(r.isEnabled('stoop')).toBe(true);
    expect(r.isEnabled('folio')).toBe(true);
  });

  it("syncWithCatalog preserves existing toggle state", () => {
    const r = new AppRegistry();
    r.syncWithCatalog(['household', 'stoop']);
    r.setEnabled('stoop', false);
    r.syncWithCatalog(['household', 'stoop', 'folio']);
    expect(r.isEnabled('stoop')).toBe(false);
    expect(r.isEnabled('folio')).toBe(true);
  });

  it("enabledApps returns the on-list", () => {
    const r = new AppRegistry();
    r.syncWithCatalog(['a', 'b', 'c']);
    r.setEnabled('b', false);
    expect(r.enabledApps().sort()).toEqual(['a', 'c']);
  });

  it("subscribe fires on toggle", () => {
    const r = new AppRegistry();
    const seen = [];
    r.subscribe((state) => seen.push(new Map(state)));
    r.syncWithCatalog(['a']);
    r.setEnabled('a', false);
    expect(seen.length).toBe(2);
    expect(seen[1].get('a')).toBe(false);
  });

  it("unsubscribe stops events", () => {
    const r = new AppRegistry();
    let fires = 0;
    const off = r.subscribe(() => fires++);
    r.syncWithCatalog(['a']);
    off();
    r.setEnabled('a', false);
    expect(fires).toBe(1);   // only the syncWithCatalog fire
  });
});

describe('filterCatalog', () => {
  const baseCatalog = () => ({
    appOrigins:  ['household', 'stoop', 'folio'],
    commandMenu: [
      { command: '/done',     opId: 'markComplete', appOrigin: 'household' },
      { command: '/post',     opId: 'postRequest',  appOrigin: 'stoop'     },
      { command: '/readnote', opId: 'readNote',     appOrigin: 'folio'     },
    ],
    opsById: new Map([
      ['markComplete', { op: {}, appOrigin: 'household' }],
      ['postRequest',  { op: {}, appOrigin: 'stoop' }],
      ['readNote',     { op: {}, appOrigin: 'folio' }],
    ]),
    replyShapeFor:    () => undefined,
    followUpsFor:     () => undefined,
    embedSnapshotFor: () => undefined,
    warnings: [],
  });

  it("removes ops from disabled apps", () => {
    const r = new AppRegistry();
    r.syncWithCatalog(['household', 'stoop', 'folio']);
    r.setEnabled('stoop', false);
    const filtered = filterCatalog(baseCatalog(), r);
    expect(filtered.commandMenu.find((e) => e.command === '/post')).toBeUndefined();
    expect(filtered.opsById.has('postRequest')).toBe(false);
    expect(filtered.appOrigins).toEqual(['household', 'folio']);
  });

  it("no-op when everything is enabled", () => {
    const r = new AppRegistry();
    r.syncWithCatalog(['household', 'stoop', 'folio']);
    const filtered = filterCatalog(baseCatalog(), r);
    expect(filtered.commandMenu.length).toBe(3);
    expect(filtered.opsById.size).toBe(3);
  });

  it("disabling ALL apps yields an empty catalog", () => {
    const r = new AppRegistry();
    r.syncWithCatalog(['household', 'stoop', 'folio']);
    r.setEnabled('household', false);
    r.setEnabled('stoop',     false);
    r.setEnabled('folio',     false);
    const filtered = filterCatalog(baseCatalog(), r);
    expect(filtered.commandMenu).toEqual([]);
    expect(filtered.opsById.size).toBe(0);
    expect(filtered.appOrigins).toEqual([]);
  });

  it("defensive: null catalog or registry returns the input verbatim", () => {
    expect(filterCatalog(null, new AppRegistry())).toBeNull();
    // filterCatalog returns the same reference when registry is null —
    // the defensive guard short-circuits before constructing a new
    // catalog object.
    const cat = baseCatalog();
    expect(filterCatalog(cat, null)).toBe(cat);
  });
});
