/**
 * Bundle H Phase 2 (#269) — file-share handler coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleFileShare } from '../../src/core/handlers/fileShare.js';

function deps(overrides = {}) {
  return {
    addMainBubble: vi.fn(),
    publishEvent:  vi.fn(),
    logger:        { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('makeHandleFileShare', () => {
  it('throws when addMainBubble missing', () => {
    expect(() => makeHandleFileShare({})).toThrow(/addMainBubble required/);
  });

  it('drops envelopes missing file fields', () => {
    const d = deps();
    const handle = makeHandleFileShare(d);
    handle('peer-A', null);
    handle('peer-A', { file: { id: 'f1' } });
    handle('peer-A', { file: { id: 'f1', name: 'a.txt' } });
    expect(d.addMainBubble).not.toHaveBeenCalled();
  });

  it('renders a file-card embed + publishes a notification', () => {
    const d = deps();
    const handle = makeHandleFileShare(d);
    handle('peer-A', {
      file: { id: 'f1', name: 'recipe.md', mime: 'text/markdown', size: 1024, dataB64: 'aGVsbG8=' },
    });
    expect(d.addMainBubble).toHaveBeenCalledTimes(1);
    const bubble = d.addMainBubble.mock.calls[0][0];
    expect(bubble.kind).toBe('embed-card');
    expect(bubble.embed.kind).toBe('file-card');
    expect(bubble.embed.snapshot.name).toBe('recipe.md');
    expect(bubble.embed.snapshot.dataB64).toBe('aGVsbG8=');
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      app: 'folio', type: 'notification',
    }));
  });
});
