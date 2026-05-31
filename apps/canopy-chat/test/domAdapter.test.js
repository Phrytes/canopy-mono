/**
 * canopy-chat — DOM adapter tests.  v0.1 sub-slice 1.10.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { renderToDom, renderStream } from '../src/web/domAdapter.js';

const ctx = () => ({ doc: document });

describe('renderToDom — user bubble', () => {
  it('renders a user-origin message', () => {
    const el = renderToDom({ origin: 'user', text: '/mine' }, ctx());
    expect(el.classList.contains('cc-user')).toBe(true);
    const bubble = el.querySelector('.cc-bubble');
    expect(bubble.textContent).toBe('/mine');
  });
});

describe('renderToDom — shell text shape', () => {
  it('renders a shell text bubble + messageId data attr', () => {
    const el = renderToDom({
      origin: 'shell',
      rendered: {
        kind: 'text', text: '✓ done', messageId: 'm-1',
        lifecycleState: 'live', threadId: 't-1',
      },
    }, ctx());
    expect(el.classList.contains('cc-text')).toBe(true);
    expect(el.classList.contains('cc-live')).toBe(true);
    expect(el.dataset.messageId).toBe('m-1');
    expect(el.querySelector('.cc-bubble').textContent).toBe('✓ done');
  });

  it('accepts a direct RenderedReply (without origin wrapper)', () => {
    const el = renderToDom({
      kind: 'text', text: 'hi', messageId: 'x', lifecycleState: 'live',
    }, ctx());
    expect(el.classList.contains('cc-text')).toBe(true);
  });
});

describe('renderToDom — error shape', () => {
  it('renders cc-error class + error message', () => {
    const el = renderToDom({
      kind: 'error',
      text: 'oh no',
      error: { code: 'x', message: 'oh no' },
      messageId: 'm-e', lifecycleState: 'live',
    }, ctx());
    expect(el.classList.contains('cc-error')).toBe(true);
    expect(el.querySelector('.cc-error-bubble').textContent).toBe('oh no');
  });
});

describe('renderToDom — list shape', () => {
  it('renders items with labels + dataset.itemId', () => {
    const el = renderToDom({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [
        { id: 'c-1', label: 'Dishwasher', buttons: [] },
        { id: 'c-2', label: 'Bins out',   buttons: [] },
      ],
    }, ctx());
    const items = el.querySelectorAll('.cc-list-item');
    expect(items.length).toBe(2);
    expect(items[0].dataset.itemId).toBe('c-1');
    expect(items[0].querySelector('.cc-item-label').textContent).toBe('Dishwasher');
    expect(items[1].dataset.itemId).toBe('c-2');
  });

  it('renders inline keyboard buttons + onButtonTap wires click', () => {
    const onTap = vi.fn();
    const el = renderToDom({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [{
        id: 'c-1', label: 'Dishwasher',
        buttons: [{ label: 'Done', callbackData: 'markComplete:c-1' }],
      }],
    }, { doc: document, onButtonTap: onTap });
    const btn = el.querySelector('.cc-keyboard-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Done');
    expect(btn.dataset.callback).toBe('markComplete:c-1');
    btn.click();
    expect(onTap).toHaveBeenCalledWith('markComplete', 'c-1', { originMessageId: 'm-1' });
  });

  it("disabled lifecycle: buttons rendered but disabled + aria-disabled", () => {
    const onTap = vi.fn();
    const el = renderToDom({
      kind: 'list', messageId: 'm-1', lifecycleState: 'disabled',
      items: [{
        id: 'c-1', label: 'Dishwasher',
        buttons: [{ label: 'Done', callbackData: 'markComplete:c-1' }],
      }],
    }, { doc: document, onButtonTap: onTap });
    expect(el.classList.contains('cc-disabled')).toBe(true);
    const btn = el.querySelector('.cc-keyboard-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.click();
    expect(onTap).not.toHaveBeenCalled();   // disabled buttons don't dispatch
  });

  it("renders 'no items' placeholder when list empty", () => {
    const el = renderToDom({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live', items: [],
    }, ctx());
    expect(el.querySelector('.cc-list-empty').textContent).toBe('(no items)');
  });
});

describe('renderToDom — defensive paths', () => {
  it('throws when ctx.doc missing', () => {
    expect(() => renderToDom({ kind: 'text', text: 'x' }, {})).toThrow(/doc/);
  });

  it('renders an unsupported message envelope without throwing', () => {
    const el = renderToDom({ weird: 'payload' }, ctx());
    expect(el.textContent).toContain('unsupported message');
  });
});

describe('renderToDom — quick-reply pill row (α.5a, audit #3)', () => {
  it('renders one pill per quickReplies entry with the supplied labels', () => {
    const el = renderToDom({
      kind: 'text', text: 'Coming over?', messageId: 'm-qr', lifecycleState: 'live',
      quickReplies: [
        { label: 'Ja',  slash: '/yes' },
        { label: 'Nee', slash: '/no'  },
      ],
    }, { doc: document, onQuickReply: () => {} });
    const pills = el.querySelectorAll('.cc-quick-reply-btn');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toBe('Ja');
    expect(pills[1].textContent).toBe('Nee');
    expect(pills[0].dataset.slash).toBe('/yes');
    expect(pills[1].dataset.slash).toBe('/no');
  });

  it('tapping pill 0 dispatches its slash exactly once via onQuickReply', () => {
    const onQuickReply = vi.fn();
    const el = renderToDom({
      kind: 'text', text: 'Coming over?', messageId: 'm-qr', lifecycleState: 'live',
      quickReplies: [
        { label: 'Ja',  slash: '/yes' },
        { label: 'Nee', slash: '/no'  },
      ],
    }, { doc: document, onQuickReply });
    const pills = el.querySelectorAll('.cc-quick-reply-btn');
    pills[0].click();
    expect(onQuickReply).toHaveBeenCalledTimes(1);
    expect(onQuickReply).toHaveBeenCalledWith('/yes');
  });

  it('omits the pill row when quickReplies is absent', () => {
    const el = renderToDom({
      kind: 'text', text: 'plain', messageId: 'm-1', lifecycleState: 'live',
    }, { doc: document, onQuickReply: () => {} });
    expect(el.querySelector('.cc-quick-replies')).toBeNull();
  });

  it('does not render the pill row in the disabled state', () => {
    const el = renderToDom({
      kind: 'text', text: 'old reply', messageId: 'm-x', lifecycleState: 'disabled',
      quickReplies: [{ label: 'Ja', slash: '/yes' }],
    }, { doc: document, onQuickReply: () => {} });
    expect(el.querySelector('.cc-quick-replies')).toBeNull();
  });
});

describe('renderStream', () => {
  it('replaces container children with rendered messages in order', () => {
    const container = document.createElement('div');
    renderStream(container, [
      { origin: 'user',  text: 'hi' },
      { origin: 'shell', rendered: { kind: 'text', text: 'hello', messageId: 'm', lifecycleState: 'live' } },
    ], ctx());
    const children = container.querySelectorAll('.cc-message');
    expect(children.length).toBe(2);
    expect(children[0].classList.contains('cc-user')).toBe(true);
    expect(children[1].classList.contains('cc-text')).toBe(true);
  });

  it('idempotent — second call clears + re-renders', () => {
    const container = document.createElement('div');
    renderStream(container, [{ origin: 'user', text: 'a' }], ctx());
    renderStream(container, [{ origin: 'user', text: 'b' }], ctx());
    const bubbles = container.querySelectorAll('.cc-bubble');
    expect(bubbles.length).toBe(1);
    expect(bubbles[0].textContent).toBe('b');
  });
});
