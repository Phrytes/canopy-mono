import { describe, it, expect, beforeEach } from 'vitest';
import { log, dumpLogs, formatLogs, clearLogs, configureLog } from '@onderling/logger';

describe('@onderling/logger', () => {
  beforeEach(() => {
    clearLogs();
    let n = 0;
    configureLog({ min: 'debug', sink: null, max: 500, clock: () => (n += 1) });
  });

  it('records a tag/code event with sanitized scalar fields', () => {
    log.info('feedback', 'consent.stored', { n: 2, signed: true });
    const [rec] = dumpLogs();
    expect(rec).toMatchObject({ lvl: 'info', tag: 'feedback', code: 'consent.stored', f: { n: 2, signed: true } });
    expect(typeof rec.t).toBe('number');
  });

  it('is PII-safe: drops nested/container fields and truncates long strings', () => {
    log.warn('llm', 'clean.slow', { ms: 4200, note: 'x'.repeat(200), identity: { pubKey: 'SECRET' }, contributions: ['raw a', 'raw b'] });
    const { f } = dumpLogs()[0];
    expect(f.ms).toBe(4200);
    expect(f.note.length).toBeLessThanOrEqual(49);
    expect(f.note.endsWith('…')).toBe(true);
    expect(f).not.toHaveProperty('identity');
    expect(f).not.toHaveProperty('contributions');
  });

  it('has no free-text message parameter (structural privacy)', () => {
    log.error('agent', 'boot.failed', undefined);
    expect(dumpLogs()[0]).not.toHaveProperty('f');
    expect(dumpLogs()[0].code).toBe('boot.failed');
  });

  it('is a bounded ring buffer (oldest dropped past capacity)', () => {
    configureLog({ max: 3, clock: (() => { let n = 0; return () => (n += 1); })() });
    clearLogs();
    for (let i = 0; i < 5; i++) log.debug('t', `e${i}`);
    expect(dumpLogs().map((r) => r.code)).toEqual(['e2', 'e3', 'e4']);
  });

  it('respects the min level', () => {
    configureLog({ min: 'warn' });
    clearLogs();
    log.debug('t', 'noisy'); log.info('t', 'noisy'); log.warn('t', 'kept'); log.error('t', 'kept2');
    expect(dumpLogs().map((r) => r.code)).toEqual(['kept', 'kept2']);
  });

  it('formatLogs produces one PII-safe line per record', () => {
    log.info('feedback', 'round.opened', { round: 1 });
    log.error('pod', 'write.failed', { status: 502 });
    const out = formatLogs();
    expect(out).toContain('feedback/round.opened {"round":1}');
    expect(out).toContain('pod/write.failed {"status":502}');
    expect(out.split('\n')).toHaveLength(2);
  });
});
