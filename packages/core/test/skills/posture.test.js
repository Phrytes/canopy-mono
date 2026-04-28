/**
 * Skill posture flag (Group D1).
 *
 * Covers Q-D.2 — two orthogonal opts on every SkillDefinition:
 *   • posture        : 'always' | 'negotiable'         (default 'always')
 *   • humanInTheLoop : 'never' | 'either' | 'required' (default 'never')
 *
 * The two flags are independent — every (posture, humanInTheLoop) combo
 * in the 2×3 matrix is valid (e.g. always+required = taxi-driver,
 * negotiable+either = summarize-this-text).
 */
import { describe, it, expect } from 'vitest';
import { defineSkill }    from '../../src/skills/defineSkill.js';
import { SkillRegistry }  from '../../src/skills/SkillRegistry.js';
import { _snapshot }      from '../../src/skills/capabilities.js';

const noop = async () => [];

const POSTURES = ['always', 'negotiable'];
const HITL     = ['never', 'either', 'required'];

// ── defineSkill — defaults & validation ─────────────────────────────────────

describe('defineSkill — posture defaults', () => {
  it('defaults posture to "always" and humanInTheLoop to "never"', () => {
    const s = defineSkill('echo', noop);
    expect(s.posture).toBe('always');
    expect(s.humanInTheLoop).toBe('never');
  });

  it('preserves explicit posture / humanInTheLoop values', () => {
    const s = defineSkill('book', noop, {
      posture:        'negotiable',
      humanInTheLoop: 'required',
    });
    expect(s.posture).toBe('negotiable');
    expect(s.humanInTheLoop).toBe('required');
  });
});

describe('defineSkill — posture validation', () => {
  it('rejects unknown posture values', () => {
    expect(() => defineSkill('a', noop, { posture: 'sometimes' }))
      .toThrow(/posture must be one of/);
  });

  it('rejects non-string posture values', () => {
    expect(() => defineSkill('a', noop, { posture: 42 }))
      .toThrow(/posture must be one of/);
  });

  it('rejects unknown humanInTheLoop values', () => {
    expect(() => defineSkill('a', noop, { humanInTheLoop: 'maybe' }))
      .toThrow(/humanInTheLoop must be one of/);
  });

  it('rejects boolean humanInTheLoop (it is a 3-value enum, not boolean)', () => {
    expect(() => defineSkill('a', noop, { humanInTheLoop: true }))
      .toThrow(/humanInTheLoop must be one of/);
    expect(() => defineSkill('a', noop, { humanInTheLoop: false }))
      .toThrow(/humanInTheLoop must be one of/);
  });
});

// ── 2×3 matrix — every cell is valid ────────────────────────────────────────

describe('defineSkill — full (posture × humanInTheLoop) matrix', () => {
  for (const posture of POSTURES) {
    for (const humanInTheLoop of HITL) {
      it(`accepts posture='${posture}' + humanInTheLoop='${humanInTheLoop}'`, () => {
        const s = defineSkill(`s-${posture}-${humanInTheLoop}`, noop, {
          posture,
          humanInTheLoop,
        });
        expect(s.posture).toBe(posture);
        expect(s.humanInTheLoop).toBe(humanInTheLoop);
      });
    }
  }
});

// ── Orthogonality with existing opts ───────────────────────────────────────

describe('defineSkill — posture is orthogonal to policy & visibility', () => {
  it('coexists with policy + visibility without affecting them', () => {
    const s = defineSkill('mix', noop, {
      visibility:     'trusted',
      policy:         'requires-token',
      posture:        'negotiable',
      humanInTheLoop: 'either',
    });
    expect(s.visibility).toBe('trusted');
    expect(s.policy).toBe('requires-token');
    expect(s.posture).toBe('negotiable');
    expect(s.humanInTheLoop).toBe('either');
  });
});

// ── SkillRegistry round-trip ───────────────────────────────────────────────

describe('SkillRegistry — posture metadata round-trip', () => {
  it('stores posture + humanInTheLoop on registered skills', () => {
    const reg = new SkillRegistry();
    reg.register('book', noop, {
      posture:        'always',
      humanInTheLoop: 'required',
    });
    const s = reg.get('book');
    expect(s.posture).toBe('always');
    expect(s.humanInTheLoop).toBe('required');
  });

  it('skills registered without the new opts get the defaults (backward compat)', () => {
    const reg = new SkillRegistry();
    reg.register('legacy', noop);
    const s = reg.get('legacy');
    expect(s.posture).toBe('always');
    expect(s.humanInTheLoop).toBe('never');
  });
});

// ── SkillRegistry.getByPosture filter ──────────────────────────────────────

describe('SkillRegistry.getByPosture', () => {
  function seeded() {
    const reg = new SkillRegistry();
    // (posture, humanInTheLoop) cells
    reg.register('a-an', noop, { posture: 'always',     humanInTheLoop: 'never'    });
    reg.register('a-ae', noop, { posture: 'always',     humanInTheLoop: 'either'   });
    reg.register('a-ar', noop, { posture: 'always',     humanInTheLoop: 'required' });
    reg.register('n-nn', noop, { posture: 'negotiable', humanInTheLoop: 'never'    });
    reg.register('n-ne', noop, { posture: 'negotiable', humanInTheLoop: 'either'   });
    reg.register('n-nr', noop, { posture: 'negotiable', humanInTheLoop: 'required' });
    return reg;
  }

  it('returns all skills when no filter given', () => {
    const reg = seeded();
    expect(reg.getByPosture().length).toBe(6);
    expect(reg.getByPosture({}).length).toBe(6);
  });

  it('filters by posture only', () => {
    const ids = seeded().getByPosture({ posture: 'negotiable' })
      .map(s => s.id).sort();
    expect(ids).toEqual(['n-ne', 'n-nn', 'n-nr']);
  });

  it('filters by humanInTheLoop only', () => {
    const ids = seeded().getByPosture({ humanInTheLoop: 'required' })
      .map(s => s.id).sort();
    expect(ids).toEqual(['a-ar', 'n-nr']);
  });

  it('AND-combines both filters', () => {
    const ids = seeded()
      .getByPosture({ posture: 'negotiable', humanInTheLoop: 'either' })
      .map(s => s.id);
    expect(ids).toEqual(['n-ne']);
  });

  it('returns [] when no skill matches', () => {
    const reg = new SkillRegistry();
    reg.register('only', noop, { posture: 'always', humanInTheLoop: 'never' });
    expect(reg.getByPosture({ posture: 'negotiable' })).toEqual([]);
  });

  it('matches default-equipped legacy skills via the defaults', () => {
    const reg = new SkillRegistry();
    reg.register('legacy', noop);                           // defaults
    reg.register('hint', noop, { posture: 'negotiable' });  // explicit other
    const ids = reg.getByPosture({ posture: 'always', humanInTheLoop: 'never' })
      .map(s => s.id);
    expect(ids).toEqual(['legacy']);
  });
});

// ── capabilities snapshot — agent card surface ─────────────────────────────

describe('capabilities snapshot — per-skill posture surface', () => {
  /**
   * Build a minimal mock agent that exposes a SkillRegistry + the few
   * fields _snapshot() reads.  We don't need a real Agent for this test
   * because _snapshot() only reads `agent.skills`, `agent._rendezvousEnabled`,
   * and the GroupManager (which we leave undefined).
   */
  function mockAgent(reg) {
    return {
      skills: reg,
      _rendezvousEnabled: false,
      security: undefined,
    };
  }

  it('emits a `skills` array with posture + humanInTheLoop per skill', () => {
    const reg = new SkillRegistry();
    reg.register('legacy',  noop);
    reg.register('book',    noop, { posture: 'always',     humanInTheLoop: 'required' });
    reg.register('summary', noop, { posture: 'negotiable', humanInTheLoop: 'either'   });

    const snap = _snapshot(mockAgent(reg));
    expect(Array.isArray(snap.skills)).toBe(true);
    const byId = Object.fromEntries(snap.skills.map(s => [s.id, s]));

    expect(byId.legacy).toEqual({
      id: 'legacy', posture: 'always', humanInTheLoop: 'never',
    });
    expect(byId.book).toEqual({
      id: 'book', posture: 'always', humanInTheLoop: 'required',
    });
    expect(byId.summary).toEqual({
      id: 'summary', posture: 'negotiable', humanInTheLoop: 'either',
    });
  });

  it('covers all 6 (posture, humanInTheLoop) cells in the snapshot', () => {
    const reg = new SkillRegistry();
    for (const posture of POSTURES) {
      for (const humanInTheLoop of HITL) {
        reg.register(`s-${posture}-${humanInTheLoop}`, noop, {
          posture, humanInTheLoop,
        });
      }
    }
    const snap = _snapshot(mockAgent(reg));
    expect(snap.skills.length).toBe(6);

    const seen = new Set(
      snap.skills.map(s => `${s.posture}/${s.humanInTheLoop}`)
    );
    for (const posture of POSTURES) {
      for (const humanInTheLoop of HITL) {
        expect(seen.has(`${posture}/${humanInTheLoop}`)).toBe(true);
      }
    }
  });

  it('keeps existing snapshot fields intact (additive only)', () => {
    const reg = new SkillRegistry();
    reg.register('any', noop);
    const snap = _snapshot(mockAgent(reg));
    // Legacy keys still present (no consumer should regress).
    expect(snap).toHaveProperty('rendezvous');
    expect(snap).toHaveProperty('originSig');
    expect(snap).toHaveProperty('relay');
    expect(snap).toHaveProperty('oracle');
    expect(snap).toHaveProperty('tunnel');
    expect(snap).toHaveProperty('groups');
  });
});
