import { Role } from './Role.js';

/**
 * RoleRegistry — a collection of named roles.
 *
 * Usage:
 *   import { roles } from 'canopy-sdk';
 *   roles.define('my-bot', { capabilities: ['echo'], policy: { mode: 'accept_all' } });
 *   const def = roles.resolve('my-bot');   // { capabilities: [...], policy: {...} }
 */
export class RoleRegistry {
  #roles = new Map();

  /**
   * Define a role.
   * @param {string} name
   * @param {object} def  — { extends?, capabilities?, policy?, ...rest }
   * @returns {this}
   */
  define(name, def) {
    this.#roles.set(name, new Role({ name, ...def }));
    return this;
  }

  /** Retrieve a Role by name, or null if not found. */
  get(name) { return this.#roles.get(name) ?? null; }

  /**
   * Resolve a role's effective definition (inheritance applied).
   * Throws if the role is not registered.
   */
  resolve(name) {
    const role = this.#roles.get(name);
    if (!role) throw new Error(`Unknown role: "${name}"`);
    return role.resolve(this.#roles);
  }

  list() { return Array.from(this.#roles.values()); }
}

/** Package-level default registry — import and use directly. */
export const roles = new RoleRegistry();
