/**
 * pickDocument — substrate coverage (#267).  Exercises the
 * SDK 50+ assets-shape and the legacy SDK <50 success-shape;
 * cancel; multi-asset; per-asset read-failure; pickOneDocument.
 */

import { describe, it, expect, vi } from 'vitest';
import { pickDocument, pickOneDocument } from '../../src/picker/pickDocument.js';

function makeStubModules(overrides = {}) {
  const DocumentPicker = {
    getDocumentAsync: vi.fn(async () => ({
      canceled: false,
      assets: [{
        uri:      'file:///cache/note.txt',
        name:     'note.txt',
        size:     12,
        mimeType: 'text/plain',
      }],
    })),
  };
  const FileSystem = {
    EncodingType: { Base64: 'base64' },
    readAsStringAsync: vi.fn(async (uri) => `b64-of-${uri}`),
  };
  return {
    DocumentPicker: { ...DocumentPicker, ...(overrides.DocumentPicker ?? {}) },
    FileSystem:     { ...FileSystem,     ...(overrides.FileSystem     ?? {}) },
  };
}

describe('pickDocument — SDK 50+ assets shape', () => {
  it('returns the picked document with base64 bytes', async () => {
    const _modules = makeStubModules();
    const out = await pickDocument({ _modules });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      name:    'note.txt',
      mime:    'text/plain',
      bytes:   12,
      dataB64: 'b64-of-file:///cache/note.txt',
    });
    expect(_modules.DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
  });

  it('returns [] when the picker is canceled', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({ canceled: true })) },
    });
    const out = await pickDocument({ _modules });
    expect(out).toEqual([]);
  });

  it('reads multiple assets when multiple=true', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({
        canceled: false,
        assets: [
          { uri: 'file:///a.txt', name: 'a.txt', size: 1, mimeType: 'text/plain' },
          { uri: 'file:///b.pdf', name: 'b.pdf', size: 2, mimeType: 'application/pdf' },
        ],
      })) },
    });
    const out = await pickDocument({ multiple: true, _modules });
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.name)).toEqual(['a.txt', 'b.pdf']);
  });

  it('falls back to derived bytes when size is missing', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file:///x', name: 'x', mimeType: 'application/octet-stream' }],
      })) },
      FileSystem: {
        EncodingType: { Base64: 'base64' },
        readAsStringAsync: vi.fn(async () => 'ABCD'),
      },
    });
    const out = await pickDocument({ _modules });
    expect(out[0].bytes).toBe(Math.floor(4 * 0.75));
  });

  it('skips assets whose read throws', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({
        canceled: false,
        assets: [
          { uri: 'file:///good', name: 'good', size: 3, mimeType: 'text/plain' },
          { uri: 'file:///bad',  name: 'bad',  size: 3, mimeType: 'text/plain' },
        ],
      })) },
      FileSystem: {
        EncodingType: { Base64: 'base64' },
        readAsStringAsync: vi.fn(async (uri) => {
          if (uri === 'file:///bad') throw new Error('I/O error');
          return 'ok';
        }),
      },
    });
    const out = await pickDocument({ multiple: true, _modules });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('good');
  });
});

describe('pickDocument — legacy SDK <50 success shape', () => {
  it('normalises {type:"success", uri, name, size, mimeType} to the assets shape', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({
        type:     'success',
        uri:      'file:///legacy.txt',
        name:     'legacy.txt',
        size:     7,
        mimeType: 'text/plain',
      })) },
    });
    const out = await pickDocument({ _modules });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('legacy.txt');
    expect(out[0].dataB64).toBe('b64-of-file:///legacy.txt');
  });

  it('treats legacy cancel ({type:"cancel"}) as []', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({ type: 'cancel' })) },
    });
    const out = await pickDocument({ _modules });
    expect(out).toEqual([]);
  });
});

describe('pickOneDocument', () => {
  it('returns the first picked doc', async () => {
    const _modules = makeStubModules();
    const one = await pickOneDocument({ _modules });
    expect(one?.name).toBe('note.txt');
  });

  it('returns null on cancel', async () => {
    const _modules = makeStubModules({
      DocumentPicker: { getDocumentAsync: vi.fn(async () => ({ canceled: true })) },
    });
    const one = await pickOneDocument({ _modules });
    expect(one).toBeNull();
  });
});
