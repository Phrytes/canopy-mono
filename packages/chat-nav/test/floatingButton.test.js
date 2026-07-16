/**
 * @onderling/chat-nav — floating back-to-chat button tests.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  renderFloatingButton, removeFloatingButton,
} from '../src/floatingButton.js';

beforeEach(() => {
  // Reset DOM
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('renderFloatingButton', () => {
  it('appends a floating button with the default label', () => {
    const btn = renderFloatingButton(document.body, { returnTo: 'main' });
    expect(btn.textContent).toBe('← back to chat');
    expect(btn.classList.contains('canopy-chat-nav-back-button')).toBe(true);
    expect(document.querySelector('.canopy-chat-nav-back-button')).toBe(btn);
  });

  it('appends to document.body by default when host omitted', () => {
    renderFloatingButton(undefined, { returnTo: 'main' });
    expect(document.body.querySelector('.canopy-chat-nav-back-button')).not.toBeNull();
  });

  it("custom label + chatPath flow through", () => {
    const btn = renderFloatingButton(document.body, {
      returnTo: 't-7', chatPath: '/c', label: 'Back ↩',
    });
    expect(btn.textContent).toBe('Back ↩');
    expect(btn.dataset.href).toBe('/c?focus=t-7');
  });

  it('click → calls onNavigate with the chat href', () => {
    const onNavigate = vi.fn();
    const btn = renderFloatingButton(document.body, {
      returnTo: 'main', chatPath: '/chat', onNavigate,
    });
    btn.click();
    expect(onNavigate).toHaveBeenCalledWith('/chat?focus=main');
  });

  it('URL-encodes the thread id in the href', () => {
    const btn = renderFloatingButton(document.body, {
      returnTo: 'a b', chatPath: '/chat',
    });
    expect(btn.dataset.href).toBe('/chat?focus=a%20b');
  });

  it('is idempotent — second call replaces the first', () => {
    const a = renderFloatingButton(document.body, { returnTo: 'one' });
    const b = renderFloatingButton(document.body, { returnTo: 'two' });
    expect(document.querySelectorAll('.canopy-chat-nav-back-button').length).toBe(1);
    expect(b).not.toBe(a);
    expect(document.querySelector('.canopy-chat-nav-back-button').dataset.href)
      .toBe('/?focus=two');
  });

  it('rejects missing / empty returnTo', () => {
    expect(() => renderFloatingButton(document.body, {})).toThrow();
    expect(() => renderFloatingButton(document.body, { returnTo: '' })).toThrow();
    expect(() => renderFloatingButton(document.body, { returnTo: 42 })).toThrow();
  });

  it('rejects missing opts', () => {
    expect(() => renderFloatingButton(document.body)).toThrow(/opts required/);
  });

  it('host accepts arbitrary parents (not just body)', () => {
    const aside = document.createElement('aside');
    document.body.appendChild(aside);
    const btn = renderFloatingButton(aside, { returnTo: 'main' });
    expect(aside.contains(btn)).toBe(true);
    expect(document.body.querySelectorAll('.canopy-chat-nav-back-button').length)
      .toBe(1);
  });
});

describe('removeFloatingButton', () => {
  it('removes a previously-rendered button', () => {
    renderFloatingButton(document.body, { returnTo: 'main' });
    expect(document.querySelector('.canopy-chat-nav-back-button')).not.toBeNull();
    removeFloatingButton(document.body);
    expect(document.querySelector('.canopy-chat-nav-back-button')).toBeNull();
  });

  it("is a no-op when no button exists", () => {
    expect(() => removeFloatingButton(document.body)).not.toThrow();
  });

  it("scopes to the given host", () => {
    const a = document.createElement('section'); document.body.appendChild(a);
    const b = document.createElement('section'); document.body.appendChild(b);
    renderFloatingButton(a, { returnTo: '1' });
    renderFloatingButton(b, { returnTo: '2' });
    removeFloatingButton(a);
    expect(a.querySelector('.canopy-chat-nav-back-button')).toBeNull();
    expect(b.querySelector('.canopy-chat-nav-back-button')).not.toBeNull();
  });
});
