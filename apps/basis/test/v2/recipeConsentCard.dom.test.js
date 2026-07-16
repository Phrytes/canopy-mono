// @vitest-environment happy-dom
/**
 * recipeConsentCard — B · consent-card (web DOM). The reviewed apply-recipe card:
 * renders what the recipe would enable + opt-out checkboxes, and resolves Agree/Decline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderRecipeConsentCard } from '../../web/v2/recipeConsentCard.js';

const t = (k) => k;

// A review model like buildRecipeConsentModel would return: two enabled caps (one mandatory, one
// opt-outable), a feature, a setting, and the opt-outable cap in `consent.items`.
const model = () => ({
  enabledCaps: [
    { key: 'tasks add task',      app: 'tasks', atom: 'add',      noun: 'task' },
    { key: 'tasks complete task', app: 'tasks', atom: 'complete', noun: 'task' },
  ],
  features: ['tasks'],
  settings: [{ key: 'tasks.reminders', value: true }],
  consent: {
    keys: ['tasks complete task'],
    items: [{ key: 'tasks complete task', app: 'tasks', atom: 'complete', noun: 'task', optedOut: false }],
  },
});

beforeEach(() => { document.body.innerHTML = ''; });

describe('renderRecipeConsentCard', () => {
  it('renders the enabled caps/features/settings and one opt-out checkbox for the opt-outable cap', () => {
    renderRecipeConsentCard(model(), { t });
    const card = document.querySelector('.recipe-consent-card');
    expect(card).not.toBeNull();
    // mandatory cap listed (no checkbox); opt-outable cap NOT in the plain list (it's a checkbox row)
    const enables = card.querySelector('.recipe-consent-card__enables');
    expect(enables.querySelector('[data-cap="tasks add task"]')).not.toBeNull();
    expect(enables.querySelector('[data-cap="tasks complete task"]')).toBeNull();
    expect(enables.querySelector('[data-feature="tasks"]')).not.toBeNull();
    expect(enables.querySelector('[data-setting="tasks.reminders"]')).not.toBeNull();
    // exactly one opt-out checkbox, checked (keep-on) by default
    const boxes = card.querySelectorAll('input[type=checkbox][data-opt-cap]');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].dataset.optCap).toBe('tasks complete task');
    expect(boxes[0].checked).toBe(true);
  });

  it('Agree with nothing unchecked yields empty declinedKeys', () => {
    const onAgree = vi.fn();
    renderRecipeConsentCard(model(), { t, onAgree });
    document.querySelector('.recipe-consent-card__agree').click();
    expect(onAgree).toHaveBeenCalledWith({ declinedKeys: [] });
    // the modal closes on Agree
    expect(document.querySelector('.recipe-consent-overlay')).toBeNull();
  });

  it('unchecking an optional cap declines it on Agree', () => {
    const onAgree = vi.fn();
    renderRecipeConsentCard(model(), { t, onAgree });
    const box = document.querySelector('input[data-opt-cap="tasks complete task"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    document.querySelector('.recipe-consent-card__agree').click();
    expect(onAgree).toHaveBeenCalledWith({ declinedKeys: ['tasks complete task'] });
  });

  it('Decline calls onDecline, not onAgree, and closes', () => {
    const onAgree = vi.fn();
    const onDecline = vi.fn();
    renderRecipeConsentCard(model(), { t, onAgree, onDecline });
    // Decline is the first (non-agree) action button
    const declineBtn = [...document.querySelectorAll('.recipe-consent-card button')]
      .find((b) => !b.classList.contains('recipe-consent-card__agree'));
    declineBtn.click();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
    expect(document.querySelector('.recipe-consent-overlay')).toBeNull();
  });

  it('pre-declined opt-outable caps start unchecked', () => {
    const m = model();
    m.consent.items[0].optedOut = true;
    renderRecipeConsentCard(m, { t });
    expect(document.querySelector('input[data-opt-cap="tasks complete task"]').checked).toBe(false);
  });
});
