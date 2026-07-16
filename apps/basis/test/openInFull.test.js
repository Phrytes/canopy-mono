/**
 * basis — E5 "⤢ Open in full" (record / mini-page → side panel).
 *
 * The record/mini-page panel grows an expand affordance when the host
 * wires `onExpandPanel`; clicking it hands the rendered reply back so
 * the host can re-host it in the wide side panel.  `openContentPanel`
 * frames an already-rendered node with a title bar + [×] (+ optional
 * chat-nav back button).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { renderToDom }       from '../src/web/domAdapter.js';
import { openContentPanel }  from '../src/web/pagePanel.js';

const miniPage = (over = {}) => ({
  kind: 'mini-page', messageId: 'm-1', lifecycleState: 'live',
  title: 'Task #42',
  fields: [{ name: 'status', value: 'open', kind: 'text' }],
  ...over,
});

describe('renderToDom — expand affordance (E5)', () => {
  it('renders the ⤢ expand button when onExpandPanel is wired', () => {
    const onExpandPanel = vi.fn();
    const el = renderToDom(miniPage(), { doc: document, onExpandPanel });
    const btn = el.querySelector('.cc-panel-expand');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('⤢');
  });

  it('omits the expand button when onExpandPanel is absent', () => {
    const el = renderToDom(miniPage(), { doc: document, onCloseMessage: vi.fn() });
    expect(el.querySelector('.cc-panel-expand')).toBeNull();
  });

  it('passes the rendered reply to onExpandPanel on click', () => {
    const onExpandPanel = vi.fn();
    const reply = miniPage();
    const el = renderToDom(reply, { doc: document, onExpandPanel });
    el.querySelector('.cc-panel-expand').click();
    expect(onExpandPanel).toHaveBeenCalledTimes(1);
    expect(onExpandPanel.mock.calls[0][0]).toMatchObject({ kind: 'mini-page', messageId: 'm-1' });
  });

  it('renders a bare-variant expand button when the reply has no title', () => {
    const onExpandPanel = vi.fn();
    const el = renderToDom(miniPage({ title: undefined }), { doc: document, onExpandPanel });
    const btn = el.querySelector('.cc-panel-expand');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('cc-panel-expand-bare')).toBe(true);
  });
});

describe('openContentPanel (E5)', () => {
  it('frames a content node with a title bar and shows the panel', () => {
    const container = document.createElement('aside');
    const content = document.createElement('div');
    content.className = 'cc-mini-page';
    content.textContent = 'hello';
    openContentPanel({ container, doc: document, content, title: 'Task #42' });
    expect(container.hidden).toBe(false);
    expect(container.querySelector('.cc-page-title').textContent).toBe('Task #42');
    expect(container.querySelector('.cc-page-body-content .cc-mini-page')).not.toBeNull();
  });

  it('closing the panel tears down its content', () => {
    const container = document.createElement('aside');
    const onClose = vi.fn();
    openContentPanel({
      container, doc: document,
      content: document.createElement('div'), title: 'X', onClose,
    });
    container.querySelector('.cc-page-close').click();
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a chat-nav back button when backTo is supplied', () => {
    const container = document.createElement('aside');
    const onNavigate = vi.fn();
    openContentPanel({
      container, doc: document, content: document.createElement('div'),
      backTo: { returnTo: 'thread-9', label: '← back', onNavigate },
    });
    const btn = container.querySelector('.basis-nav-back-button');
    expect(btn).not.toBeNull();
    btn.click();
    expect(container.hidden).toBe(true);        // teardown ran
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('throws without a content node', () => {
    const container = document.createElement('aside');
    expect(() => openContentPanel({ container, doc: document })).toThrow(/content/);
  });
});
