/**
 * circleNoticeboard — the prikbord surface (S1 #1). @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleNoticeboard } from '../web/v2/circleNoticeboard.js';

const t = (k) => k;

describe('renderCircleNoticeboard', () => {
  it('renders intent pills (active one marked) + composer; submit fires onPost', () => {
    const onPost = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, intent: 'offer', onPost });
    const pills = [...el.querySelectorAll('.cc-prikbord__intent')];
    expect(pills.map((p) => p.dataset.intent)).toEqual(['ask', 'offer', 'lend']);
    expect(el.querySelector('.cc-prikbord__intent.is-active').dataset.intent).toBe('offer');

    const input = el.querySelector('.cc-prikbord__input');
    input.value = '  ladder te leen  ';
    el.querySelector('.cc-prikbord__composer').dispatchEvent(new Event('submit'));
    expect(onPost).toHaveBeenCalledWith({ intent: 'offer', text: 'ladder te leen' });
    expect(input.value).toBe('');
  });

  it('an intent pill tap fires onIntent', () => {
    const onIntent = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, onIntent });
    el.querySelector('[data-intent="lend"]').click();
    expect(onIntent).toHaveBeenCalledWith('lend');
  });

  it('renders a post with type badge + text + actions; respond/report on others’ posts', () => {
    const onAction = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, onAction,
      posts: [{ id: 'p1', type: 'ask', text: 'wie heeft een boormachine?', addedByLabel: 'alice', mine: false }],
    });
    const row = el.querySelector('.cc-prikbord__post-row');
    expect(row.dataset.postId).toBe('p1');
    expect(row.querySelector('.cc-prikbord__badge--ask')).not.toBeNull();
    expect(row.querySelector('.cc-prikbord__text').textContent).toContain('boormachine');
    const actions = [...row.querySelectorAll('.cc-prikbord__chip')].map((c) => c.dataset.action);
    expect(actions).toEqual(['respond', 'report']);   // not mine → help + report; no cancel
    row.querySelector('[data-action="respond"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'respond', post: expect.objectContaining({ id: 'p1' }) });
  });

  it('my own lend post shows returned + withdraw (not respond/report)', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, posts: [{ id: 'p2', type: 'lend', text: 'mijn ladder', mine: true }],
    });
    const actions = [...el.querySelectorAll('.cc-prikbord__chip')].map((c) => c.dataset.action);
    expect(actions).toEqual(['markReturned', 'cancel']);
  });

  it('shows the empty state with no posts', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t });
    expect(el.querySelector('.cc-prikbord__empty').textContent).toBe('circle.noticeboard.empty');
    expect(el.querySelector('.cc-prikbord__list')).toBeNull();
  });

  it('shows the busy state while posting', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, busy: true });
    expect(el.querySelector('.cc-prikbord__busy').textContent).toBe('circle.noticeboard.posting');
  });
});
