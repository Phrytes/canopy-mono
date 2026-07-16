// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleStream } from '../../web/v2/circleStream.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const rows = [
  { id: 'e1', ts: 300, app: 'stoop',    type: 'buurt-post',   circleId: 'grp-9',  circleName: 'Block 9' },
  { id: 'e2', ts: 200, app: 'household',type: 'note-added',   circleId: null,     circleName: null },
];

describe('renderCircleStream', () => {
  it('renders a row per event with a circle tag + app·type body', () => {
    const el = mount();
    renderCircleStream(el, { rows, t });
    const rowEls = el.querySelectorAll('.circle-stream__row');
    expect(rowEls).toHaveLength(2);
    expect(el.querySelector('.circle-stream__row[data-circle-id=grp-9] .circle-stream__tag').textContent).toBe('Block 9');
    expect(el.querySelector('.circle-stream__row[data-event-id=e1] .circle-stream__body').textContent).toBe('stoop · buurt-post');
  });

  it('un-tagged rows show the untagged label and are disabled', () => {
    const el = mount();
    renderCircleStream(el, { rows, t });
    const untagged = el.querySelector('.circle-stream__row[data-event-id=e2]');
    expect(untagged.querySelector('.circle-stream__tag').textContent).toBe('circle.stream.untagged');
    expect(untagged.disabled).toBe(true);
  });

  it('tapping a circle-tagged row fires onOpenCircle with its circleId', () => {
    const el = mount();
    const onOpenCircle = vi.fn();
    renderCircleStream(el, { rows, t, onOpenCircle });
    el.querySelector('.circle-stream__row[data-circle-id=grp-9]').click();
    expect(onOpenCircle).toHaveBeenCalledWith('grp-9');
  });

  it('shows the empty state when there are no rows', () => {
    const el = mount();
    renderCircleStream(el, { rows: [], t });
    expect(el.querySelector('.circle-stream__empty').textContent).toBe('circle.stream.empty');
  });

  it('shows the loading state', () => {
    const el = mount();
    renderCircleStream(el, { loading: true, t });
    expect(el.querySelector('.circle-stream__loading')).not.toBeNull();
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleStream(el, { rows, t, onBack });
    el.querySelector('.circle-stream__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
