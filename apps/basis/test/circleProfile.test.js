/**
 * circleProfile — the Mij profile editor (S2). @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../web/v2/circleProfile.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const categories = [{ id: 'klus', label: 'Odd jobs' }, { id: 'tuin', label: 'Gardening' }];

describe('renderCircleProfile — identity', () => {
  it('prefills handle + displayName and saves the trimmed values', () => {
    const onSaveProfile = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { handle: 'jan', displayName: 'Jan de Buur' }, categories, t, onSaveProfile,
    });
    expect(el.querySelector('.cc-profile__handle').value).toBe('jan');
    expect(el.querySelector('.cc-profile__display').value).toBe('Jan de Buur');
    el.querySelector('.cc-profile__handle').value = '  janb  ';
    el.querySelector('.cc-profile__save').click();
    expect(onSaveProfile).toHaveBeenCalledWith({ handle: 'janb', displayName: 'Jan de Buur' });
  });
});

describe('renderCircleProfile — skills', () => {
  it('lists my skills (resolved to category labels) + removes one', () => {
    const onRemoveSkill = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { skills: [{ categoryId: 'klus' }] }, categories, t, onRemoveSkill,
    });
    const chip = el.querySelector('.cc-profile__skill');
    expect(chip.dataset.categoryId).toBe('klus');
    expect(chip.textContent).toContain('Odd jobs');
    chip.querySelector('.cc-profile__skill-remove').click();
    expect(onRemoveSkill).toHaveBeenCalledWith('klus');
  });

  it('shows the empty state + adds a skill from the category picker', () => {
    const onAddSkill = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { profile: { skills: [] }, categories, t, onAddSkill });
    expect(el.querySelector('.cc-profile__none').textContent).toBe('circle.profile.no_skills');
    const select = el.querySelector('.cc-profile__skill-select');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'klus', 'tuin']);
    select.value = 'tuin';
    el.querySelector('.cc-profile__skill-add-btn').click();
    expect(onAddSkill).toHaveBeenCalledWith('tuin');
  });
});

describe('renderCircleProfile — location', () => {
  it('shows no-location + geocodes a query', () => {
    const onGeocode = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { profile: {}, categories, t, onGeocode });
    expect(el.querySelector('.cc-profile__loc-current').textContent).toBe('circle.profile.loc_none');
    el.querySelector('.cc-profile__geo-input').value = 'Groningen';
    el.querySelector('.cc-profile__geo-search').click();
    expect(onGeocode).toHaveBeenCalledWith('Groningen');
  });

  it('renders a geocode result + saves it; shows current + clear when set', () => {
    const onSaveLocation = vi.fn(); const onClearLocation = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      profile: { location: { label: 'Selwerd' } }, geocodeResult: { cell: 'g', label: 'Groningen' },
      categories, t, onSaveLocation, onClearLocation,
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
    const el = renderCircleProfile(document.createElement('div'), { profile: {}, categories, t, onAvailability });
    el.querySelector('.cc-profile__availability').click();
    expect(onAvailability).toHaveBeenCalled();
  });
});
