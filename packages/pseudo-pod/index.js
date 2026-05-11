/**
 * @canopy/pseudo-pod — Solid-shaped local store substrate.
 *
 * V0 surface (standalone + replication-ring modes; cache mode lives
 * in V1 — Phase 52.8).
 *
 * See:
 *   - `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.2
 *   - `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §4.1
 */

export { createPseudoPod }   from './src/PseudoPod.js';
export { createMemoryBackend } from './src/MemoryBackend.js';
