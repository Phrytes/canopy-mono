/**
 * SkillRegistry — stores and indexes SkillDefinitions.
 *
 * Skills are indexed by id. Duplicate registration replaces the previous
 * entry (last-write-wins), which allows agent files and blueprints to
 * override default skill definitions.
 */
import { defineSkill, normaliseVisibility } from './defineSkill.js';

/**
 * Indexed store of SkillDefinitions, keyed by id. Registration is last-write-wins
 * (replace() instead asserts the id already exists); forTier() and forCaller()
 * answer visibility-aware queries and getByPosture() filters on posture metadata.
 */
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

  /**
   * Replace an existing registration atomically.  Unlike `register()`
   * (which is silent last-write-wins), `replace()` asserts the id is
   * already registered — useful when an app rebinds a skill's
   * closure on context change (e.g. group switch) and wants a typo
   * to fail loudly rather than create a parallel definition.
   *
   * @param {import('./defineSkill.js').SkillDefinition} def
   */
  replace(def) {
    if (!def?.id) throw new Error('SkillRegistry.replace: definition must have an id');
    if (!this.#skills.has(def.id)) {
      throw new Error(`SkillRegistry.replace: skill "${def.id}" is not registered`);
    }
    this.#skills.set(def.id, def);
    return this;
  }

  /**
   * Remove a registration.  Idempotent — calling on an unknown id is
   * a no-op.  Returns true if a registration was removed.
   *
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    return this.#skills.delete(id);
  }

  /** @returns {import('./defineSkill.js').SkillDefinition|null} */
  get(id) { return this.#skills.get(id) ?? null; }

  /** @returns {import('./defineSkill.js').SkillDefinition[]} */
  all() { return [...this.#skills.values()]; }

  /**
   * Skills visible at a given trust tier.
   *
   * Group-visible skills (`visibility: { groups, default }`) are excluded
   * if `default === 'hidden'` and included if `default === 'visible'`.
   * Use `forCaller` for per-caller group-membership filtering.
   *
   * @param {'public'|'authenticated'|'trusted'|'private'} tier
   */
  forTier(tier) {
    const order = ['public', 'authenticated', 'trusted', 'private'];
    const idx   = order.indexOf(tier);
    return this.all().filter(s => {
      const v = normaliseVisibility(s.visibility);
      if (v.kind === 'tier') return order.indexOf(v.tier) <= idx;
      // Group-visible: only show on tier lookups when default is 'visible'.
      return v.default === 'visible';
    });
  }

  /**
   * Skills the given caller is allowed to see. Handles both tier-based
   * visibility (via `tier`) and group-based visibility (via `checkGroup`).
   *
   * @param {object} opts
   * @param {string}                             [opts.tier]        — caller's trust tier
   * @param {(pk: string, gid: string) => Promise<boolean>|boolean} [opts.checkGroup]
   *                                                                — predicate; typically
   *                                                                  `agent.security.groupManager.hasValidProof`
   * @param {string}                             [opts.callerPubKey] — forwarded to checkGroup
   * @returns {Promise<import('./defineSkill.js').SkillDefinition[]>}
   */
  async forCaller({ tier = 'authenticated', checkGroup, callerPubKey } = {}) {
    const order = ['public', 'authenticated', 'trusted', 'private'];
    const idx   = order.indexOf(tier);
    const out   = [];

    for (const s of this.all()) {
      const v = normaliseVisibility(s.visibility);

      if (v.kind === 'tier') {
        if (order.indexOf(v.tier) <= idx) out.push(s);
        continue;
      }

      // Group-visible.  Ask the supplied predicate for each listed group.
      let isMember = false;
      if (checkGroup && callerPubKey) {
        for (const gid of v.groups) {
          try {
            if (await checkGroup(callerPubKey, gid)) { isMember = true; break; }
          } catch {
            // Treat verifier throws as non-member (fail-closed).
          }
        }
      }

      if (isMember)                    out.push(s);
      else if (v.default === 'visible') out.push(s);
      // default 'hidden' → skip silently
    }
    return out;
  }

  /**
   * Filter registered skills by posture metadata.  Both filters are
   * optional and AND-combined; passing nothing returns all skills.
   *
   * Used by D2 (skills-pubsub) to bucket skills into the topic
   * hierarchy `skills:<group-id>:<posture>:<audience>:<skill-id>`.
   *
   * @param {object} [filter]
   * @param {'always'|'negotiable'}            [filter.posture]
   * @param {'never'|'either'|'required'}      [filter.humanInTheLoop]
   * @returns {import('./defineSkill.js').SkillDefinition[]}
   */
  getByPosture(filter = {}) {
    const { posture, humanInTheLoop } = filter;
    return this.all().filter(s => {
      if (posture        != null && s.posture        !== posture)        return false;
      if (humanInTheLoop != null && s.humanInTheLoop !== humanInTheLoop) return false;
      return true;
    });
  }

  has(id) { return this.#skills.has(id); }

  get size() { return this.#skills.size; }
}
