import { describe, it, expect } from 'vitest';
import { createRestConnector } from '../src/connectors/rest.js';
import { bearerAuth, apiKeyAuth, basicAuth } from '../src/auth.js';
import { ConnectorErrorCode } from '../src/errors.js';
import { stubFetch } from './helpers.js';

const ROUTES = {
  getUser:   { method: 'GET',  path: 'users/:id' },
  listUsers: { method: 'GET',  path: 'users' },
  addUser:   { method: 'POST', path: 'users' },
};

describe('restConnector — request building (offline, stub fetch)', () => {
  it('maps query({op,params}) → GET with path param + leftover params as query string', async () => {
    const fetch = stubFetch({ json: { id: 7, name: 'Ada' } });
    const c = createRestConnector({ baseUrl: 'https://api.test/v1', routes: ROUTES, fetch });

    const res = await c.query({ op: 'getUser', params: { id: 7, expand: 'roles' } });

    expect(fetch.calls).toHaveLength(1);
    const { url, init } = fetch.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toBe('https://api.test/v1/users/7?expand=roles');
    expect(res.data).toEqual({ id: 7, name: 'Ada' });
    expect(res.meta.status).toBe(200);
  });

  it('maps a POST op → JSON body from leftover params + content-type', async () => {
    const fetch = stubFetch({ status: 201, json: { id: 9 } });
    const c = createRestConnector({ baseUrl: 'https://api.test/v1', routes: ROUTES, fetch });

    await c.mutate({ op: 'addUser', params: { name: 'Bo' } });

    const { url, init } = fetch.calls[0];
    expect(init.method).toBe('POST');
    expect(url).toBe('https://api.test/v1/users');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ name: 'Bo' });
  });

  it('supports a describe-driven buildRequest override', async () => {
    const fetch = stubFetch({ json: [] });
    const c = createRestConnector({
      baseUrl: 'https://api.test',
      fetch,
      buildRequest: (op, params) => ({ method: 'GET', path: 'search', query: { q: params.q, kind: op } }),
    });
    await c.query({ op: 'find', params: { q: 'hello world' } });
    expect(fetch.calls[0].url).toBe('https://api.test/search?q=hello+world&kind=find');
  });

  it('rejects an unknown op with E_CONNECTOR_BAD_REQUEST', async () => {
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch: stubFetch() });
    await expect(c.query({ op: 'nope', params: {} })).rejects.toMatchObject({ code: ConnectorErrorCode.BAD_REQUEST });
  });
});

describe('restConnector — applies the INJECTED auth strategy to the outgoing request', () => {
  it('bearerAuth → Authorization: Bearer on the wire', async () => {
    const fetch = stubFetch({ json: {} });
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch, auth: bearerAuth('TKN') });
    await c.query({ op: 'listUsers', params: {} });
    expect(fetch.calls[0].init.headers.authorization).toBe('Bearer TKN');
  });

  it('apiKeyAuth → the configured header on the wire', async () => {
    const fetch = stubFetch({ json: {} });
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch, auth: apiKeyAuth({ header: 'x-api-key', key: 'K' }) });
    await c.query({ op: 'listUsers', params: {} });
    expect(fetch.calls[0].init.headers['x-api-key']).toBe('K');
  });

  it('basicAuth → Authorization: Basic on the wire', async () => {
    const fetch = stubFetch({ json: {} });
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch, auth: basicAuth({ user: 'u', pass: 'p' }) });
    await c.query({ op: 'listUsers', params: {} });
    expect(fetch.calls[0].init.headers.authorization).toBe('Basic dTpw'); // base64('u:p')
  });
});

describe('restConnector — HTTP status → error CODE mapping', () => {
  const mk = (resp) => createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch: stubFetch(resp) });

  it('401 → E_CONNECTOR_AUTH', async () => {
    await expect(mk({ ok: false, status: 401 }).query({ op: 'listUsers', params: {} }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.AUTH, status: 401 });
  });
  it('403 → E_CONNECTOR_AUTH', async () => {
    await expect(mk({ ok: false, status: 403 }).query({ op: 'listUsers', params: {} }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.AUTH });
  });
  it('404 → E_CONNECTOR_NOT_FOUND', async () => {
    await expect(mk({ ok: false, status: 404 }).query({ op: 'getUser', params: { id: 1 } }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.NOT_FOUND });
  });
  it('400 → E_CONNECTOR_BAD_REQUEST', async () => {
    await expect(mk({ ok: false, status: 400 }).query({ op: 'listUsers', params: {} }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.BAD_REQUEST });
  });
  it('500 → E_CONNECTOR_TRANSPORT', async () => {
    await expect(mk({ ok: false, status: 500 }).query({ op: 'listUsers', params: {} }))
      .rejects.toMatchObject({ code: ConnectorErrorCode.TRANSPORT });
  });
  it('a thrown fetch (network) → E_CONNECTOR_TRANSPORT', async () => {
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch: stubFetch({ throw: new Error('ECONNREFUSED') }) });
    await expect(c.query({ op: 'listUsers', params: {} })).rejects.toMatchObject({ code: ConnectorErrorCode.TRANSPORT });
  });
});

describe('restConnector — describe()', () => {
  it('reports kind:rest and the configured ops', () => {
    const c = createRestConnector({ baseUrl: 'https://api.test', routes: ROUTES, fetch: stubFetch(), id: 'users-api' });
    const d = c.describe();
    expect(d.kind).toBe('rest');
    expect(d.name).toBe('users-api');
    expect(d.schema.ops).toContain('getUser');
  });
});
