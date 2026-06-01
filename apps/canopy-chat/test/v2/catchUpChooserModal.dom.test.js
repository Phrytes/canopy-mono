// @vitest-environment happy-dom
/**
 * ε.6 — catchUpChooserModal DOM tests.
 *
 * Drives the modal through the three button paths (per-mode accept,
 * Cancel, backdrop click) and the resolveContact-name fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderCatchUpChooser } from '../../web/v2/catchUpChooserModal.js';

// Translator stub: echoes "key" and key parameters back so tests can
// assert on params without depending on a real locale bundle.
const t = (key, params) => {
  if (params == null) return key;
  if (params.kring != null) return `${key}:${params.kring}`;
  if (params.count != null) return `${key}:${params.count}`;
  if (params.kb    != null) return `${key}:${params.kb}`;
  if (params.when  != null) return `${key}:${params.when}`;
  return key;
};

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function mkOffer(from, { count = 5, sizeBytes = 1024, lastTs = 1000 } = {}) {
  return {
    from,
    offer: {
      requestId: 'rq1',
      count, sizeBytes, lastTs,
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('renderCatchUpChooser · ε.6', () => {
  it('renders one card per offer (3 offers → 3 cards)', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1'), mkOffer('addr2'), mkOffer('addr3')],
      circleId: 'g1', circleName: 'Kring 1',
      t, onResolve: () => {},
    });
    const cards = el.querySelectorAll('.catch-up-chooser__offer');
    expect(cards).toHaveLength(3);
    expect(cards[0].dataset.offerFrom).toBe('addr1');
    expect(cards[2].dataset.offerFrom).toBe('addr3');
  });

  it('each card has 3 mode buttons (All / Last 50 / Last 7 days)', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve: () => {},
    });
    const card = el.querySelector('.catch-up-chooser__offer');
    const buttons = card.querySelectorAll('.catch-up-chooser__mode');
    expect(buttons).toHaveLength(3);
    expect([...buttons].map((b) => b.dataset.mode)).toEqual(['all', 'last-50', 'last-7-days']);
  });

  it("clicking [All] on offer #1 → onResolve({accept:{offerFrom:'addr1', mode:'all'}})", () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1'), mkOffer('addr2')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const firstAllBtn = el.querySelector('.catch-up-chooser__offer[data-offer-from="addr1"] .catch-up-chooser__mode--all');
    firstAllBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toEqual({ accept: { offerFrom: 'addr1', mode: 'all' } });
  });

  it("clicking [Last 50] on offer #2 → emits mode 'last-50'", () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1'), mkOffer('addr2')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const btn = el.querySelector('.catch-up-chooser__offer[data-offer-from="addr2"] .catch-up-chooser__mode--last-50');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({ accept: { offerFrom: 'addr2', mode: 'last-50' } });
  });

  it("clicking [Last 7 days] → emits mode 'last-7-days'", () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const btn = el.querySelector('.catch-up-chooser__mode--last-7-days');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({ accept: { offerFrom: 'addr1', mode: 'last-7-days' } });
  });

  it('clicking [Cancel] → onResolve({decline: true})', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const cancel = el.querySelector('.catch-up-chooser__cancel');
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({ decline: true });
  });

  it('backdrop click → onResolve({decline: true})', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    // Click on the container itself (backdrop), not on the sheet.
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({ decline: true });
  });

  it('sheet click does NOT cancel (no propagation to backdrop)', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const sheet = el.querySelector('.catch-up-chooser__sheet');
    sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('provider name uses resolveContact() when it returns a name', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      resolveContact: (addr) => addr === 'addr1' ? { displayName: 'Alice' } : null,
      t, onResolve: () => {},
    });
    const name = el.querySelector('.catch-up-chooser__offer-name');
    expect(name.textContent).toBe('Alice');
  });

  it('provider name falls back to short addr when resolveContact returns null', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('aaaaaaaabbbbbbbbcccccccc')],
      circleId: 'g1', circleName: 'Kring',
      resolveContact: () => null,
      t, onResolve: () => {},
    });
    const name = el.querySelector('.catch-up-chooser__offer-name');
    // Short form: 'aaaaaaaa…ccccc' (first 8 + '…' + last 6).
    expect(name.textContent).toBe('aaaaaaaa…cccccc');
  });

  it('title key includes the circleName param', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'De Buurt',
      t, onResolve: () => {},
    });
    const title = el.querySelector('.catch-up-chooser__title');
    expect(title.textContent).toBe('circle.chat.catch_up.chooser_title:De Buurt');
  });

  it('subtitle param carries the offer count', () => {
    const el = mount();
    renderCatchUpChooser(el, {
      offers: [mkOffer('a'), mkOffer('b'), mkOffer('c')],
      circleId: 'g1', circleName: 'K', t, onResolve: () => {},
    });
    const sub = el.querySelector('.catch-up-chooser__subtitle');
    expect(sub.textContent).toBe('circle.chat.catch_up.chooser_subtitle:3');
  });

  it('ESC key triggers decline', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({ decline: true });
  });

  it('resolves only once even if buttons clicked twice (settled flag)', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderCatchUpChooser(el, {
      offers: [mkOffer('addr1')],
      circleId: 'g1', circleName: 'Kring',
      t, onResolve,
    });
    const btn = el.querySelector('.catch-up-chooser__mode--all');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});
