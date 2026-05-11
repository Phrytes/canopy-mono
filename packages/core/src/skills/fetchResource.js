/**
 * fetch-resource — generic peer-fetch skill factory.
 *
 * Core ships the **skill shape**; the substrate (typically
 * `@canopy/pseudo-pod`) supplies the **storage backing** via the
 * injected `read` callback. This way core never imports the
 * pseudo-pod substrate (strict layering: apps → substrates → core).
 *
 * Typical use:
 *
 *   import { makeFetchResourceSkill } from '@canopy/core';
 *   const skill = makeFetchResourceSkill({
 *     read: (uri) => pseudoPod.read(uri),     // pseudo-pod consumer
 *   });
 *   agent.skills.register(skill);
 *   //   or:
 *   //   agent.register(skill.id, skill.handler, skill.opts);
 *
 * Caller protocol (other side of the wire):
 *
 *   const parts = await agent.callSkill({
 *     target: peerAddress,
 *     skill:  'fetch-resource',
 *     args:   { uri: 'https://anne.pod/sharing/tasks/abc.ttl' },
 *   });
 *   // parts[0] is a DataPart with `{ uri, bytes, etag? }`
 *
 * The factory is intentionally minimal — it owns the wire contract
 * (input shape, error codes, output shape) but does not assume
 * anything about the storage layer.
 *
 * Standardisation Phase 50.3 — see
 * `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.
 */

import { defineSkill } from './defineSkill.js';
import { DataPart }    from '../Parts.js';

/**
 * @typedef {object} FetchResourceResult
 * @property {string} uri          — echoed back for the caller's convenience
 * @property {Uint8Array|string|object} bytes — the resource value
 * @property {string} [etag]       — optional etag if the storage layer tracks one
 */

/**
 * @param {object} opts
 * @param {(uri: string) => Promise<*|null>} opts.read
 *   Storage-backed reader.  Returns the resource value (any shape) on hit,
 *   `null`/`undefined` on miss.  Errors propagate to the caller as a
 *   `NOT_READABLE` skill error.
 * @param {string}   [opts.id='fetch-resource'] — skill id; override to namespace.
 * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility='authenticated']
 *   Standard skill-visibility tier.  Default matches the SDK's
 *   "only hello'd peers see this" posture.
 * @param {string}   [opts.description]   — human-readable override.
 *
 * @returns {ReturnType<typeof defineSkill>} a skill definition ready
 *          to register with `agent.skills.register(...)` (or to use
 *          via `agent.register(id, handler, opts)`).
 */
export function makeFetchResourceSkill({
  read,
  id          = 'fetch-resource',
  visibility  = 'authenticated',
  description = "Fetch a local resource by URI via the agent's pseudo-pod backing",
} = {}) {
  if (typeof read !== 'function') {
    throw Object.assign(
      new Error('makeFetchResourceSkill: `read` must be a function'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const handler = async ({ parts }) => {
    const uri = _extractUri(parts);
    if (!uri) {
      throw Object.assign(
        new Error(`${id}: requires { uri: string }`),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    let value;
    try {
      value = await read(uri);
    } catch (err) {
      throw Object.assign(
        new Error(`${id}: read failed for ${uri}: ${err?.message ?? err}`),
        { code: 'NOT_READABLE', uri, cause: err },
      );
    }

    if (value === undefined || value === null) {
      throw Object.assign(
        new Error(`${id}: no resource at ${uri}`),
        { code: 'NOT_FOUND', uri },
      );
    }

    // Allow callers to return either a raw value or `{ bytes, etag }`
    // for storage layers that track etags.  Normalise to a uniform shape.
    let bytes, etag;
    if (value && typeof value === 'object' && 'bytes' in value) {
      bytes = value.bytes;
      etag  = value.etag;
    } else {
      bytes = value;
    }

    return [DataPart({ uri, bytes, ...(etag != null ? { etag } : {}) })];
  };

  return defineSkill(id, handler, {
    description,
    visibility,
    tags: ['core', 'pseudo-pod', 'storage'],
  });
}

/**
 * Pull a `uri` out of skill input parts.
 *
 * Accepts:
 *   - `[DataPart({ uri })]`
 *   - `[TextPart('the-uri')]`  (convenience — naked URI in a text part)
 *
 * @param {Array} parts
 * @returns {string|null}
 */
function _extractUri(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  for (const p of parts) {
    if (p?.type === 'DataPart' && typeof p.data?.uri === 'string') return p.data.uri;
    if (p?.type === 'TextPart' && typeof p.text === 'string')      return p.text;
  }
  return null;
}
