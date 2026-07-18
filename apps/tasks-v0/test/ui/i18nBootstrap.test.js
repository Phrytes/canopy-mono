/**
 * Post-V0 follow-up — runtime locale loader for tasks-v0 web.
 * Tests cover: unwrapLeaves, interpolation, key fallback, language
 * switch, DOM walker over data-i18n* attributes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  bootI18n, t, setLang, currentLang,
  walkAndTranslate, unwrapLeaves, __reset,
} from '../../src/ui/i18nBootstrap.js';

// Minimal DOM polyfill via happy-dom would be nicer, but the existing
// tasks-v0 vitest setup doesn't ship one.  Use a tiny stub that
// implements the methods walkAndTranslate calls.
function makeStubEl(tag, opts = {}) {
  const attrs = new Map(Object.entries(opts.attrs ?? {}));
  const children = [];
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    textContent: opts.textContent ?? '',
    innerHTML:   opts.innerHTML   ?? '',
    get attributes() {
      return Array.from(attrs.entries()).map(([name, value]) => ({ name, value }));
    },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    children,
    querySelectorAll(selector) {
      return _querySelectorAll(el, selector);
    },
    appendChild(child) { children.push(child); return child; },
  };
  return el;
}

function _querySelectorAll(root, selector) {
  // Very tiny matcher — handles `[data-foo]`, `[data-i18n-attr-...]`
  // (prefix match via `data-i18n-attr-` substring), or `*` for "all".
  const match = (el) => {
    if (selector === '*') return true;
    const m = selector.match(/^\[([\w-]+)\]$/);
    if (m) return el.getAttribute?.(m[1]) !== null && el.getAttribute(m[1]) !== undefined;
    return false;
  };
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (match(node)) out.push(node);
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  if (Array.isArray(root.children)) for (const c of root.children) walk(c);
  return out;
}

beforeEach(() => __reset());

describe('unwrapLeaves', () => {
  it('unwraps {text, doc} leaves to bare strings', () => {
    const r = unwrapLeaves({
      foo: { text: 'Foo', doc: 'a foo' },
      bar: {
        baz: { text: 'Baz' },
        qux: 'not-a-leaf',
      },
      arr: [{ text: 'A' }, { text: 'B', doc: 'two' }],
    });
    expect(r).toEqual({
      foo: 'Foo',
      bar: { baz: 'Baz', qux: 'not-a-leaf' },
      arr: ['A', 'B'],
    });
  });

  it('passes through plain values + non-leaf objects', () => {
    expect(unwrapLeaves('hi')).toBe('hi');
    expect(unwrapLeaves(42)).toBe(42);
    expect(unwrapLeaves(null)).toBeNull();
    // text + EXTRA keys → not a leaf, recurse.
    expect(unwrapLeaves({ text: 'x', other: 'y' })).toEqual({ text: 'x', other: 'y' });
  });
});

describe('bootI18n + t', () => {
  it('translates keys after boot', async () => {
    const enJson = { greeting: { text: 'Hello' } };
    const nlJson = { greeting: { text: 'Hallo' } };
    const fetch = vi.fn(async (url) => ({
      json: async () => url.endsWith('en.json') ? enJson : nlJson,
    }));
    await bootI18n({ _inject: { fetch } });
    expect(t('greeting')).toBe('Hello');
  });

  it('returns the key when called before boot', () => {
    expect(t('greeting')).toBe('greeting');
  });

  it('falls back to fallbackLng when missing in current language', async () => {
    const fetch = vi.fn(async (url) => ({
      json: async () => url.endsWith('en.json')
        ? { greeting: { text: 'Hello' } }
        : {},                          // nl has no entries
    }));
    await bootI18n({ lng: 'nl', _inject: { fetch } });
    expect(currentLang()).toBe('nl');
    expect(t('greeting')).toBe('Hello');  // fallback en
  });

  it('returns the raw key when missing in both languages', async () => {
    const fetch = vi.fn(async () => ({ json: async () => ({}) }));
    await bootI18n({ _inject: { fetch } });
    expect(t('mystery.path')).toBe('mystery.path');
  });

  it('interpolates {{var}}', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ msg: { text: 'Hi {{name}}!' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    expect(t('msg', { name: 'Anne' })).toBe('Hi Anne!');
  });

  it('renders {{missing}} literally when interpolation key is absent', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ msg: { text: 'Hi {{name}}!' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    expect(t('msg', {})).toBe('Hi {{name}}!');
  });

  it('boot is idempotent', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ greeting: { text: 'Hello' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    await bootI18n({ _inject: { fetch } });
    expect(fetch).toHaveBeenCalledTimes(2);  // 2 fetches per boot (en + nl), 1 boot
  });
});

describe('setLang', () => {
  it('switches the active language', async () => {
    const fetch = vi.fn(async (url) => ({
      json: async () => url.endsWith('en.json')
        ? { x: { text: 'X-en' } }
        : { x: { text: 'X-nl' } },
    }));
    await bootI18n({ _inject: { fetch } });
    expect(t('x')).toBe('X-en');
    await setLang('nl');
    expect(t('x')).toBe('X-nl');
    expect(currentLang()).toBe('nl');
  });

  it('silently no-ops on an unknown language', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ x: { text: 'X' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    await setLang('fr');
    expect(currentLang()).toBe('en');
  });
});

describe('walkAndTranslate', () => {
  it('swaps textContent for [data-i18n] elements', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ hello: { text: 'Hello' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    const root  = makeStubEl('div');
    const child = makeStubEl('span', { attrs: { 'data-i18n': 'hello' } });
    root.appendChild(child);
    walkAndTranslate(root);
    expect(child.textContent).toBe('Hello');
  });

  it('swaps innerHTML for [data-i18n-html]', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ rich: { text: '<b>Hi</b>' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    const root  = makeStubEl('div');
    const child = makeStubEl('div', { attrs: { 'data-i18n-html': 'rich' } });
    root.appendChild(child);
    walkAndTranslate(root);
    expect(child.innerHTML).toBe('<b>Hi</b>');
  });

  it('sets attributes from data-i18n-attr-<name>', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ ph: { text: 'Type here' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    const root = makeStubEl('div');
    const input = makeStubEl('input', { attrs: { 'data-i18n-attr-placeholder': 'ph' } });
    root.appendChild(input);
    walkAndTranslate(root);
    expect(input.getAttribute('placeholder')).toBe('Type here');
  });

  it('honours data-i18n-params for interpolation', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({ msg: { text: 'Hi {{name}}!' } }),
    }));
    await bootI18n({ _inject: { fetch } });
    const root = makeStubEl('div');
    const el = makeStubEl('span', {
      attrs: { 'data-i18n': 'msg', 'data-i18n-params': '{"name":"Bob"}' },
    });
    root.appendChild(el);
    walkAndTranslate(root);
    expect(el.textContent).toBe('Hi Bob!');
  });

  it('safe-no-op on a null/undefined root', () => {
    expect(() => walkAndTranslate(null)).not.toThrow();
    expect(() => walkAndTranslate(undefined)).not.toThrow();
  });
});
