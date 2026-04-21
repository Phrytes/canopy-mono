/**
 * SkillRegistry — stores and indexes SkillDefinitions.
 *
 * Skills are indexed by id. Duplicate registration replaces the previous
 * entry (last-write-wins), which allows agent files and blueprints to
 * override default skill definitions.
 */
import { defineSkill } from './defineSkill.js';

export class SkillRegistry {
  /** @type {Map<string, import('./defineSkill.js').SkillDefinition>} */
  #skills = new Map();

  /**
   * Register a skill. Accepts either a full SkillDefinition object
   * (from defineSkill()) or shorthand (id, handler, opts).
   *
   * @param {import('./defineSkill.js').SkillDefinition|string} idOrDef
   * @param {Function}  [handler]
   * @param {object}    [opts]
   */
  register(idOrDef, handler, opts = {}) {
    const def = typeof idOrDef === 'string'
      ? defineSkill(idOrDef, handler, opts)
      : idOrDef;

    if (!def?.id) throw new Error('SkillRegistry.register: definition must have an id');
    this.#skills.set(def.id, def);
    return this;
  }

  /** @returns {import('./defineSkill.js').SkillDefinition|null} */
  get(id) { return this.#skills.get(id) ?? null; }

  /** @returns {import('./defineSkill.js').SkillDefinition[]} */
  all() { return [...this.#skills.values()]; }

  /**
   * Skills visible at a given trust tier.
   * @param {'public'|'authenticated'|'trusted'|'private'} tier
   */
  forTier(tier) {
    const order = ['public', 'authenticated', 'trusted', 'private'];
    const idx   = order.indexOf(tier);
    return this.all().filter(s => order.indexOf(s.visibility) <= idx);
  }

  has(id) { return this.#skills.has(id); }

  get size() { return this.#skills.size; }
}
