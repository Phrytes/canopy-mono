// SQL/DB connector (Objective S, v0) — maps a source-agnostic `query({op, params})` onto a
// parameterised SQL statement executed by an INJECTED `driver`. No real pg/mysql/sqlite is
// bundled: any driver satisfying `{ execute(sql, params) => rows }` plugs in.
//
//   createSqlConnector({ driver, dialect?, id? }) => DataConnector
//
// INJECTION SAFETY (the load-bearing property): user values are NEVER string-interpolated into
// SQL. The builder emits placeholders (`?` for mysql/sqlite, `$1..$n` for pg) and hands the values
// to the driver as a SEPARATE bound array. So a `where: { name: "x'; DROP TABLE users; --" }` stays
// a single bound parameter — it can never become SQL. Identifiers (table/column names) CANNOT be
// bound by any driver, so they are validated against a strict `[A-Za-z_][A-Za-z0-9_]*` allow-list
// and rejected otherwise.

import { ConnectorError, ConnectorErrorCode } from '../errors.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** Assert an identifier (table/column) is a safe bareword — never trust it into SQL otherwise. */
function ident(name, what = 'identifier') {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, `sqlConnector: unsafe ${what} \`${name}\``);
  }
  return name;
}

/** A placeholder factory per dialect. pg uses positional `$n`; mysql/sqlite use `?`. */
function placeholders(dialect) {
  if (dialect === 'pg' || dialect === 'postgres' || dialect === 'postgresql') {
    let n = 0;
    return () => `$${++n}`;
  }
  return () => '?';
}

/**
 * Build a WHERE clause from an equality map, pushing every VALUE onto `bound` (never into the SQL).
 * @returns {string} the ' WHERE ...' fragment (or '' when empty)
 */
function buildWhere(where, bound, ph) {
  const keys = Object.keys(where || {});
  if (keys.length === 0) return '';
  const conds = keys.map((k) => `${ident(k, 'column')} = ${ph()}`);
  for (const k of keys) bound.push(where[k]);
  return ` WHERE ${conds.join(' AND ')}`;
}

/**
 * @param {object} cfg
 * @param {{ execute: (sql: string, params: any[]) => (Promise<any[]> | any[]) }} cfg.driver  INJECTED
 * @param {'mysql'|'sqlite'|'pg'|'postgres'|string} [cfg.dialect]  placeholder style (default: '?' style)
 * @param {string} [cfg.id]
 * @returns {import('../types.js').DataConnector}
 */
export function createSqlConnector({ driver, dialect = 'sqlite', id = 'sql' } = {}) {
  if (!driver || typeof driver.execute !== 'function') {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'createSqlConnector: an injected `driver.execute(sql, params)` is required');
  }

  /** Run through the injected driver, mapping any driver throw → E_CONNECTOR_TRANSPORT. */
  async function exec(sql, bound) {
    try {
      const rows = await driver.execute(sql, bound);
      return rows;
    } catch (cause) {
      const code = /auth|password|permission|denied/i.test(cause?.message || '')
        ? ConnectorErrorCode.AUTH
        : ConnectorErrorCode.TRANSPORT;
      throw new ConnectorError(code, `sqlConnector: driver error — ${cause?.message || 'execute failed'}`, { cause });
    }
  }

  function buildSelect(params = {}) {
    const { table, columns, where, orderBy, limit } = params;
    const ph = placeholders(dialect);
    const bound = [];
    const cols = Array.isArray(columns) && columns.length
      ? columns.map((c) => ident(c, 'column')).join(', ')
      : '*';
    let sql = `SELECT ${cols} FROM ${ident(table, 'table')}`;
    sql += buildWhere(where, bound, ph);
    if (orderBy) {
      const dir = /^desc$/i.test(params.orderDir || '') ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${ident(orderBy, 'column')} ${dir}`;
    }
    if (limit != null) {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'sqlConnector: `limit` must be a non-negative integer');
      }
      sql += ` LIMIT ${ph()}`;
      bound.push(limit);
    }
    return { sql, bound };
  }

  function buildInsert(params = {}) {
    const { table, values } = params;
    const keys = Object.keys(values || {});
    if (keys.length === 0) throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'sqlConnector: insert needs `values`');
    const ph = placeholders(dialect);
    const bound = [];
    const cols = keys.map((k) => ident(k, 'column'));
    const marks = keys.map(() => ph());
    for (const k of keys) bound.push(values[k]);
    const sql = `INSERT INTO ${ident(table, 'table')} (${cols.join(', ')}) VALUES (${marks.join(', ')})`;
    return { sql, bound };
  }

  function buildUpdate(params = {}) {
    const { table, values, where } = params;
    const keys = Object.keys(values || {});
    if (keys.length === 0) throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'sqlConnector: update needs `values`');
    const ph = placeholders(dialect);
    const bound = [];
    const sets = keys.map((k) => `${ident(k, 'column')} = ${ph()}`);
    for (const k of keys) bound.push(values[k]);
    let sql = `UPDATE ${ident(table, 'table')} SET ${sets.join(', ')}`;
    sql += buildWhere(where, bound, ph);
    return { sql, bound };
  }

  function buildDelete(params = {}) {
    const { table, where } = params;
    const ph = placeholders(dialect);
    const bound = [];
    let sql = `DELETE FROM ${ident(table, 'table')}`;
    sql += buildWhere(where, bound, ph);
    return { sql, bound };
  }

  async function query(request = {}) {
    const { op = 'select', params } = request;
    if (op !== 'select') {
      throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, `sqlConnector.query: unsupported read op \`${op}\` (use mutate for writes)`);
    }
    const { sql, bound } = buildSelect(params);
    const rows = await exec(sql, bound);
    return { data: rows ?? [], meta: { sql, dialect } };
  }

  async function mutate(request = {}) {
    const { op, params } = request;
    let plan;
    if (op === 'insert') plan = buildInsert(params);
    else if (op === 'update') plan = buildUpdate(params);
    else if (op === 'delete') plan = buildDelete(params);
    else throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, `sqlConnector.mutate: unsupported op \`${op}\``);
    const rows = await exec(plan.sql, plan.bound);
    return { data: rows ?? null, meta: { sql: plan.sql, dialect } };
  }

  return {
    id,
    describe() {
      return {
        name: id,
        kind: 'sql',
        schema: { dialect, read: ['select'], write: ['insert', 'update', 'delete'] },
      };
    },
    query,
    mutate,
  };
}
