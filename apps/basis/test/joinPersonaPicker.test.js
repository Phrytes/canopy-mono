/**
 * Join-with-persona picker — the shared state helpers behind the step-3
 * selector (web `<select>` + mobile `RadioGroup` both drive these).
 *
 * Contract:
 *   - loadPersonas surfaces ONLY registry profiles (role:'profile'), never
 *     device agents; silent (→ []) on any callSkill failure.
 *   - setPersona records a profile id, and normalises "" / non-string → null
 *     (the protective default: "join minimally", disclose no background).
 *   - initialState starts with persona:null + personas:[] (nothing pre-selected).
 */
import { describe, it, expect } from 'vitest';
import { loadPersonas, setPersona, initialState } from '../src/core/wizards/joinGroupState.js';

describe('join-with-persona picker · state helpers', () => {
  it('loadPersonas returns only role:profile rows, as {id,name}', async () => {
    const callSkill = async (app, op) => {
      expect(app).toBe('agents');
      expect(op).toBe('listAgents');
      return {
        agents: [
          { agentId: 'default', name: 'default',  role: 'profile' },
          { agentId: 'work',    name: 'Work me',  role: 'profile' },
          { agentId: 'phone-1', name: 'Pixel',    role: 'device'  },
          { agentId: 'no-role', name: 'x' /* role missing → not a profile */ },
        ],
      };
    };
    const personas = await loadPersonas({ callSkill });
    expect(personas).toEqual([
      { id: 'default', name: 'default' },
      { id: 'work',    name: 'Work me' },
    ]);
  });

  it('loadPersonas falls back to the id when a profile has no name', async () => {
    const callSkill = async () => ({ agents: [{ agentId: 'alt', role: 'profile' }] });
    expect(await loadPersonas({ callSkill })).toEqual([{ id: 'alt', name: 'alt' }]);
  });

  it('loadPersonas is silent (→ []) when the skill throws or returns junk', async () => {
    expect(await loadPersonas({ callSkill: async () => { throw new Error('offline'); } })).toEqual([]);
    expect(await loadPersonas({ callSkill: async () => ({}) })).toEqual([]);
    expect(await loadPersonas({ callSkill: async () => null })).toEqual([]);
  });

  it('setPersona records a chosen id and normalises empty/non-string → null', () => {
    const s = initialState();
    expect(s.persona).toBe(null);
    expect(s.personas).toEqual([]);

    setPersona(s, 'work');
    expect(s.persona).toBe('work');

    setPersona(s, '');           // the "join minimally" option
    expect(s.persona).toBe(null);

    setPersona(s, 'default');
    expect(s.persona).toBe('default');

    setPersona(s, undefined);    // defensive
    expect(s.persona).toBe(null);
  });
});
