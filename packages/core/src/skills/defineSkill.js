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
 * @typedef {'public'|'authenticated'|'trusted'|'private'} TierVisibility
 * @typedef {{ groups: string[], default?: 'hidden'|'visible' }} GroupVisibility
 * @typedef {TierVisibility|GroupVisibility} Visibility
 *
 * @typedef {'always'|'negotiable'} Posture
 * @typedef {'never'|'either'|'required'} HumanInTheLoop
 *
 * @typedef {object} SkillDefinition
 * @property {string}         id
 * @property {Function}       handler
 * @property {string}         description
 * @property {string[]}       inputModes     — accepted MIME types
 * @property {string[]}       outputModes    — produced MIME types
 * @property {string[]}       tags
 * @property {boolean}        streaming      — supports ST/SE/BT streaming
 * @property {Visibility}     visibility     — tier string or { groups, default }
 * @property {string}         policy         — 'on-request'|'always-allow'|'requires-token'
 * @property {Posture}        posture        — 'always' (committed) | 'negotiable' (offer / counter)
 * @property {HumanInTheLoop} humanInTheLoop — 'never' (machine only) | 'either' | 'required' (human only)
 * @property {boolean}        enabled
 */

const TIERS    = ['public', 'authenticated', 'trusted', 'private'];
const POSTURES = ['always', 'negotiable'];
const HITL     = ['never', 'either', 'required'];

export function defineSkill(id, handler, opts = {}) {
  if (!id || typeof id !== 'string') throw new Error('defineSkill: id must be a non-empty string');
  if (typeof handler !== 'function') throw new Error(`defineSkill "${id}": handler must be a function`);

  return {
    id,
    handler,
    description:    opts.description  ?? '',
    inputModes:     opts.inputModes   ?? ['application/json'],
    outputModes:    opts.outputModes  ?? ['application/json'],
    tags:           opts.tags         ?? [],
    streaming:      opts.streaming    ?? false,
    visibility:     _validateVisibility(opts.visibility, id),
    policy:         opts.policy       ?? 'on-request',
    posture:        _validatePosture(opts.posture, id),
    humanInTheLoop: _validateHumanInTheLoop(opts.humanInTheLoop, id),
    enabled:        opts.enabled      ?? true,
  };
}

function _validatePosture(p, skillId) {
  if (p == null) return 'always';
  if (typeof p !== 'string' || !POSTURES.includes(p)) {
    throw new Error(
      `defineSkill "${skillId}": posture must be one of ${POSTURES.map(x => `'${x}'`).join(' | ')}`
    );
  }
  return p;
}

function _validateHumanInTheLoop(h, skillId) {
  if (h == null) return 'never';
  if (typeof h !== 'string' || !HITL.includes(h)) {
    throw new Error(
      `defineSkill "${skillId}": humanInTheLoop must be one of ${HITL.map(x => `'${x}'`).join(' | ')}`
    );
  }
  return h;
}

function _validateVisibility(v, skillId) {
  if (v == null) return 'authenticated';
  if (typeof v === 'string') {
    if (!TIERS.includes(v)) {
      throw new Error(`defineSkill "${skillId}": unknown visibility tier "${v}"`);
    }
    return v;
  }
  if (typeof v === 'object' && Array.isArray(v.groups)) {
    if (v.groups.length === 0) {
      throw new Error(`defineSkill "${skillId}": visibility.groups must be non-empty`);
    }
    const defaultMode = v.default ?? 'hidden';
    if (defaultMode !== 'hidden' && defaultMode !== 'visible') {
      throw new Error(`defineSkill "${skillId}": visibility.default must be 'hidden' or 'visible'`);
    }
    return { groups: [...v.groups], default: defaultMode };
  }
  throw new Error(`defineSkill "${skillId}": visibility must be a tier string or { groups, default }`);
}

/**
 * Normalise a visibility value into a tagged union that every consumer
 * (SkillRegistry.forCaller, Agent.export, skillDiscovery, handleTaskRequest)
 * can inspect without re-running shape checks.
 *
 *   'authenticated'                → { kind: 'tier',   tier: 'authenticated' }
 *   { groups: ['ops'], default: 'hidden' }
 *                                  → { kind: 'groups', groups: ['ops'], default: 'hidden' }
 */
export function normaliseVisibility(v) {
  if (typeof v === 'string' || v == null) {
    return { kind: 'tier', tier: v ?? 'authenticated' };
  }
  if (typeof v === 'object' && Array.isArray(v.groups)) {
    return {
      kind:    'groups',
      groups:  [...v.groups],
      default: v.default ?? 'hidden',
    };
  }
  throw new Error('normaliseVisibility: unknown visibility shape');
}
