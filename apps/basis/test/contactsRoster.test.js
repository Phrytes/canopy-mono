/**
 * contactsRoster — the Contacten roster DOM render (feedback-extension).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactsRoster } from '../web/v2/contactsRoster.js';

const ctx = (over = {}) => ({ doc: document, t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), ...over });

describe('renderContactsRoster', () => {
  it('renders a bot row with the 🤖 icon + skill count + an open button', () => {
    const onOpen = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'https://bot.example', name: 'Feedback bot', isBot: true, skillCount: 2, reachable: true }],
      t: (k, v) => (v ? `${k}:${v.count}` : k), onOpen,
    });
    const row = el.querySelector('.cc-contacts__row--bot');
    expect(row).not.toBeNull();
    expect(row.dataset.contactId).toBe('https://bot.example');
    expect(row.querySelector('.cc-contacts__icon').textContent).toBe('🤖');
    expect(row.querySelector('.cc-contacts__name').textContent).toBe('Feedback bot');
    expect(row.querySelector('.cc-contacts__meta').textContent).toContain('circle.contacts.skills:2');

    row.querySelector('.cc-contacts__open').click();
    expect(onOpen).toHaveBeenCalledWith('https://bot.example');
  });

  it('a person row uses 👤 and clicking the row opens the thread', () => {
    const onOpen = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'PK', name: 'Alice', isBot: false, skillCount: 0, reachable: true }],
      ...ctx(), onOpen,
    });
    const row = el.querySelector('.cc-contacts__row');
    expect(row.querySelector('.cc-contacts__icon').textContent).toBe('👤');
    expect(row.className).not.toContain('--bot');
    row.click();
    expect(onOpen).toHaveBeenCalledWith('PK');
  });

  it('shows a ContactBook person’s trust level + tags in the meta (S1 #2)', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'w', name: 'Alice', isBot: false, reachable: true, trustLevel: 'vertrouwd', tags: ['buur', 'klusser'] }],
      t: (k) => k,
    });
    const meta = el.querySelector('.cc-contacts__meta').textContent;
    expect(meta).toContain('circle.contacts.trust.vertrouwd');
    expect(meta).toContain('buur, klusser');
  });

  it('marks an unreachable contact offline', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'PK', name: 'Bob', isBot: false, reachable: false }], ...ctx(),
    });
    const row = el.querySelector('.cc-contacts__row');
    expect(row.classList.contains('is-offline')).toBe(true);
    expect(row.querySelector('.cc-contacts__meta').textContent).toContain('circle.contacts.offline');
  });

  it('shows the empty state when there are no contacts', () => {
    const el = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx() });
    expect(el.querySelector('.cc-contacts__empty').textContent).toBe('circle.contacts.empty');
    expect(el.querySelector('.cc-contacts__list')).toBeNull();
  });

  it('renders an "Add a bot" button only when onAdd is supplied, and fires it', () => {
    const onAdd = vi.fn();
    const without = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx() });
    expect(without.querySelector('.cc-contacts__add')).toBeNull();

    const withAdd = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx(), onAdd });
    const btn = withAdd.querySelector('.cc-contacts__add');
    expect(btn.textContent).toBe('circle.contacts.add');
    btn.click();
    expect(onAdd).toHaveBeenCalled();
  });
});
