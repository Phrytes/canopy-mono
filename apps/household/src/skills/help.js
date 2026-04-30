/**
 * skills/help — print a static command list (English + Dutch).
 *
 * args : {} (ignored)
 * ctx  : SkillContext (unused — help has no side effects)
 * reply: a single text message mirroring grammar.md.
 *
 * No stateUpdates.
 */

const HELP_TEXT = [
  'Household commands',
  '',
  '- add <type> <text>     add an item (en)',
  '- voeg toe <type> <tekst>  voeg een item toe (nl)',
  '- list <type>           show open items (en)',
  '- lijst <type>          toon open items (nl)',
  '- what do we need?      show open shopping (en)',
  '- wat hebben we nodig?  toon open boodschappen (nl)',
  '- done <id|keyword>     mark complete (en)',
  '- klaar <id|keyword>    markeer als klaar (nl)',
  '- remove <id|keyword>   delete an item (en)',
  '- verwijder <id|keyword> verwijder een item (nl)',
  '- help / hulp           show this list',
  '',
  'Types: shopping, errand, repair, schedule.',
  'Aliases: groceries/buy, task/todo, fix, event/appointment.',
].join('\n');

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function help(_args, _ctx) {
  return {
    replies: [{ text: HELP_TEXT }],
    stateUpdates: [],
  };
}
