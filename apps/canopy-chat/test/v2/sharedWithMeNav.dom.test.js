// @vitest-environment happy-dom
/**
 * SILENT out-of-circle delivery — the NAV ENTRY that opens the "shared with me" view.
 *
 * The view (renderSharedWithMe) + selector (buildSharedWithMe) already existed; this proves the
 * missing piece — a personal, cross-circle NAV entry on the Mij profile that OPENS that view fed
 * with the per-user store's entries. Placement is a Mij sub-screen link, peer of availability /
 * my-data (both plain buttons, not manifest ops). web ≡ mobile: the web adapter reads the store
 * and projects through the SAME `buildSharedWithMe` the mobile SharedWithMeScreen runs internally.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';
import { renderSharedWithMe } from '../../web/v2/sharedWithMe.js';
import { buildSharedWithMe } from '../../src/v2/sharedWithMe.js';

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const tagT = (k) => `T:${k}`;

describe('shared-with-me nav entry (Mij sub-screen)', () => {
  it('renders the entry only when onSharedWithMe is wired, labelled via t()', () => {
    const without = mount();
    renderCircleProfile(without, { profile: {}, categories: [], t: tagT });
    expect(without.querySelector('.cc-profile__shared-with-me')).toBeNull();

    const withEntry = mount();
    renderCircleProfile(withEntry, { profile: {}, categories: [], t: tagT, onSharedWithMe: () => {} });
    const btn = withEntry.querySelector('.cc-profile__shared-with-me');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('T:circle.profile.sharedWithMe');
  });

  it('invokes the handler on click', () => {
    const el = mount();
    const onSharedWithMe = vi.fn();
    renderCircleProfile(el, { profile: {}, categories: [], t: tagT, onSharedWithMe });
    el.querySelector('.cc-profile__shared-with-me').click();
    expect(onSharedWithMe).toHaveBeenCalledTimes(1);
  });

  it('OPENS the shared-with-me view fed the store entries when the entry is tapped', () => {
    // The per-user store's raw entries (as sharedWithMeStore.list() returns them).
    const received = [
      { id: 'a', sealed: { id: 'a', text: 'x' }, itemMeta: { sourceType: 'note' }, from: 'alice', receivedAt: 100 },
      { id: 'b', sealed: { id: 'b', text: 'y' }, itemMeta: { sourceType: 'task' }, from: 'bob',   receivedAt: 300 },
    ];
    const root = mount();
    // The host wiring showMij performs: tapping the entry projects the store list through the
    // SHARED selector and renders the view into the same root.
    const openSharedWithMe = () => renderSharedWithMe(root, { entries: buildSharedWithMe(received), t: tagT });
    renderCircleProfile(root, { profile: {}, categories: [], t: tagT, onSharedWithMe: openSharedWithMe });

    // Before: the profile is showing, no shared-with-me surface yet.
    expect(root.classList.contains('shared-with-me')).toBe(false);
    expect(root.querySelector('.cc-profile__shared-with-me')).not.toBeNull();
    root.querySelector('.cc-profile__shared-with-me').click();

    // After: the shared-with-me view replaced the profile in the same root, newest-first,
    // over the shared projection (renderSharedWithMe tags the container itself).
    expect(root.classList.contains('shared-with-me')).toBe(true);
    expect(root.querySelector('.cc-profile__shared-with-me')).toBeNull();   // profile gone
    expect(root.querySelector('.shared-with-me__title').textContent).toBe('T:circle.sharedWithMe.title');
    const rows = [...root.querySelectorAll('.shared-with-me__row')];
    expect(rows.map((r) => r.dataset.copyId)).toEqual(['b', 'a']);   // newest-first
    expect(rows[0].textContent).toBe('T:circle.sharedWithMe.row');   // projected row shape
    // Back affordance returns to Mij (host wires onBack: showMij).
    expect(root.querySelector('.shared-with-me__back')).not.toBeNull();
  });

  it('shows the empty state when nothing has been shared', () => {
    const root = mount();
    renderSharedWithMe(root, { entries: buildSharedWithMe([]), t: tagT });
    expect(root.querySelector('.shared-with-me__empty').textContent).toBe('T:circle.sharedWithMe.empty');
    expect(root.querySelector('.shared-with-me__row')).toBeNull();
  });
});
