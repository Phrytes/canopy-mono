/**
 * pod-migration warning tests.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPodChange, renderPodMigrationCopy, POD_LEVEL_ORDER,
} from '../../src/v2/podMigrationWarning.js';

describe('classifyPodChange', () => {
  it('returns severity=none when from===to', () => {
    expect(classifyPodChange({ from: 'shared', to: 'shared' })).toEqual({
      severity: 'none', allowed: true, direction: 'same', summary: 'circle.podMigration.same',
    });
  });

  it('classifies unknown values as severity=none (defensive)', () => {
    const out = classifyPodChange({ from: 'wat', to: 'huh' });
    expect(out.severity).toBe('none');
    expect(out.allowed).toBe(true);
  });

  it('up + no content → severity=none (allow silently)', () => {
    const out = classifyPodChange({ from: 'none', to: 'shared', hasContent: false });
    expect(out).toEqual({
      severity: 'none', allowed: true, direction: 'up', summary: 'circle.podMigration.up_empty',
    });
  });

  it('up + has content → severity=info', () => {
    const out = classifyPodChange({ from: 'shared', to: 'personal', hasContent: true });
    expect(out).toEqual({
      severity: 'info', allowed: true, direction: 'up', summary: 'circle.podMigration.up_with_content',
    });
  });

  it('any down-move that is NOT to "none" → severity=warn (allowed)', () => {
    const out = classifyPodChange({ from: 'hybrid', to: 'shared', hasContent: true });
    expect(out).toEqual({
      severity: 'warn', allowed: true, direction: 'down', summary: 'circle.podMigration.down_with_content',
    });
  });

  it('down-to-none → severity=block + allowed=false', () => {
    const out = classifyPodChange({ from: 'shared', to: 'none', hasContent: true });
    expect(out).toEqual({
      severity: 'block', allowed: false, direction: 'down', summary: 'circle.podMigration.down_to_none',
    });
  });

  it('down to none from any non-none level blocks regardless of content state', () => {
    expect(classifyPodChange({ from: 'shared',   to: 'none', hasContent: false }).allowed).toBe(false);
    expect(classifyPodChange({ from: 'personal', to: 'none' }).allowed).toBe(false);
    expect(classifyPodChange({ from: 'hybrid',   to: 'none' }).allowed).toBe(false);
  });

  it('POD_LEVEL_ORDER pins the gradient (none < shared < personal < hybrid)', () => {
    expect(POD_LEVEL_ORDER).toEqual(['none', 'shared', 'personal', 'hybrid']);
  });
});

describe('renderPodMigrationCopy', () => {
  const t = (key) => `RENDER:${key}`;

  it('returns null for severity=none', () => {
    expect(renderPodMigrationCopy({ severity: 'none' }, t)).toBeNull();
    expect(renderPodMigrationCopy(null, t)).toBeNull();
  });

  it('passes the summary key through the translator', () => {
    const v = { severity: 'warn', allowed: true, summary: 'circle.podMigration.down_with_content' };
    expect(renderPodMigrationCopy(v, t)).toEqual({
      severity: 'warn', allowed: true, text: 'RENDER:circle.podMigration.down_with_content',
    });
  });

  it('falls back to key identity without a translator', () => {
    const v = { severity: 'warn', allowed: true, summary: 'k' };
    expect(renderPodMigrationCopy(v)).toEqual({ severity: 'warn', allowed: true, text: 'k' });
  });
});
