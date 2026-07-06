import { describe, it, expect } from 'vitest';
import { createSqlConnector } from '../src/connectors/sql.js';
import { ConnectorErrorCode } from '../src/errors.js';
import { stubDriver } from './helpers.js';

describe('sqlConnector — SELECT builds parameterised SQL over the injected driver', () => {
  it('binds WHERE values as separate params (default ? placeholders)', async () => {
    const driver = stubDriver({ rows: [{ id: 1 }] });
    const c = createSqlConnector({ driver });

    const res = await c.query({ op: 'select', params: { table: 'users', columns: ['id', 'name'], where: { status: 'active', age: 30 } } });

    expect(driver.calls).toHaveLength(1);
    const { sql, params } = driver.calls[0];
    expect(sql).toBe('SELECT id, name FROM users WHERE status = ? AND age = ?');
    expect(params).toEqual(['active', 30]);   // values bound, not interpolated
    expect(res.data).toEqual([{ id: 1 }]);
  });

  it('pg dialect emits positional $1..$n placeholders', async () => {
    const driver = stubDriver({ rows: [] });
    const c = createSqlConnector({ driver, dialect: 'pg' });
    await c.query({ op: 'select', params: { table: 'users', where: { name: 'x' }, limit: 5 } });
    const { sql, params } = driver.calls[0];
    expect(sql).toBe('SELECT * FROM users WHERE name = $1 LIMIT $2');
    expect(params).toEqual(['x', 5]);
  });

  it('ORDER BY + LIMIT: limit is bound, direction is a fixed keyword', async () => {
    const driver = stubDriver({ rows: [] });
    const c = createSqlConnector({ driver });
    await c.query({ op: 'select', params: { table: 'posts', orderBy: 'created', orderDir: 'desc', limit: 10 } });
    const { sql, params } = driver.calls[0];
    expect(sql).toBe('SELECT * FROM posts ORDER BY created DESC LIMIT ?');
    expect(params).toEqual([10]);
  });
});

describe('sqlConnector — INJECTION SAFETY (the load-bearing property)', () => {
  it('an injection-attempt WHERE value stays a single bound parameter (never enters SQL)', async () => {
    const driver = stubDriver({ rows: [] });
    const c = createSqlConnector({ driver });

    const evil = "x'; DROP TABLE users; --";
    await c.query({ op: 'select', params: { table: 'users', where: { name: evil } } });

    const { sql, params } = driver.calls[0];
    expect(sql).toBe('SELECT * FROM users WHERE name = ?');   // no DROP in the SQL text
    expect(sql).not.toContain('DROP');
    expect(params).toEqual([evil]);                            // it stays verbatim, as data
  });

  it('rejects an unsafe table identifier with E_CONNECTOR_BAD_REQUEST', async () => {
    const c = createSqlConnector({ driver: stubDriver() });
    await expect(c.query({ op: 'select', params: { table: 'users; DROP TABLE x' } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.BAD_REQUEST });
  });

  it('rejects an unsafe column identifier', async () => {
    const c = createSqlConnector({ driver: stubDriver() });
    await expect(c.query({ op: 'select', params: { table: 'users', columns: ['id, (SELECT pw FROM secrets)'] } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.BAD_REQUEST });
  });
});

describe('sqlConnector — mutate builds parameterised INSERT/UPDATE/DELETE', () => {
  it('INSERT binds every value', async () => {
    const driver = stubDriver({ rows: null });
    const c = createSqlConnector({ driver });
    await c.mutate({ op: 'insert', params: { table: 'users', values: { name: 'Zoe', age: 22 } } });
    const { sql, params } = driver.calls[0];
    expect(sql).toBe('INSERT INTO users (name, age) VALUES (?, ?)');
    expect(params).toEqual(['Zoe', 22]);
  });

  it('UPDATE binds SET values then WHERE values in order', async () => {
    const driver = stubDriver({ rows: null });
    const c = createSqlConnector({ driver });
    await c.mutate({ op: 'update', params: { table: 'users', values: { name: 'Zed' }, where: { id: 5 } } });
    const { sql, params } = driver.calls[0];
    expect(sql).toBe('UPDATE users SET name = ? WHERE id = ?');
    expect(params).toEqual(['Zed', 5]);
  });

  it('DELETE binds WHERE values', async () => {
    const driver = stubDriver({ rows: null });
    const c = createSqlConnector({ driver });
    await c.mutate({ op: 'delete', params: { table: 'users', where: { id: 5 } } });
    expect(driver.calls[0].sql).toBe('DELETE FROM users WHERE id = ?');
    expect(driver.calls[0].params).toEqual([5]);
  });
});

describe('sqlConnector — error mapping + describe', () => {
  it('a driver throw → E_CONNECTOR_TRANSPORT', async () => {
    const c = createSqlConnector({ driver: stubDriver({ throwErr: new Error('connection lost') }) });
    await expect(c.query({ op: 'select', params: { table: 'users' } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.TRANSPORT });
  });

  it('a driver auth-ish throw → E_CONNECTOR_AUTH', async () => {
    const c = createSqlConnector({ driver: stubDriver({ throwErr: new Error('password authentication failed') }) });
    await expect(c.query({ op: 'select', params: { table: 'users' } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.AUTH });
  });

  it('an unsupported read op is rejected', async () => {
    const c = createSqlConnector({ driver: stubDriver() });
    await expect(c.query({ op: 'insert', params: { table: 'users' } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.BAD_REQUEST });
  });

  it('requires an injected driver.execute', () => {
    expect(() => createSqlConnector({ driver: {} })).toThrow(/driver\.execute/);
  });

  it('describe() reports kind:sql + dialect', () => {
    const c = createSqlConnector({ driver: stubDriver(), dialect: 'pg', id: 'main-db' });
    const d = c.describe();
    expect(d.kind).toBe('sql');
    expect(d.name).toBe('main-db');
    expect(d.schema.dialect).toBe('pg');
  });
});
