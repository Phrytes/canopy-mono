/**
 * pairedDevices — the OBJ-2 no-pod sync pairing panel (DOM render).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderPairedDevices } from '../web/v2/pairedDevices.js';

const t = (k) => k;

describe('renderPairedDevices', () => {
  it('shows this device address (readonly) + a copy button', () => {
    const el = renderPairedDevices(document.createElement('div'), {
      selfAddr: 'PUBKEY_ABCDEF0123456789', peers: [], t,
    });
    const addr = el.querySelector('.cc-paired__addr');
    expect(addr).not.toBeNull();
    expect(addr.value).toBe('PUBKEY_ABCDEF0123456789');
    expect(addr.readOnly).toBe(true);
    expect(el.querySelector('.cc-paired__copy')).not.toBeNull();
  });

  it('renders the empty state when there are no paired devices', () => {
    const el = renderPairedDevices(document.createElement('div'), { selfAddr: 'me', peers: [], t });
    expect(el.querySelector('.cc-paired__empty')).not.toBeNull();
    expect(el.querySelector('.cc-paired__list')).toBeNull();
  });

  it('lists current peers (address shortened, full value in title) with a remove button', () => {
    const el = renderPairedDevices(document.createElement('div'), {
      selfAddr: 'me', peers: ['PEER_LONG_ADDRESS_0123456789'], t,
    });
    const peer = el.querySelector('.cc-paired__peer');
    expect(peer).not.toBeNull();
    expect(peer.querySelector('.cc-paired__peeraddr').title).toBe('PEER_LONG_ADDRESS_0123456789');
    expect(peer.querySelector('.cc-paired__remove')).not.toBeNull();
  });

  it('Add calls onAdd and re-draws from the returned roster', async () => {
    const onAdd = vi.fn(async () => ['peerX']);
    const el = renderPairedDevices(document.createElement('div'), { selfAddr: 'me', peers: [], t, onAdd });
    el.querySelector('.cc-paired__input').value = 'peerX';
    el.querySelector('.cc-paired__addbtn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onAdd).toHaveBeenCalledWith('peerX');
    expect([...el.querySelectorAll('.cc-paired__peeraddr')].some((n) => n.title === 'peerX')).toBe(true);
  });

  it('blank input does not call onAdd', () => {
    const onAdd = vi.fn();
    const el = renderPairedDevices(document.createElement('div'), { selfAddr: 'me', peers: [], t, onAdd });
    el.querySelector('.cc-paired__input').value = '   ';
    el.querySelector('.cc-paired__addbtn').click();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('Remove calls onRemove and drops the row', async () => {
    const onRemove = vi.fn(async () => []);
    const el = renderPairedDevices(document.createElement('div'), { selfAddr: 'me', peers: ['peerY'], t, onRemove });
    el.querySelector('.cc-paired__remove').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onRemove).toHaveBeenCalledWith('peerY');
    expect(el.querySelector('.cc-paired__empty')).not.toBeNull();
  });
});
