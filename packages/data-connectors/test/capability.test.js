import { describe, it, expect } from 'vitest';
import { connectorAsCapability } from '../src/capability.js';
import { createSqlConnector } from '../src/connectors/sql.js';
import { ConnectorErrorCode } from '../src/errors.js';
import { stubDriver } from './helpers.js';

describe('connectorAsCapability — thin projection into { op, noun, handler }', () => {
  it('produces the expected { op, noun, handler } shape', () => {
    const c = createSqlConnector({ driver: stubDriver({ rows: [] }), id: 'crm' });
    const cap = connectorAsCapability(c, { op: 'query', noun: 'contact' });
    expect(cap.op).toBe('query');
    expect(cap.noun).toBe('contact');
    expect(typeof cap.handler).toBe('function');
  });

  it('noun defaults to the connector describe().name', () => {
    const c = createSqlConnector({ driver: stubDriver({ rows: [] }), id: 'crm' });
    const cap = connectorAsCapability(c);
    expect(cap.noun).toBe('crm');
  });

  it('handler(noun, args, ctx) routes {op, params} into the connector and returns {ok, data}', async () => {
    const driver = stubDriver({ rows: [{ id: 1, name: 'Ada' }] });
    const c = createSqlConnector({ driver });
    const { handler } = connectorAsCapability(c, { noun: 'contact' });

    const out = await handler('contact', { op: 'select', params: { table: 'contacts', where: { id: 1 } } }, {});

    expect(out).toEqual({ ok: true, data: [{ id: 1, name: 'Ada' }], meta: expect.any(Object) });
    expect(driver.calls[0].sql).toBe('SELECT * FROM contacts WHERE id = ?');
    expect(driver.calls[0].params).toEqual([1]);
  });

  it('maps a ConnectorError to { ok:false, code } (never throws the code away as a string)', async () => {
    const c = createSqlConnector({ driver: stubDriver({ throwErr: new Error('connection lost') }) });
    const { handler } = connectorAsCapability(c, { noun: 'contact' });
    const out = await handler('contact', { op: 'select', params: { table: 'contacts' } });
    expect(out).toEqual({ ok: false, code: ConnectorErrorCode.TRANSPORT });
  });

  it('can project the mutate path via {via:"mutate"}', async () => {
    const driver = stubDriver({ rows: null });
    const c = createSqlConnector({ driver });
    const { handler } = connectorAsCapability(c, { op: 'add', noun: 'contact', via: 'mutate' });
    const out = await handler('contact', { op: 'insert', params: { table: 'contacts', values: { name: 'Bo' } } });
    expect(out.ok).toBe(true);
    expect(driver.calls[0].sql).toBe('INSERT INTO contacts (name) VALUES (?)');
  });
});
