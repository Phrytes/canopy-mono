/**
 * canopy-chat — pod-sync thread persistence.
 *
 * Stub for v0.2.4.  Multi-device thread sync via the user's pod
 * lands in v0.6 per OQ-3 user resolution (2026-05-21): "yes,
 * dependent on pod — without pod there is no real user/profile
 * connection between devices (yet)".
 *
 * Interface mirrors IndexedDBStore (loadAll / saveThread /
 * deleteThread / clear) so the future implementation can swap in
 * without changing call sites.  v0.2.4 ships the stub so the
 * persistence wiring in main.js can compose 'local first; pod when
 * a pod is configured'.
 *
 * Phase v0.2 sub-slice 2.8 per `/Project Files/canopy-chat/coding-plan.md`.
 */

const NOT_IMPL = () => {
  throw new Error(
    'PodSyncStore is not implemented yet — lands in v0.6 (see ' +
    'Project Files/canopy-chat/coding-plan.md § Phase v0.6).  Use ' +
    'IndexedDBStore for v0.2 thread persistence.',
  );
};

export class PodSyncStore {
  // eslint-disable-next-line no-unused-vars
  constructor(_opts = {}) {
    // No-op; the moment any method is called it throws.
  }

  async loadAll()              { return NOT_IMPL(); }
  async saveThread(_thread)    { return NOT_IMPL(); }
  async deleteThread(_id)      { return NOT_IMPL(); }
  async clear()                { return NOT_IMPL(); }
  async close()                { /* allowed — symmetry with IndexedDBStore */ }
}
