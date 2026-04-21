import { describe, it, expect } from 'vitest';
import { TextPart, DataPart, FilePart, ImagePart, Parts } from '../src/Parts.js';

describe('TextPart', () => {
  it('creates a TextPart', () => {
    expect(TextPart('hello')).toEqual({ type: 'TextPart', text: 'hello' });
  });
});

describe('DataPart', () => {
  it('creates a DataPart', () => {
    const d = { key: 'value' };
    expect(DataPart(d)).toEqual({ type: 'DataPart', data: d });
  });
});

describe('FilePart', () => {
  it('creates a FilePart with all fields', () => {
    const p = FilePart({ mimeType: 'image/png', name: 'img.png', data: 'abc=', url: 'http://x' });
    expect(p.type).toBe('FilePart');
    expect(p.mimeType).toBe('image/png');
    expect(p.name).toBe('img.png');
    expect(p.data).toBe('abc=');
    expect(p.url).toBe('http://x');
  });

  it('omits undefined optional fields', () => {
    const p = FilePart({ mimeType: 'text/plain' });
    expect('name' in p).toBe(false);
    expect('data' in p).toBe(false);
    expect('url'  in p).toBe(false);
  });
});

describe('ImagePart', () => {
  it('creates an ImagePart', () => {
    expect(ImagePart({ mimeType: 'image/jpeg', data: 'base64data' }))
      .toEqual({ type: 'ImagePart', mimeType: 'image/jpeg', data: 'base64data' });
  });
});

describe('Parts.text', () => {
  it('returns first TextPart text', () => {
    expect(Parts.text([DataPart({}), TextPart('hi'), TextPart('bye')])).toBe('hi');
  });

  it('returns null when no TextPart', () => {
    expect(Parts.text([DataPart({})])).toBeNull();
    expect(Parts.text([])).toBeNull();
    expect(Parts.text(null)).toBeNull();
  });
});

describe('Parts.data', () => {
  it('merges DataPart.data fields (later wins)', () => {
    const parts = [DataPart({ a: 1, b: 2 }), DataPart({ b: 99, c: 3 })];
    expect(Parts.data(parts)).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('returns null when no DataPart', () => {
    expect(Parts.data([TextPart('x')])).toBeNull();
    expect(Parts.data([])).toBeNull();
  });
});

describe('Parts.files', () => {
  it('returns all FileParts', () => {
    const parts = [TextPart('x'), FilePart({ mimeType: 'a' }), FilePart({ mimeType: 'b' })];
    expect(Parts.files(parts)).toHaveLength(2);
  });

  it('returns empty array when none', () => {
    expect(Parts.files([TextPart('x')])).toEqual([]);
    expect(Parts.files(null)).toEqual([]);
  });
});

describe('Parts.images', () => {
  it('returns all ImageParts', () => {
    const parts = [ImagePart({ mimeType: 'image/png', data: 'x' })];
    expect(Parts.images(parts)).toHaveLength(1);
  });
});

describe('Parts.wrap', () => {
  it('wraps string → [TextPart]', () => {
    expect(Parts.wrap('hello')).toEqual([TextPart('hello')]);
  });

  it('wraps plain object → [DataPart]', () => {
    expect(Parts.wrap({ x: 1 })).toEqual([DataPart({ x: 1 })]);
  });

  it('wraps Uint8Array → [FilePart]', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const parts = Parts.wrap(arr);
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('FilePart');
    expect(parts[0].mimeType).toBe('application/octet-stream');
  });

  it('passes through Part[] unchanged', () => {
    const parts = [TextPart('x'), DataPart({ y: 2 })];
    expect(Parts.wrap(parts)).toBe(parts);
  });
});

describe('Parts.artifact', () => {
  it('builds artifact object', () => {
    const parts = [TextPart('result')];
    expect(Parts.artifact('out', parts)).toEqual({ name: 'out', parts });
  });
});

describe('Parts.isValid', () => {
  it('returns true for valid parts array', () => {
    expect(Parts.isValid([TextPart('x'), DataPart({})])).toBe(true);
    expect(Parts.isValid([])).toBe(true);
  });

  it('returns false for non-array or unknown type', () => {
    expect(Parts.isValid(null)).toBe(false);
    expect(Parts.isValid('str')).toBe(false);
    expect(Parts.isValid([{ type: 'Unknown' }])).toBe(false);
    expect(Parts.isValid([{}])).toBe(false);
  });
});
