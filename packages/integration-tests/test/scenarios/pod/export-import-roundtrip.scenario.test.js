/**
 * Scenario: pod/export-import-roundtrip
 *
 * Story: A user wants to back up their pod and restore it on a fresh
 * Solid server.  The C3 PodExporter walks the source pod, packs every
 * resource into a portable archive (deterministic byte order); the C3
 * PodImporter reads that archive into an empty pod.  After roundtrip:
 *   - every resource in the source exists in the destination with the
 *     same content + content-type;
 *   - re-exporting the destination produces a byte-identical archive
 *     (deterministic export = no information loss);
 *   - the SHA-256 digest of the archive matches across exports
 *     (the "manifest contentHash" mentioned in the strategy doc).
 *
 * Lab setup: two MockPods (source + destination), wrapped in a tiny
 * SolidPodSource-shaped adapter PodExporter / PodImporter understand.
 * MockPod's `list()` returns immediate children only (matching Solid LDP),
 * but PodExporter performs its own BFS — we adapt list() to mark
 * containers vs resources for the walker.
 *
 * Assertion: byte-equal archive + per-URI byte-equal content.
 */
import { describe, it, expect } from 'vitest';

import { PodExporter, PodImporter } from '@canopy/core';
import { MockPod }                  from '../../../src/_harness/index.js';

const POD_ROOT  = 'https://alice.example/';
const FIXED_AT  = '2026-04-28T00:00:00.000Z';

/**
 * Wrap a MockPod with a SolidPodSource-shaped adapter that adds the
 * `type: 'container'|'resource'` discriminator PodExporter's BFS walker
 * uses.  Only IMMEDIATE children of `containerUri` are returned — exactly
 * the Solid LDP contract the exporter is coded against.
 */
function makeWalkAdapter(mock, podRoot) {
  return {
    podRoot,
    /** Only immediate children, with type tags. */
    list: async (containerUri) => {
      const prefix = containerUri.endsWith('/') ? containerUri : containerUri + '/';
      const seenContainers = new Set();
      const out = [];
      for (const uri of mock.uris()) {
        if (!uri.startsWith(prefix) || uri === containerUri) continue;
        const tail = uri.slice(prefix.length);
        const slash = tail.indexOf('/');
        if (slash === -1) {
          // Direct resource child.
          const r = await mock.read(uri);
          out.push({ uri, type: 'resource', contentType: r.contentType });
        } else {
          // Belongs to a sub-container — emit the container once.
          const containerChild = prefix + tail.slice(0, slash + 1);
          if (!seenContainers.has(containerChild)) {
            seenContainers.add(containerChild);
            out.push({ uri: containerChild, type: 'container' });
          }
        }
      }
      // Stable order so the exporter's per-entry sort is deterministic
      // even before its internal sort kicks in.
      out.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
      return { container: containerUri, entries: out };
    },
    read: async (uri, opts) => {
      const r = await mock.read(uri, opts);
      // PodExporter uses { decode: 'binary' } to stay lossless.
      return {
        content:      r.content instanceof Uint8Array ? r.content
                       : typeof r.content === 'string' ? new TextEncoder().encode(r.content)
                       : new Uint8Array(r.content),
        contentType:  r.contentType,
        lastModified: r.lastModified,
        etag:         r.etag,
        size:         (r.content?.byteLength ?? r.content?.length ?? 0),
      };
    },
    write: async (uri, content, opts) => mock.write(uri, content, opts),
    delete: async (uri, opts)         => mock.delete(uri, opts),
    exists: async (uri)               => mock.exists(uri),
  };
}

function arrayEq(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function populateFixturePod(mock, root) {
  // Heterogeneous content: turtle, plaintext, JSON, raw bytes — proves
  // round-trip is content-agnostic.
  await mock.write(root + 'profile/card', '<#me> a foaf:Person.', { contentType: 'text/turtle' });
  await mock.write(root + 'notes/hello.txt',  'hello world',         { contentType: 'text/plain' });
  await mock.write(root + 'notes/bye.txt',    'goodbye',             { contentType: 'text/plain' });
  await mock.write(root + 'data/blob.bin',    new Uint8Array([1, 2, 3, 4, 0xff]),
                                              { contentType: 'application/octet-stream' });
  await mock.write(root + 'tasks/list.json',  '{"tasks":[1,2,3]}',   { contentType: 'application/json' });
}

describe('pod/export-import-roundtrip', () => {
  it('export → import → re-export produces byte-equal archives (deterministic + lossless)', async () => {
    // ── Source pod with 5 heterogeneous resources ──────────────────────
    const srcMock = new MockPod();
    await populateFixturePod(srcMock, POD_ROOT);

    const srcAdapter = makeWalkAdapter(srcMock, POD_ROOT);
    const exporter   = new PodExporter({ podClient: srcAdapter, podRoot: POD_ROOT });

    // Use FIXED exportedAt so the header is byte-stable across calls;
    // unencrypted export is deterministic when entries are stable-sorted.
    const archive1 = await exporter.export({ encrypt: false, exportedAt: FIXED_AT });
    expect(archive1).toBeInstanceOf(Uint8Array);
    expect(archive1.byteLength).toBeGreaterThan(0);

    // ── Determinism: same source → same archive bytes ──────────────────
    const archive1b = await exporter.export({ encrypt: false, exportedAt: FIXED_AT });
    expect(arrayEq(archive1, archive1b)).toBe(true);

    // ── manifest contentHash: SHA-256 digest matches across re-exports ─
    const digest1  = await exporter.digest({ encrypt: false, exportedAt: FIXED_AT });
    const digest1b = await exporter.digest({ encrypt: false, exportedAt: FIXED_AT });
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
    expect(digest1).toBe(digest1b);

    // ── Import into a FRESH empty pod ──────────────────────────────────
    const dstMock    = new MockPod();
    expect(dstMock.resourceCount()).toBe(0);
    const dstAdapter = makeWalkAdapter(dstMock, POD_ROOT);
    const importer   = new PodImporter({ podClient: dstAdapter, podRoot: POD_ROOT });
    const result     = await importer.import(archive1);

    expect(result.errors).toEqual([]);
    expect(result.entriesWritten).toBe(5);
    expect(result.header.encrypted).toBe(false);
    expect(result.header.entryCount).toBe(5);

    // ── Per-URI content equality: every src resource is in dst, identical ─
    for (const uri of srcMock.uris()) {
      expect(dstMock.hasResource(uri), `dst missing ${uri}`).toBe(true);
      const a = srcMock.contentOf(uri);
      const b = dstMock.contentOf(uri);
      // Coerce both to bytes for comparison (writes accept strings, etc.).
      const aBytes = a instanceof Uint8Array ? a
                   : typeof a === 'string'   ? new TextEncoder().encode(a)
                   : new Uint8Array(a);
      const bBytes = b instanceof Uint8Array ? b
                   : typeof b === 'string'   ? new TextEncoder().encode(b)
                   : new Uint8Array(b);
      expect(arrayEq(aBytes, bBytes), `bytes mismatch at ${uri}`).toBe(true);
    }

    // ── Roundtrip envelope-equality: re-exporting dst yields the SAME archive ─
    const dstExporter = new PodExporter({ podClient: dstAdapter, podRoot: POD_ROOT });
    const archive2    = await dstExporter.export({ encrypt: false, exportedAt: FIXED_AT });
    expect(arrayEq(archive1, archive2)).toBe(true);

    // ── contentHash equality across pods (the "manifest contentHash matches" check) ─
    const digest2 = await dstExporter.digest({ encrypt: false, exportedAt: FIXED_AT });
    expect(digest2).toBe(digest1);
  });

  it('exports an empty pod cleanly and imports into a fresh empty pod (no-op roundtrip)', async () => {
    const srcMock = new MockPod();
    const exporter = new PodExporter({
      podClient: makeWalkAdapter(srcMock, POD_ROOT),
      podRoot:   POD_ROOT,
    });
    const archive = await exporter.export({ encrypt: false, exportedAt: FIXED_AT });

    const dstMock = new MockPod();
    const importer = new PodImporter({
      podClient: makeWalkAdapter(dstMock, POD_ROOT),
      podRoot:   POD_ROOT,
    });
    const result = await importer.import(archive);

    expect(result.entriesWritten).toBe(0);
    expect(result.header.entryCount).toBe(0);
    expect(dstMock.resourceCount()).toBe(0);
  });
});
