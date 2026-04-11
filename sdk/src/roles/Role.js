/**
 * Role — a named, reusable set of properties: capabilities, policy, defaults.
 *
 * Roles support single-parent inheritance.
 * - Capability lists merge (union, parent-first) up the chain.
 * - Scalar fields (policy, description) override: child wins over parent.
 *
 * Example:
 *   Role.define('base',     { capabilities: ['echo', 'ping'] })
 *   Role.define('advanced', { extends: 'base', capabilities: ['calculate'], policy: { mode: 'group_only' } })
 *
 * Resolving 'advanced' yields: capabilities: ['echo', 'ping', 'calculate'], policy: { mode: 'group_only' }
 */
export class Role {
  #name;
  #extendsName;
  #capabilities;
  #policy;
  #extra;

  constructor({
    name,
    extends: extendsName = null,
    capabilities = [],
    policy = null,
    ...extra
  } = {}) {
    if (!name) throw new Error('Role requires a name');
    this.#name         = name;
    this.#extendsName  = extendsName;
    this.#capabilities = [...capabilities];
    this.#policy       = policy;
    this.#extra        = extra;
  }

  get name()        { return this.#name; }
  get extendsName() { return this.#extendsName; }
  get capabilities(){ return this.#capabilities; }
  get policy()      { return this.#policy; }

  /**
   * Resolve this role's effective definition by walking the inheritance chain.
   *
   * @param {Map<string, Role>} registry — the registry to look up parent roles
   * @returns {{ capabilities: string[], policy: object|null }}
   */
  resolve(registry) {
    const chain = this.#buildChain(registry);
    return Role.#merge(chain);
  }

  toJSON() {
    return {
      name:         this.#name,
      extends:      this.#extendsName ?? undefined,
      capabilities: this.#capabilities,
      policy:       this.#policy ?? undefined,
      ...this.#extra,
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  #buildChain(registry) {
    const chain   = [];
    let   current = this;
    const visited = new Set();

    while (current) {
      if (visited.has(current.#name)) break;   // cycle guard
      visited.add(current.#name);
      chain.unshift(current);                   // grandparent → parent → self
      current = current.#extendsName
        ? (registry.get(current.#extendsName) ?? null)
        : null;
    }
    return chain;
  }

  static #merge(chain) {
    // Capabilities: union, parent-first (earlier entries in chain come first)
    const caps = [];
    const seen = new Set();
    for (const role of chain) {
      for (const cap of role.#capabilities) {
        if (!seen.has(cap)) { caps.push(cap); seen.add(cap); }
      }
    }

    // Scalar fields: child-most wins (iterate forward, each overwrites)
    let policy = null;
    let extra  = {};
    for (const role of chain) {
      if (role.#policy !== null) policy = role.#policy;
      Object.assign(extra, role.#extra);
    }

    return { capabilities: caps, policy, ...extra };
  }
}
