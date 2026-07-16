import { describe, it, expect } from 'vitest';
import { circleMemberActors } from '../../src/v2/circleMemberActors.js';

/** A fake MemberMap: webid → { pubKey } (null pubKey = not-yet-captured). */
function membersOf(map) {
  return { resolveByWebid: async (webid) => (webid in map ? { pubKey: map[webid] } : null) };
}

describe('circleMemberActors — roster → signing pubKeys (the media grant set)', () => {
  it('resolves each member WebID to its signing pubKey (deduped)', async () => {
    const members = membersOf({
      'https://anne.pod/#me': 'pub-anne',
      'https://bob.pod/#me': 'pub-bob',
    });
    const roster = [{ webId: 'https://anne.pod/#me' }, { webId: 'https://bob.pod/#me' }];
    expect(await circleMemberActors(members, roster)).toEqual({ actors: ['pub-anne', 'pub-bob'], unresolved: 0 });
  });

  it('DROPS + counts members whose signing key is not yet captured (the code-redeemer gap)', async () => {
    const members = membersOf({
      'https://anne.pod/#me': 'pub-anne',
      'https://carol.pod/#me': null, // redeemed by code, signing key not yet captured
    });
    const roster = [{ webId: 'https://anne.pod/#me' }, { webId: 'https://carol.pod/#me' }, { webId: 'https://dave.pod/#me' }];
    // carol resolves to null pubKey; dave isn't in the map at all — both unresolved, never guessed.
    expect(await circleMemberActors(members, roster)).toEqual({ actors: ['pub-anne'], unresolved: 2 });
  });

  it('tolerates {webid} + string roster shapes and dedupes repeats', async () => {
    const members = membersOf({ 'https://anne.pod/#me': 'pub-anne' });
    const roster = [{ webid: 'https://anne.pod/#me' }, 'https://anne.pod/#me', { name: 'no-webid' }];
    const res = await circleMemberActors(members, roster);
    expect(res.actors).toEqual(['pub-anne']); // deduped
    expect(res.unresolved).toBe(1);           // the entry with no webid
  });

  it('a throwing resolver is a non-resolution, not a crash', async () => {
    const members = { resolveByWebid: async () => { throw new Error('map down'); } };
    expect(await circleMemberActors(members, [{ webId: 'x' }])).toEqual({ actors: [], unresolved: 1 });
  });

  it('degrades safely on a missing/invalid members map or roster', async () => {
    expect(await circleMemberActors(null, [{ webId: 'x' }])).toEqual({ actors: [], unresolved: 1 });
    expect(await circleMemberActors(membersOf({}), null)).toEqual({ actors: [], unresolved: 0 });
    expect(await circleMemberActors({}, [{ webId: 'x' }])).toEqual({ actors: [], unresolved: 1 });
  });
});
