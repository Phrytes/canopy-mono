/**
 * Slice D.1 — stoop manifest structural-invariants test.
 *
 * Asserts the DRAFT manifest validates via `@canopy/app-manifest`'s
 * `validateManifest` and conforms to the basic shape the slash + chat
 * surfaces require:
 *
 *   - validateManifest(stoopManifest).ok === true
 *   - every op id is unique
 *   - every op declares { id, verb, surfaces.chat.hint,
 *     surfaces.slash.command }
 *   - no slash command in stoop's set collides with household's
 *     (snapshot stoop's set; consumer can spot-check vs household
 *     manually per the audit's collision-policy guidance).
 *
 * Per `AUDIT-slash-coverage.md`: cross-app collision *resolution* is
 * a consumer-side host policy, but Slice D.1 explicitly chose the
 * grammar to MINIMISE collisions at the source.  This test pins the
 * stoop command set so the choice is auditable + regression-tested.
 */

import { describe, it, expect } from 'vitest';

import { validateManifest } from '@canopy/app-manifest';

import { stoopManifest }     from '../manifest.js';

// Frozen snapshot of household's slash commands as of 2026-05-20
// (apps/household/manifest.js lines 59/78/96/116/134/153/171/186/222).
// If household grows new commands, that's a *new* potential collision —
// re-run this test in CI to surface it.
const HOUSEHOLD_COMMANDS = Object.freeze([
  '/add',
  '/list',
  '/done',
  '/remove',
  '/help',
  '/task',
  '/tasks',
  '/claim',
  '/register',
]);

describe('stoop manifest — Slice D.1 structural invariants', () => {
  it('validates via @canopy/app-manifest validateManifest', () => {
    const result = validateManifest(stoopManifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('every op id is unique', () => {
    const ids = stoopManifest.operations.map((op) => op.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('every op declares { id, verb, surfaces.chat.hint, surfaces.slash.command }', () => {
    for (const op of stoopManifest.operations) {
      expect(op.id, `op missing id: ${JSON.stringify(op)}`).toBeTruthy();
      expect(typeof op.id, `${op.id} id-type`).toBe('string');

      expect(op.verb, `${op.id} verb`).toBeTruthy();
      expect(typeof op.verb, `${op.id} verb-type`).toBe('string');

      expect(op.surfaces, `${op.id} surfaces`).toBeDefined();
      expect(op.surfaces.chat, `${op.id} surfaces.chat`).toBeDefined();
      expect(op.surfaces.chat.hint, `${op.id} surfaces.chat.hint`).toBeTruthy();
      expect(typeof op.surfaces.chat.hint, `${op.id} hint-type`).toBe('string');

      expect(op.surfaces.slash, `${op.id} surfaces.slash`).toBeDefined();
      expect(op.surfaces.slash.command, `${op.id} surfaces.slash.command`).toBeTruthy();
      expect(typeof op.surfaces.slash.command, `${op.id} command-type`).toBe('string');
      expect(op.surfaces.slash.command.startsWith('/'), `${op.id} command starts with /`).toBe(true);
    }
  });

  it("does not collide with household's slash commands (D.1 minimise-collision goal)", () => {
    const stoopCommands = stoopManifest.operations.map((op) => op.surfaces.slash.command);
    const collisions = stoopCommands.filter((c) => HOUSEHOLD_COMMANDS.includes(c));
    expect(
      collisions,
      `stoop commands ${JSON.stringify(stoopCommands)} collide with household commands ${JSON.stringify(collisions)}`,
    ).toEqual([]);
  });

  it("ships ~12–15 ops covering stoop's primary flows (per AUDIT-stoop-folio-surfaces.md)", () => {
    expect(stoopManifest.operations.length).toBeGreaterThanOrEqual(12);
    expect(stoopManifest.operations.length).toBeLessThanOrEqual(15);
  });

  it('declares the eight stoop itemTypes from src/lib/itemTypes.js', () => {
    expect(stoopManifest.itemTypes).toEqual([
      'ask',
      'offer',
      'lend',
      'report',
      'group-rules',
      'rules-accept',
      'group-leave',
      'request',
    ]);
  });
});
