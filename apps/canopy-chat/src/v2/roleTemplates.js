/**
 * canopy-chat v2 — N3 role templates (starter set, admin opt-in).
 *
 * Design (Q5, Frits 2026-04/06): a circle defaults to the minimalist
 * admin + member roles; when an admin *wants* an extra role they pick
 * from a small starter set of templates rather than hand-rolling a
 * capability set.  This module is the pure registry of those templates.
 *
 * Each template targets a base role from `@onderling/core` permissions
 * (admin 100 · coordinator 80 · member 60 · observer 40 · external 20),
 * carrying a friendly id, a locale-key pair for label + description, and
 * the rank so a circle can persist a self-describing role def (the rank
 * lives in the rules blob — we do NOT mutate the global Roles registry,
 * which is process-wide, from per-circle data).
 *
 * Enabled templates are persisted on the circle's rules doc as
 * `rules.roles` (an array of role defs), exactly like `rules.skills`:
 * `createGroupV2` spreads the rules blob, so joiners receive them in the
 * invite + consent screen.  Enforcement consuming circle-specific role
 * ranks is forward work; this slice ships the templates + the opt-in.
 */

/**
 * @typedef {object} RoleTemplate
 * @property {string} id        — role id persisted on members + rules
 * @property {number} rank      — privilege rank (mirrors @onderling/core)
 * @property {string} labelKey  — locale key for the role name
 * @property {string} descKey   — locale key for "what this role can do"
 * @property {string} baseRole  — the @onderling/core role it derives from
 */

/** @type {Record<string, RoleTemplate>} */
export const ROLE_TEMPLATES = Object.freeze({
  // A short visit — sees the circle, acts on nothing.
  guest: {
    id: 'guest', rank: 30, baseRole: 'observer',
    labelKey: 'role.guest.label', descKey: 'role.guest.desc',
  },
  // Follows along without taking part (new member, researcher).
  observer: {
    id: 'observer', rank: 40, baseRole: 'observer',
    labelKey: 'role.observer.label', descKey: 'role.observer.desc',
  },
  // Helps from outside with specific, time-boxed tasks.
  externalVolunteer: {
    id: 'external', rank: 20, baseRole: 'external',
    labelKey: 'role.external.label', descKey: 'role.external.desc',
  },
});

/** Template ids, in display order. */
export const ROLE_TEMPLATE_IDS = Object.freeze(Object.keys(ROLE_TEMPLATES));

/**
 * @param {string} templateId
 * @returns {RoleTemplate|null}
 */
export function roleTemplateById(templateId) {
  return Object.prototype.hasOwnProperty.call(ROLE_TEMPLATES, templateId)
    ? ROLE_TEMPLATES[templateId]
    : null;
}

/**
 * Map a list of selected template ids to deduped role defs ready to
 * persist on `rules.roles`.  Unknown ids are dropped; duplicate role
 * `id`s collapse (e.g. two templates targeting the same base role).
 *
 * @param {string[]} templateIds
 * @returns {Array<{id: string, rank: number, baseRole: string, template: string}>}
 */
export function applyRoleTemplates(templateIds) {
  if (!Array.isArray(templateIds)) return [];
  const byRoleId = new Map();
  for (const tid of templateIds) {
    const tpl = roleTemplateById(tid);
    if (!tpl) continue;
    if (!byRoleId.has(tpl.id)) {
      byRoleId.set(tpl.id, { id: tpl.id, rank: tpl.rank, baseRole: tpl.baseRole, template: tid });
    }
  }
  return [...byRoleId.values()];
}
