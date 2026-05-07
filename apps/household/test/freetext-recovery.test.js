import { describe, it, expect } from 'vitest';
import {
  normaliseListName,
  classifyAddIntent,
  classifyShowIntent,
  classifyRemoveIntent,
  stripFakeListBlocks,
  looksLikeActionConfirmation,
} from '../scripts/lib/freetext-core.js';

describe('normaliseListName', () => {
  it('aliases Dutch list-name variants to canonical names', () => {
    expect(normaliseListName('kluslijst')).toBe('klusjes');
    expect(normaliseListName('klussen')).toBe('klusjes');
    expect(normaliseListName('Kluslijstje')).toBe('klusjes');
    expect(normaliseListName('boodschappenlijst')).toBe('boodschappen');
    expect(normaliseListName('  Boodschappen ')).toBe('boodschappen');
  });

  it('passes unknown names through (lower-cased + trimmed)', () => {
    expect(normaliseListName('books')).toBe('books');
    expect(normaliseListName('GIFTS')).toBe('gifts');
  });
});

describe('classifyAddIntent', () => {
  it('parses "voeg X (en Y) toe aan <list>"', () => {
    expect(classifyAddIntent('voeg boter, kaas en eieren toe aan boodschappen'))
      .toEqual({ list: 'boodschappen', items: ['boter', 'kaas', 'eieren'] });
  });

  it('aliases the list name', () => {
    expect(classifyAddIntent('voeg stofzuigen toe aan klussen'))
      .toEqual({ list: 'klusjes', items: ['stofzuigen'] });
    expect(classifyAddIntent('zet ramen wassen op de kluslijst'))
      .toEqual({ list: 'klusjes', items: ['ramen wassen'] });
  });

  it('parses "ik heb X nodig" → boodschappen', () => {
    expect(classifyAddIntent('ik heb melk nodig'))
      .toEqual({ list: 'boodschappen', items: ['melk'] });
    expect(classifyAddIntent('we hebben nog kaas en boter nodig'))
      .toEqual({ list: 'boodschappen', items: ['kaas', 'boter'] });
  });

  it('parses "we hebben geen X meer" → boodschappen', () => {
    expect(classifyAddIntent('we hebben geen brood meer'))
      .toEqual({ list: 'boodschappen', items: ['brood'] });
  });

  it('parses English "add X to my <list>"', () => {
    expect(classifyAddIntent('add milk and bread to my shopping'))
      .toEqual({ list: 'shopping', items: ['milk', 'bread'] });
  });

  it('returns null on smalltalk / questions / ambiguous text', () => {
    expect(classifyAddIntent('hoi')).toBeNull();
    expect(classifyAddIntent('hoe gaat het?')).toBeNull();
    expect(classifyAddIntent('wat staat er op de boodschappen?')).toBeNull();
    expect(classifyAddIntent('')).toBeNull();
  });
});

describe('classifyAddIntent — extended phrasings', () => {
  it('parses "ik wil graag op (de) <list> X zetten"', () => {
    expect(classifyAddIntent('ik wil graag op mijn boodschappenlijst kastanjes en kruidnoten zetten'))
      .toEqual({ list: 'boodschappen', items: ['kastanjes', 'kruidnoten'] });
  });

  it('parses "ik wil X op (de) <list> zetten"', () => {
    expect(classifyAddIntent('ik wil melk op de boodschappenlijst zetten'))
      .toEqual({ list: 'boodschappen', items: ['melk'] });
  });
});

describe('classifyShowIntent', () => {
  it('parses "wat staat er op (de) <list>?"', () => {
    expect(classifyShowIntent('wat staat er op de boodschappenlijst?'))
      .toEqual({ list: 'boodschappen' });
    expect(classifyShowIntent('wat staat op de kluslijst?'))
      .toEqual({ list: 'klusjes' });
    expect(classifyShowIntent('wat staat er nog open op klusjes?'))
      .toEqual({ list: 'klusjes' });
  });

  it('parses "toon / laat zien / open"', () => {
    expect(classifyShowIntent('toon boodschappen')).toEqual({ list: 'boodschappen' });
    expect(classifyShowIntent('laat me de kluslijst zien')).toEqual({ list: 'klusjes' });
    expect(classifyShowIntent('open boodschappen')).toEqual({ list: 'boodschappen' });
  });

  it('parses "kun je (de) <list> tonen"', () => {
    expect(classifyShowIntent('kun je de kluslijst tonen'))
      .toEqual({ list: 'klusjes' });
  });

  it('parses "wat staat er NU op de <list>" (filler word)', () => {
    expect(classifyShowIntent('wat staat er nu op de boodschappenlijst'))
      .toEqual({ list: 'boodschappen' });
    expect(classifyShowIntent('wat staat er allemaal op klusjes'))
      .toEqual({ list: 'klusjes' });
  });

  it('parses "ik wil weten wat er op de <list> staat"', () => {
    expect(classifyShowIntent('ik wil graag weten wat er op het boodschappenlijstje staat'))
      .toEqual({ list: 'boodschappen' });
    expect(classifyShowIntent('ik wil weten wat er op klusjes staat'))
      .toEqual({ list: 'klusjes' });
  });

  it('parses English "show me my <list>"', () => {
    expect(classifyShowIntent("show me my shopping")).toEqual({ list: 'shopping' });
    expect(classifyShowIntent("what's on my shopping?")).toEqual({ list: 'shopping' });
  });

  it('returns null for non-show messages', () => {
    expect(classifyShowIntent('voeg melk toe aan boodschappen')).toBeNull();
    expect(classifyShowIntent('hoi')).toBeNull();
  });
});

describe('stripFakeListBlocks', () => {
  it('strips a 📋 listname header + bullets + footer', () => {
    const text = `Hier is je klusjes:\n📋 klusjes:\n• timmeren\n• zagen\n• hakken\n\n_Tap een item om af te vinken._`;
    const out = stripFakeListBlocks(text);
    expect(out).not.toMatch(/timmeren|zagen|hakken/);
    expect(out).not.toMatch(/_Tap een item/);
  });

  it('strips a 🛠 listname block', () => {
    const text = `Done!\n🛠 klusjes:\n• schilderen\n• vloerwasschroefelen\n_Tap een item om af te vinken._`;
    const out = stripFakeListBlocks(text);
    expect(out).not.toMatch(/schilderen|vloerwasschroefelen/);
  });

  it('strips standalone "📋 list:" headers', () => {
    expect(stripFakeListBlocks('Done. 📋 klusjes:')).not.toMatch(/klusjes/);
  });

  it('strips stray bullets', () => {
    expect(stripFakeListBlocks('OK\n• fake item')).not.toMatch(/fake item/);
  });

  it('preserves text without list-shaped patterns', () => {
    expect(stripFakeListBlocks('Hoi! Hoe kan ik helpen?'))
      .toBe('Hoi! Hoe kan ik helpen?');
  });

  it('handles empty/null gracefully', () => {
    expect(stripFakeListBlocks('')).toBe('');
    expect(stripFakeListBlocks(null)).toBe(null);
  });

  it('strips ```code``` markdown fences (geitje meta-explosion pattern)', () => {
    const text = 'Here is the format:\n```json\n{"name":"foo","arguments":[]}\n```\nHope that helps!';
    const out = stripFakeListBlocks(text);
    expect(out).not.toMatch(/```/);
    expect(out).not.toMatch(/foo|arguments/);
    expect(out).toMatch(/format/);
    expect(out).toMatch(/helps/);
  });

  it('strips angle-bracket placeholders the model copied verbatim', () => {
    expect(stripFakeListBlocks('<most-recent-list>\nshowList(boodschappen)')).toBe('');
    expect(stripFakeListBlocks('Hoi <user-name>!')).toBe('Hoi !');
  });

  it('strips bare tool-call syntax in plain text', () => {
    expect(stripFakeListBlocks('showList(boodschappen)')).toBe('');
    expect(stripFakeListBlocks('OK\naddToList(boodschappen, kaas)\nDone.'))
      .toMatch(/OK[\s\S]*Done\./);
    expect(stripFakeListBlocks('OK\naddToList(boodschappen, kaas)\nDone.'))
      .not.toMatch(/addToList/);
  });
});

describe('I18N tables — parity + smoke', () => {
  it('every key in I18N_NL exists in I18N_EN (no translation drift)', async () => {
    const { I18N_NL, I18N_EN } = await import('../scripts/lib/freetext-core.js');
    expect(Object.keys(I18N_EN).sort()).toEqual(Object.keys(I18N_NL).sort());
  });

  it('renders both languages without throwing for every kind of string', async () => {
    const { I18N_NL, I18N_EN } = await import('../scripts/lib/freetext-core.js');
    for (const i18n of [I18N_NL, I18N_EN]) {
      // function fields — call with realistic args
      expect(typeof i18n.notFound('kaas', 'boodschappen')).toBe('string');
      expect(typeof i18n.removedNowEmpty('kaas', 'boodschappen')).toBe('string');
      expect(typeof i18n.removedRemaining('kaas', 'boodschappen', '• melk')).toBe('string');
      expect(typeof i18n.listEmpty('boodschappen')).toBe('string');
      expect(typeof i18n.listShow('boodschappen', '• melk')).toBe('string');
      expect(typeof i18n.duplicate('kaas', 'boodschappen')).toBe('string');
      expect(typeof i18n.buttonTapShape('kaas', 'boodschappen')).toBe('string');
      expect(typeof i18n.buttonLabel('kaas')).toBe('string');
      expect(typeof i18n.slashAddNoItems('foo')).toBe('string');
      expect(typeof i18n.slashAddSuccess('foo', ['a','b'])).toBe('string');
      expect(typeof i18n.slashRemoveNoItem('remove', 'foo')).toBe('string');
      expect(typeof i18n.slashListLine('foo', 3)).toBe('string');
      expect(typeof i18n.contextLine('foo', 3)).toBe('string');
      // string fields
      expect(typeof i18n.fallbackNotDone).toBe('string');
      expect(typeof i18n.slashAddNoListName).toBe('string');
      expect(typeof i18n.slashShowUsage).toBe('string');
      expect(typeof i18n.slashRemoveUsage).toBe('string');
      expect(typeof i18n.slashListsEmpty).toBe('string');
      expect(typeof i18n.slashListsHeader).toBe('string');
      expect(typeof i18n.slashHelp).toBe('string');
      expect(typeof i18n.contextNoLists).toBe('string');
      expect(typeof i18n.contextHeader).toBe('string');
    }
  });
});

describe('classifier rejects too-generic / question-shaped inputs', () => {
  it('show: rejects "lijst" alone (falls through to LLM for context-pick)', () => {
    expect(classifyShowIntent('wat staat er nu op de lijst?')).toBeNull();
    expect(classifyShowIntent('toon de lijst')).toBeNull();
    expect(classifyShowIntent('open mijn lijstje')).toBeNull();
  });

  it('show: handles "X lijst" with a space ("klusjes lijst")', () => {
    expect(classifyShowIntent('wat staat er op de klusjes lijst'))
      .toEqual({ list: 'klusjes' });
    expect(classifyShowIntent('wat staat er nu op de boodschappen lijst'))
      .toEqual({ list: 'boodschappen' });
  });

  it('remove: rejects question-shaped items', () => {
    expect(classifyRemoveIntent('ik heb Wat staat er nu nog van boodschappen')).toBeNull();
    expect(classifyRemoveIntent('ik heb hoe gaat het van klusjes')).toBeNull();
  });

  it('remove: still accepts real items', () => {
    expect(classifyRemoveIntent('ik heb melk van boodschappen'))
      .toEqual({ list: 'boodschappen', item: 'melk' });
  });
});

describe('stripFakeListBlocks — extended (qwen tokenizer noise)', () => {
  it('strips mangled tool-call regurgitation', () => {
    expect(stripFakeListBlocks('afür List("boodschappen")')).toBe('');
    expect(stripFakeListBlocks('$arity_list("boodschappen")')).toBe('');
    expect(stripFakeListBlocks('_ulonged List("boodschappen")')).toBe('');
    expect(stripFakeListBlocks('showcList("klusjes")')).toBe('');
    expect(stripFakeListBlocks('Bekijk dit: showList(boodschappen) helpen?'))
      .not.toMatch(/showList/);
  });
});

describe('createToolHandlers — placeholder rejection / dedupe / aliasing', () => {
  it('addToList rejects placeholder-shaped args (qwen Chinese tokeniser slip)', async () => {
    const { createListStore, createToolHandlers } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    const h = createToolHandlers(store);
    const r = await h.addToList({ listName: '<列表名称>', item: '<要添加的物品>' });
    expect(r.data.ok).toBe(false);
    expect(store.lists.size).toBe(0);
  });

  it('addToList rejects ASCII-bracketed and curly placeholders too', async () => {
    const { createListStore, createToolHandlers } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    const h = createToolHandlers(store);
    expect((await h.addToList({ listName: '<list>',  item: 'kaas' })).data.ok).toBe(false);
    expect((await h.addToList({ listName: 'klusjes', item: '{item}' })).data.ok).toBe(false);
    expect(store.lists.size).toBe(0);
  });

  it('addToList aliases the list name (klussen → klusjes)', async () => {
    const { createListStore, createToolHandlers } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    const h = createToolHandlers(store);
    await h.addToList({ listName: 'klussen', item: 'auto wassen' });
    expect(store.lists.has('klusjes')).toBe(true);
    expect(store.lists.has('klussen')).toBe(false);
  });

  it('addToList silently dedupes case-insensitive duplicates', async () => {
    const { createListStore, createToolHandlers } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    const h = createToolHandlers(store);
    await h.addToList({ listName: 'boodschappen', item: 'aardappels' });
    const r = await h.addToList({ listName: 'boodschappen', item: 'Aardappels' });
    expect(r.data.duplicate).toBe(true);
    expect(store.lists.get('boodschappen')).toEqual(['aardappels']);
  });

  it('removeFromList rejects placeholder-shaped args', async () => {
    const { createListStore, createToolHandlers } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    const h = createToolHandlers(store);
    const r = await h.removeFromList({ listName: '<列表名称>', match: '<匹配项字符串>' });
    expect(r.data.ok).toBe(false);
  });
});

describe('stripFakeListBlocks — non-List function-call regurgitation', () => {
  it('strips lines with camelCase fake tool names + quoted args', async () => {
    const { stripFakeListBlocks } = await import('../scripts/lib/freetext-core.js');
    expect(stripFakeListBlocks('addColumn("boodschappen", "let op: ...")'))
      .toBe('');
    expect(stripFakeListBlocks('Hier: addEntry("boodschappen", "kaas") helpt!'))
      .not.toMatch(/addEntry/);
  });
});

describe('looksLikeActionConfirmation — extended', () => {
  it('catches "✓ <anything>" as a confirmation (qwen mixed-language slips)', () => {
    expect(looksLikeActionConfirmation('✓ Italiaanse pasta配料')).toBe(true);
    expect(looksLikeActionConfirmation('✓ done')).toBe(true);
    expect(looksLikeActionConfirmation('👍 ok')).toBe(true);
  });
});

describe('classifyRemoveIntent', () => {
  it('parses the canonical button-tap shape "ik heb X van <list>"', () => {
    expect(classifyRemoveIntent('ik heb schoonmaken van klusjes'))
      .toEqual({ list: 'klusjes', item: 'schoonmaken' });
    expect(classifyRemoveIntent('ik heb melk van boodschappen'))
      .toEqual({ list: 'boodschappen', item: 'melk' });
  });

  it('aliases the list name', () => {
    expect(classifyRemoveIntent('ik heb auto wassen van de kluslijst'))
      .toEqual({ list: 'klusjes', item: 'auto wassen' });
  });

  it('parses "haal/verwijder X van/uit Y"', () => {
    expect(classifyRemoveIntent('haal melk van boodschappen'))
      .toEqual({ list: 'boodschappen', item: 'melk' });
    expect(classifyRemoveIntent('verwijder kaas uit boodschappen'))
      .toEqual({ list: 'boodschappen', item: 'kaas' });
  });

  it('parses English "I got X from my <list>" / "remove X from <list>"', () => {
    expect(classifyRemoveIntent('I got milk from my shopping'))
      .toEqual({ list: 'shopping', item: 'milk' });
    expect(classifyRemoveIntent('remove eggs from shopping'))
      .toEqual({ list: 'shopping', item: 'eggs' });
  });

  it('returns null for non-remove text', () => {
    expect(classifyRemoveIntent('voeg melk toe aan boodschappen')).toBeNull();
    expect(classifyRemoveIntent('hoi')).toBeNull();
    expect(classifyRemoveIntent('')).toBeNull();
  });
});

describe('looksLikeActionConfirmation', () => {
  it('detects bare ✓ and 👍', () => {
    expect(looksLikeActionConfirmation('✓')).toBe(true);
    expect(looksLikeActionConfirmation('👍')).toBe(true);
    expect(looksLikeActionConfirmation('✓.')).toBe(true);
  });

  it('detects Dutch action confirmations', () => {
    expect(looksLikeActionConfirmation('verwijderd')).toBe(true);
    expect(looksLikeActionConfirmation('Toegevoegd!')).toBe(true);
    expect(looksLikeActionConfirmation('kruisje aangebracht')).toBe(true);
    expect(looksLikeActionConfirmation('items zijn afgevinkt')).toBe(true);
  });

  it('detects English confirmations', () => {
    expect(looksLikeActionConfirmation('Removed!')).toBe(true);
    expect(looksLikeActionConfirmation('Added 3 items.')).toBe(true);
    expect(looksLikeActionConfirmation('crossed off')).toBe(true);
  });

  it('does NOT trigger on smalltalk / questions', () => {
    expect(looksLikeActionConfirmation('Hoi! Hoe kan ik helpen?')).toBe(false);
    expect(looksLikeActionConfirmation('Welk lijstje bedoel je?')).toBe(false);
    expect(looksLikeActionConfirmation('')).toBe(false);
    expect(looksLikeActionConfirmation('  ')).toBe(false);
  });
});
