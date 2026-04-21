/**
 * defineSkill — validate and normalise a skill definition.
 *
 * Fills in defaults for every optional field so SkillRegistry and
 * protocol handlers never need to null-check individual fields.
 *
 * Usage:
 *   import { defineSkill } from '@canopy/core';
 *   const skill = defineSkill('echo', async ({ parts }) => parts, {
 *     description: 'Echoes input back to caller',
 *   });
 *
 * The handler signature is:
 *   async handler({ parts, from, envelope }) → Part[] | any
 * Return value is auto-wrapped with Parts.wrap() if it is not already Part[].
 */

/** @typedef {import('../Parts.js').Part} Part */

/**
 * @typedef {object} SkillDefinition
 * @property {string}   id
 * @property {Function} handler
 * @property {string}   description
 * @property {string[]} inputModes     — accepted MIME types
 * @property {string[]} outputModes    — produced MIME types
 * @property {string[]} tags
 * @property {boolean}  streaming      — supports ST/SE/BT streaming
 * @property {string}   visibility     — 'public'|'authenticated'|'trusted'|'private'
 * @property {string}   policy         — 'on-request'|'always-allow'|'requires-token'
 * @property {boolean}  enabled
 */

export function defineSkill(id, handler, opts = {}) {
  if (!id || typeof id !== 'string') throw new Error('defineSkill: id must be a non-empty string');
  if (typeof handler !== 'function') throw new Error(`defineSkill "${id}": handler must be a function`);

  return {
    id,
    handler,
    description:  opts.description  ?? '',
    inputModes:   opts.inputModes   ?? ['application/json'],
    outputModes:  opts.outputModes  ?? ['application/json'],
    tags:         opts.tags         ?? [],
    streaming:    opts.streaming    ?? false,
    visibility:   opts.visibility   ?? 'authenticated',
    policy:       opts.policy       ?? 'on-request',
    enabled:      opts.enabled      ?? true,
  };
}
