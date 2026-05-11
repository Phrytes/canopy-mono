/**
 * StorageBackend — the abstract storage interface that `PseudoPod`
 * delegates to.
 *
 * Implementations:
 *   - `MemoryBackend`       — in-process Map (this package, V0 default + tests).
 *   - RN AsyncStorage / SQLite backend — `@canopy/react-native` Phase 51.1.
 *   - Pod-attached backend  — Phase 52.8 (V1 cache mode).
 *
 * The interface is intentionally narrow. A backend stores opaque
 * `{bytes, etag}` records keyed by string. `bytes` is whatever the
 * caller wrote — the backend doesn't parse it.
 *
 * `*dirty*` methods exist for V1 cache-mode (pending-pod-upload
 * tracking) — V0 backends can return empty/no-op shapes.
 *
 * Standardisation Phase 52.2 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 *
 * @typedef {object} StoredRecord
 * @property {*} bytes        — payload (any value)
 * @property {string} [etag]  — opaque etag string
 *
 * @typedef {object} StorageBackend
 * @property {(key: string) => Promise<StoredRecord|null>}  get
 * @property {(key: string, bytes: *, etag?: string) => Promise<string>} put
 *           — returns the new etag.
 * @property {(key: string) => Promise<void>}               delete
 * @property {(prefix: string) => Promise<string[]>}        list
 *           — keys with the given prefix.
 * @property {(prefix: string, cb: (event: BackendEvent) => void) => () => void} subscribe
 *           — subscribe to changes under a prefix; returns an unsubscribe fn.
 * @property {() => Promise<string[]>}                      listDirty
 *           — keys flagged as "needs replication / upload".
 * @property {(cb: (event: BackendEvent) => void) => () => void} subscribeDirty
 *           — subscribe to dirty-set changes; returns unsubscribe.
 *
 * @typedef {object} BackendEvent
 * @property {'put'|'delete'|'dirty'|'clean'} op
 * @property {string} key
 * @property {string} [etag]
 */

export {};
