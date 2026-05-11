/**
 * @canopy/pseudo-pod — Solid-shaped local store substrate.
 *
 * V0 (Phase 52.2): standalone + replication-ring modes.
 * V1 (Phase 52.8): cache mode (write-through queue + read-miss-through)
 *                  + per-URI mode overrides.
 *
 * See:
 *   - `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.2 + §52.8
 *   - `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §4.1
 */

export { createPseudoPod }          from './src/PseudoPod.js';
export { createMemoryBackend }      from './src/MemoryBackend.js';
export { createWriteThroughQueue, QUEUE_PREFIX as WRITE_THROUGH_QUEUE_PREFIX }
                                    from './src/writeThroughQueue.js';
