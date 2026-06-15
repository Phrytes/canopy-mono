/**
 * circleTabBar — the v2 bottom nav (feedback-extension P5 adds Contacten).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleTabBar } from '../web/v2/circleTabBar.js';

const t = (k) => k;

describe('renderCircleTabBar', () => {
  it('renders the four tabs in order, Contacten between Kringen and Mij', () => {
    const el = renderCircleTabBar(document.createElement('nav'), { active: 'kringen', t });
    const tabs = [...el.querySelectorAll('.circle-tabbar__tab')].map((b) => b.dataset.tab);
    expect(tabs).toEqual(['screens', 'kringen', 'contacten', 'mij']);
    expect(el.querySelector('[data-tab="kringen"]').classList.contains('is-active')).toBe(true);
  });

  it('wires onContacts to the Contacten tab', () => {
    const onContacts = vi.fn();
    const el = renderCircleTabBar(document.createElement('nav'), { active: 'contacten', t, onContacts });
    const tab = el.querySelector('[data-tab="contacten"]');
    expect(tab.classList.contains('is-active')).toBe(true);
    expect(tab.getAttribute('aria-current')).toBe('page');
    tab.click();
    expect(onContacts).toHaveBeenCalled();
  });
});
