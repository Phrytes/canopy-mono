/**
 * @canopy/webid-discovery — WebID-profile pointer-walk + resolution.
 *
 * Public exports:
 *   - `discoverPointers(webidUri, { fetch })`    — fetch WebID profile + parse pointer predicates.
 *   - `resolvePointers(pointers, { read })`      — fetch each pointed-at resource via the reader.
 *   - `WebIdCache`                                — in-memory cache with heartbeat refresh.
 *   - `WEBID_PREDICATES`                          — full IRIs of the pointer predicates this substrate understands.
 */

export { discoverPointers }   from './src/discoverPointers.js';
export { resolvePointers }    from './src/resolvePointers.js';
export { WebIdCache }         from './src/WebIdCache.js';
export { WEBID_PREDICATES }   from './src/predicates.js';
