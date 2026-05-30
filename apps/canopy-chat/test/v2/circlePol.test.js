import { describe, it, expect, vi } from 'vitest';
import {
  getCirclePolStatus, formatPolStatus, formatAttestedAt,
} from '../../src/v2/circlePol.js';

describe('getCirclePolStatus', () => {
  it('returns {configured:false} when no callSkill is provided', async () => {
    expect(await getCirclePolStatus({ circleId: 'c1' })).toEqual({ configured: false });
    expect(await getCirclePolStatus()).toEqual({ configured: false });
  });

  it('returns {configured:false} when callSkill throws (op unregistered)', async () => {
    const callSkill = vi.fn(async () => { throw new Error('UNKNOWN_OP'); });
    const status = await getCirclePolStatus({ callSkill, circleId: 'c1' });
    expect(status).toEqual({ configured: false });
    expect(callSkill).toHaveBeenCalledWith('getPolStatus', { circleId: 'c1' });
  });

  it('returns {configured:false} when callSkill returns null', async () => {
    const callSkill = vi.fn(async () => null);
    expect(await getCirclePolStatus({ callSkill, circleId: 'c1' }))
      .toEqual({ configured: false });
  });

  it('returns {configured:false} when callSkill returns {configured:false}', async () => {
    const callSkill = vi.fn(async () => ({ configured: false }));
    expect(await getCirclePolStatus({ callSkill, circleId: 'c1' }))
      .toEqual({ configured: false });
  });

  it('returns the populated shape when callSkill returns a configured status', async () => {
    const callSkill = vi.fn(async () => ({
      configured: true,
      attestedAt: 1700000000000,
      location:   'Selwerd hub',
    }));
    expect(await getCirclePolStatus({ callSkill, circleId: 'c1' })).toEqual({
      configured: true,
      attestedAt: 1700000000000,
      location:   'Selwerd hub',
    });
  });

  it('normalises missing attestedAt/location to null when configured:true', async () => {
    const callSkill = vi.fn(async () => ({ configured: true }));
    expect(await getCirclePolStatus({ callSkill, circleId: 'c1' })).toEqual({
      configured: true,
      attestedAt: null,
      location:   null,
    });
  });

  it('treats configured:"true" (truthy non-bool) as not configured', async () => {
    // Strict shape guard: only configured===true counts.
    const callSkill = vi.fn(async () => ({ configured: 'true' }));
    expect(await getCirclePolStatus({ callSkill, circleId: 'c1' }))
      .toEqual({ configured: false });
  });
});

describe('formatPolStatus', () => {
  // A mock t() that mirrors i18next: resolves the two PoL keys we care
  // about + interpolates {{name}} params.  Mirrors the locale entries
  // shipped in apps/canopy-chat/locales/en.json.
  const TEMPLATES = {
    'circle.pol.notConfigured': 'Not configured',
    'circle.pol.attestedAt':    'Verified at {{time}}',
  };
  const t = (key, params) => {
    const tmpl = TEMPLATES[key] ?? key;
    if (!params) return tmpl;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
      tmpl,
    );
  };

  it('returns the "Not configured" copy when the status is empty', () => {
    expect(formatPolStatus(null, t)).toBe('Not configured');
    expect(formatPolStatus({ configured: false }, t)).toBe('Not configured');
    expect(formatPolStatus(undefined, t)).toBe('Not configured');
  });

  it('returns "Verified at <time>" with no location prefix when location is null', () => {
    const at = Date.UTC(2026, 4, 30, 10, 30, 0); // 2026-05-30 10:30
    const out = formatPolStatus({ configured: true, attestedAt: at, location: null }, t);
    expect(out).toBe('Verified at 2026-05-30 10:30');
  });

  it('prefixes the location when present', () => {
    const at = Date.UTC(2026, 4, 30, 10, 30, 0);
    const out = formatPolStatus(
      { configured: true, attestedAt: at, location: 'Selwerd hub' },
      t,
    );
    expect(out).toBe('Selwerd hub • Verified at 2026-05-30 10:30');
  });

  it('renders a "—" placeholder when configured but attestedAt is missing', () => {
    const out = formatPolStatus({ configured: true, attestedAt: null, location: null }, t);
    expect(out).toBe('Verified at —');
  });

  it('falls back to a passthrough translator when t is missing', () => {
    expect(formatPolStatus({ configured: false })).toBe('circle.pol.notConfigured');
  });
});

describe('formatAttestedAt', () => {
  it('formats a numeric epoch into YYYY-MM-DD HH:MM (UTC)', () => {
    expect(formatAttestedAt(Date.UTC(2026, 4, 30, 10, 30, 0))).toBe('2026-05-30 10:30');
  });

  it('returns "—" for non-numeric / non-finite input', () => {
    expect(formatAttestedAt(null)).toBe('—');
    expect(formatAttestedAt(undefined)).toBe('—');
    expect(formatAttestedAt('nope')).toBe('—');
    expect(formatAttestedAt(NaN)).toBe('—');
    expect(formatAttestedAt(Infinity)).toBe('—');
  });
});
