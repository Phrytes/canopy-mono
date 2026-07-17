/**
 * circleProfile — the Mij profile editor (S2). @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../web/v2/circleProfile.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('renderCircleProfile — identity', () => {
  it('prefills handle + displayName and saves the trimmed values', () => {
    const onSaveProfile = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { handle: 'jan', displayName: 'Jan de Buur' }, t, onSaveProfile,
    });
    expect(el.querySelector('.cc-profile__handle').value).toBe('jan');
    expect(el.querySelector('.cc-profile__display').value).toBe('Jan de Buur');
    el.querySelector('.cc-profile__handle').value = '  janb  ';
    el.querySelector('.cc-profile__save').click();
    expect(onSaveProfile).toHaveBeenCalledWith({ handle: 'janb', displayName: 'Jan de Buur' });
  });
});

describe('renderCircleProfile — skills moved to Mij → persona\'s (fold-in phase C)', () => {
  it('renders NO skills editor any more — only the quiet pointer row, which opens the Mij surface', () => {
    const onOpenMij = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { skills: [{ categoryId: 'klus' }] }, t, onOpenMij,
    });
    // The old editor is gone even when a legacy roster profile still carries skills.
    expect(el.querySelector('.cc-profile__skill')).toBeNull();
    expect(el.querySelector('.cc-profile__skill-select')).toBeNull();
    expect(el.querySelector('.cc-profile__skill-add-btn')).toBeNull();
    // The pointer row is there and clicks through.
    const link = el.querySelector('.cc-profile__skills-moved-link');
    expect(link.textContent).toBe('circle.profile.skills_moved');
    link.click();
    expect(onOpenMij).toHaveBeenCalled();
  });

  it('degrades to plain text without onOpenMij (older callers)', () => {
    const el = renderCircleProfile(document.createElement('div'), { profile: {}, t });
    const row = el.querySelector('.cc-profile__skills-moved');
    expect(row.textContent).toBe('circle.profile.skills_moved');
    expect(row.querySelector('button')).toBeNull();
  });
});

describe('renderCircleProfile — location', () => {
  it('shows no-location + geocodes a query', () => {
    const onGeocode = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { profile: {}, t, onGeocode });
    expect(el.querySelector('.cc-profile__loc-current').textContent).toBe('circle.profile.loc_none');
    el.querySelector('.cc-profile__geo-input').value = 'Groningen';
    el.querySelector('.cc-profile__geo-search').click();
    expect(onGeocode).toHaveBeenCalledWith('Groningen');
  });

  it('renders a geocode result + saves it; shows current + clear when set', () => {
    const onSaveLocation = vi.fn(); const onClearLocation = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { location: { label: 'Selwerd' } }, geocodeResult: { cell: 'g', label: 'Groningen' },
      t, onSaveLocation, onClearLocation,
    });
    expect(el.querySelector('.cc-profile__loc-current').textContent).toContain('Selwerd');
    el.querySelector('.cc-profile__geo-use').click();
    expect(onSaveLocation).toHaveBeenCalled();
    el.querySelector('.cc-profile__loc-clear').click();
    expect(onClearLocation).toHaveBeenCalled();
  });
});

describe('renderCircleProfile — availability link', () => {
  it('fires onAvailability', () => {
    const onAvailability = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { profile: {}, t, onAvailability });
    el.querySelector('.cc-profile__availability').click();
    expect(onAvailability).toHaveBeenCalled();
  });
});
