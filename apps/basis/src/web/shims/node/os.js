/**
 * Browser-safe shim for `node:os`.
 *
 * Aliased via vite.config.js → resolve.alias.  Static imports come from
 * pod-client's `FileTombstones` (which is re-exported from pod-client's
 * index.js and so leaks into any build graph that touches pod-client) and
 * folio's CLI/service paths (already cut off by other aliases or by not
 * being imported from browser entry points).
 *
 * Browser code never executes these: FileTombstones is the Node tombstone
 * adapter; the browser uses IndexedDBTombstones (passed via opts).
 */

const browserStub = (name) => () => {
  throw new Error(`[node:os.${name}] called in the browser bundle — should be unreachable`);
};

export const homedir   = browserStub('homedir');
export const platform  = () => 'browser';
export const tmpdir    = () => '/tmp';
export const hostname  = () => 'browser';
export const arch      = () => 'unknown';
export const cpus      = () => [];
export const totalmem  = () => 0;
export const freemem   = () => 0;
export const networkInterfaces = () => ({});
export const userInfo  = browserStub('userInfo');
export const release   = () => '0.0.0';
export const type      = () => 'Browser';
export const EOL       = '\n';

export default {
  homedir, platform, tmpdir, hostname, arch, cpus,
  totalmem, freemem, networkInterfaces, userInfo, release, type, EOL,
};
