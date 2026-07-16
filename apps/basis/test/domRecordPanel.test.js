/**
 * basis — DOM record/mini-page panel tests.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { renderToDom } from '../src/web/domAdapter.js';

const ctx = (overrides = {}) => ({
  doc: document, ...overrides,
});

describe('renderToDom — record panel', () => {
  it('renders title bar + field rows + close button', () => {
    const onCloseMessage = vi.fn();
    const el = renderToDom({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      title:  'Household',
      fields: [
        { name: 'memberCount', value: 3,    kind: 'number'  },
        { name: 'polite',      value: true, kind: 'boolean' },
      ],
    }, ctx({ onCloseMessage }));

    expect(el.classList.contains('cc-record')).toBe(true);
    expect(el.classList.contains('cc-live')).toBe(true);
    expect(el.querySelector('.cc-panel-title span').textContent).toBe('Household');

    // Field rows in a definition list
    const names  = [...el.querySelectorAll('dt.cc-field-name')].map((d) => d.textContent);
    const values = [...el.querySelectorAll('dd.cc-field-value')].map((d) => d.textContent);
    expect(names).toEqual(['memberCount', 'polite']);
    expect(values).toEqual(['3', 'true']);

    // Close button wired
    const btn = el.querySelector('.cc-panel-close');
    expect(btn).not.toBeNull();
    btn.click();
    expect(onCloseMessage).toHaveBeenCalledWith('m-1');
  });

  it('omits close button when onCloseMessage not provided', () => {
    const el = renderToDom({
      kind: 'record', messageId: 'm', lifecycleState: 'live',
      title: 'T', fields: [],
    }, ctx());   // no onCloseMessage
    expect(el.querySelector('.cc-panel-close')).toBeNull();
  });

  it("renders 'no fields' placeholder when fields[] is empty", () => {
    const el = renderToDom({
      kind: 'record', messageId: 'm', lifecycleState: 'live',
      title: 'Empty', fields: [],
    }, ctx());
    expect(el.querySelector('.cc-panel-empty').textContent).toBe('(no fields)');
  });

  it("disabled lifecycle does NOT apply to record (lives until close)", () => {
    const el = renderToDom({
      kind: 'record', messageId: 'm', lifecycleState: 'live',
      title: 'X', fields: [],
    }, ctx({ onCloseMessage: () => {} }));
    expect(el.classList.contains('cc-live')).toBe(true);
    expect(el.classList.contains('cc-disabled')).toBe(false);
  });

  it("closed state collapses to one-liner + omits fields", () => {
    const el = renderToDom({
      kind: 'record', messageId: 'm', lifecycleState: 'closed',
      title: 'Household', fields: [{ name: 'x', value: 1, kind: 'number' }],
    }, ctx({ onCloseMessage: () => {} }));
    expect(el.classList.contains('cc-closed')).toBe(true);
    expect(el.querySelector('.cc-panel-collapsed').textContent).toMatch(/closed: Household/);
    expect(el.querySelector('.cc-panel-fields')).toBeNull();
  });

  it("title-less panel shows bare close button", () => {
    const el = renderToDom({
      kind: 'record', messageId: 'm', lifecycleState: 'live',
      fields: [{ name: 'x', value: 1, kind: 'number' }],
    }, ctx({ onCloseMessage: () => {} }));
    expect(el.querySelector('.cc-panel-title')).toBeNull();
    expect(el.querySelector('.cc-panel-close-bare')).not.toBeNull();
  });
});

describe('renderToDom — mini-page (same renderer, different class)', () => {
  it("uses cc-mini-page class", () => {
    const el = renderToDom({
      kind: 'mini-page', messageId: 'm', lifecycleState: 'live',
      title: 'X', fields: [],
    }, ctx());
    expect(el.classList.contains('cc-mini-page')).toBe(true);
    expect(el.classList.contains('cc-record')).toBe(false);
  });
});
