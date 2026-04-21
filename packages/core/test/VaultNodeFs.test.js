import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VaultNodeFs }  from '../src/identity/VaultNodeFs.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { tmpdir }        from 'node:os';
import { join }          from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomBytes }   from 'node:crypto';

function tmpPath() {
  return join(tmpdir(), `vault-test-${randomBytes(6).toString('hex')}.json`);
}

describe('VaultNodeFs (unencrypted)', () => {
  let path;

  beforeEach(() => { path = tmpPath(); });
  afterEach(() => { try { rmSync(path); } catch { /**/ } });

  it('set / get', async () => {
    const v = new VaultNodeFs(path);
    await v.set('k', 'hello');
    expect(await v.get('k')).toBe('hello');
  });

  it('returns null for missing key', async () => {
    expect(await new VaultNodeFs(path).get('missing')).toBeNull();
  });

  it('delete removes entry', async () => {
    const v = new VaultNodeFs(path);
    await v.set('k', 'v');
    await v.delete('k');
    expect(await v.get('k')).toBeNull();
    expect(await v.has('k')).toBe(false);
  });

  it('list returns all keys', async () => {
    const v = new VaultNodeFs(path);
    await v.set('a', '1');
    await v.set('b', '2');
    expect((await v.list()).sort()).toEqual(['a', 'b']);
  });

  it('persists across instances', async () => {
    const v1 = new VaultNodeFs(path);
    await v1.set('key', 'persisted');
    const v2 = new VaultNodeFs(path);
    expect(await v2.get('key')).toBe('persisted');
  });
});

describe('VaultNodeFs (encrypted)', () => {
  let path;

  beforeEach(() => { path = tmpPath(); });
  afterEach(() => { try { rmSync(path); } catch { /**/ } });

  it('set / get round-trip', async () => {
    const v = new VaultNodeFs(path, 'secret-pass');
    await v.set('k', 'value');
    expect(await v.get('k')).toBe('value');
  });

  it('file does not contain plaintext value', async () => {
    const v = new VaultNodeFs(path, 'secret-pass');
    await v.set('token', 'super-secret-token-12345');
    const raw = (await import('node:fs')).readFileSync(path, 'utf8');
    expect(raw).not.toContain('super-secret-token-12345');
  });

  it('persists and decrypts correctly across instances', async () => {
    const v1 = new VaultNodeFs(path, 'my-pass');
    await v1.set('key', 'value');
    const v2 = new VaultNodeFs(path, 'my-pass');
    expect(await v2.get('key')).toBe('value');
  });

  it('works as AgentIdentity vault', async () => {
    const v = new VaultNodeFs(path, 'agent-pass');
    const id1 = await AgentIdentity.generate(v);

    const v2  = new VaultNodeFs(path, 'agent-pass');
    const id2 = await AgentIdentity.restore(v2);

    expect(id2.pubKey).toBe(id1.pubKey);
  });
});
