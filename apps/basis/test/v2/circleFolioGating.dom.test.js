// @vitest-environment happy-dom
/**
 * circleFolio — B · capability gating of the FILE-OPEN row action.
 *
 * The drive browser's only per-file row-action is "open the file" (the row is a
 * button firing `onOpen`) → the `get` atom on noun 'file'. This proves it now
 * runs through the SAME capability gate as the list surface's row buttons:
 *   - a DENIED member (get×file disabled) has the row greyed (disabled, no open)
 *     or hidden (omitted) per the admin's consequence;
 *   - a GRANTED member gets the row exactly as before (clickable → onOpen).
 * Navigation + lens toggles are NOT capability ops and stay ungated.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleFolioBrowser } from '../../web/v2/circleFolio.js';
import { folioFileOpenTreatment } from '../../src/v2/circleFolio.js';
import { folioManifest } from '../../../folio/manifest.js';
import { buildCapabilityMatrix, capabilityKey } from '@onderling/app-manifest';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const files = [
  { id: 'f1', name: 'plan.md',   updatedAt: 300 },
  { id: 'f2', name: 'notes.txt', updatedAt: 200 },
];

/** Matrix where the (get × file) capability is disabled with a given consequence. */
function denyOpen(consequence) {
  return buildCapabilityMatrix([{ manifest: folioManifest }], {
    template: { [capabilityKey('folio', 'get', 'file')]: { enabled: false, consequence } },
  });
}

describe('folioFileOpenTreatment (shared seam)', () => {
  it('an empty matrix ⇒ show (granted / not gated — unchanged behaviour)', () => {
    expect(folioFileOpenTreatment({ capabilityMatrix: [] })).toBe('show');
  });
  it('a greyed-consequence deny ⇒ grey', () => {
    expect(folioFileOpenTreatment({ capabilityMatrix: denyOpen('greyed') })).toBe('grey');
  });
  it('a hidden-consequence deny ⇒ hide', () => {
    expect(folioFileOpenTreatment({ capabilityMatrix: denyOpen('hidden') })).toBe('hide');
  });
});

describe('renderCircleFolioBrowser — file-OPEN row action is capability-gated', () => {
  it('GRANTED: the row is clickable and fires onOpen (exactly as today)', () => {
    const el = mount();
    const onOpen = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onOpen, capabilityMatrix: [], appOrigin: 'folio' });
    const row = el.querySelector('.circle-folio__row[data-file-id=f1]');
    expect(row).not.toBeNull();
    expect(row.disabled).toBe(false);
    row.click();
    expect(onOpen).toHaveBeenCalledWith(files[0]);
  });

  it('DENIED (greyed): the row is rendered disabled + greyed and does NOT fire onOpen', () => {
    const el = mount();
    const onOpen = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onOpen, capabilityMatrix: denyOpen('greyed'), appOrigin: 'folio' });
    const row = el.querySelector('.circle-folio__row[data-file-id=f1]');
    expect(row).not.toBeNull();
    expect(row.disabled).toBe(true);
    expect(row.classList.contains('circle-folio__row--denied')).toBe(true);
    row.click();                                   // a disabled button does not dispatch its handler
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('DENIED (hidden): the file rows are omitted entirely', () => {
    const el = mount();
    const onOpen = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onOpen, capabilityMatrix: denyOpen('hidden'), appOrigin: 'folio' });
    expect(el.querySelectorAll('.circle-folio__row')).toHaveLength(0);
  });

  it('NAVIGATION is NOT gated: filter + back controls still render when open is denied', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files, t, onFilter: vi.fn(), onBack: vi.fn(), capabilityMatrix: denyOpen('hidden'), appOrigin: 'folio' });
    expect(el.querySelectorAll('.circle-folio__filter')).toHaveLength(3);
    expect(el.querySelector('.circle-folio__back')).not.toBeNull();
  });
});
