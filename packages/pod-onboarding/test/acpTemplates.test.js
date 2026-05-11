/**
 * acpTemplates — pure-data validation.
 */

import { describe, it, expect } from 'vitest';
import {
  privateAcp,
  sharingAcp,
  sharingPublicAcp,
  defaultAcpTemplates,
  ACP,
  MODES,
} from '../src/acpTemplates.js';

const ANNE_WEBID = 'https://anne.pod/profile/card#me';

describe('privateAcp', () => {
  it('builds an agent-locked policy', () => {
    const acp = privateAcp({ agentWebid: ANNE_WEBID });
    expect(acp.template).toBe('private');
    expect(acp.policies).toHaveLength(1);
    expect(acp.policies[0].allow).toContain(MODES.read);
    expect(acp.policies[0].allow).toContain(MODES.write);
    expect(acp.policies[0].matchers).toEqual([{ agent: ANNE_WEBID }]);
  });

  it('rejects missing agentWebid', () => {
    expect(() => privateAcp({})).toThrow(/agentWebid/);
    expect(() => privateAcp({ agentWebid: '' })).toThrow(/agentWebid/);
  });

  it('returns a frozen object', () => {
    const acp = privateAcp({ agentWebid: ANNE_WEBID });
    expect(Object.isFrozen(acp)).toBe(true);
  });
});

describe('sharingAcp', () => {
  it('grants the owner full access; no public matcher', () => {
    const acp = sharingAcp({ agentWebid: ANNE_WEBID });
    expect(acp.template).toBe('sharing');
    expect(acp.policies[0].matchers).toEqual([{ agent: ANNE_WEBID }]);
    const hasPublic = acp.policies.some(p => p.matchers.some(m => m.publicAgent));
    expect(hasPublic).toBe(false);
  });
});

describe('sharingPublicAcp', () => {
  it('grants public read + owner full access', () => {
    const acp = sharingPublicAcp({ agentWebid: ANNE_WEBID });
    expect(acp.template).toBe('sharing-public');
    expect(acp.policies).toHaveLength(2);
    const publicPolicy = acp.policies.find(p => p.matchers.some(m => m.publicAgent));
    expect(publicPolicy).toBeTruthy();
    expect(publicPolicy.allow).toEqual([MODES.read]);
    const ownerPolicy = acp.policies.find(p => p.matchers.some(m => m.agent === ANNE_WEBID));
    expect(ownerPolicy.allow).toContain(MODES.write);
  });
});

describe('defaultAcpTemplates', () => {
  it('returns all three templates in one call', () => {
    const t = defaultAcpTemplates({ agentWebid: ANNE_WEBID });
    expect(Object.keys(t).sort()).toEqual(['private', 'sharing', 'sharingPublic']);
    expect(t.private.template).toBe('private');
    expect(t.sharing.template).toBe('sharing');
    expect(t.sharingPublic.template).toBe('sharing-public');
  });
});

describe('vocabulary constants', () => {
  it('exposes ACP + MODES IRIs', () => {
    expect(ACP.Policy).toMatch(/^http/);
    expect(MODES.read).toMatch(/Read$/);
    expect(MODES.write).toMatch(/Write$/);
    expect(MODES.control).toMatch(/Control$/);
  });
});
