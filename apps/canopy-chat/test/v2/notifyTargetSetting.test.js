/**
 * notifyOutOfCircle — the TARGET of the out-of-circle `notify`-mode notice (Frits' decision: make the notify
 * target a per-circle SETTING). Only consulted when `shareOutOfCircle === 'notify'`:
 *
 *   • 'admins' (DEFAULT — the quieter option) → the circle's admins are pinged via the injected `notify`
 *     emitter with { event:'item-shared-out-of-circle', itemId, fromCircleId, toCircleId, recipient, by }.
 *   • 'post' → a NOTICEBOARD post is written to the circle via the injected `post` emitter instead, TAGGED
 *     `category:'permission-log'` (+ `logKind`) so a FUTURE dedicated "logging" section can filter these
 *     permission notices OUT of the main board. (That logging section is DEFERRED — the post just carries the
 *     forward-compatible tag today.)
 *
 * These assert the SHARED-src routing (`shareItemToPublishedKey` → `emitOutOfCircleNotice`) at the injection
 * seam: both shells inject the real `notify`/`post` emitters (web≡mobile); here they are vi.fns so we prove the
 * routing + payload/tag. Memory path (no enforcement) — the share still lands ok, which is all the notice
 * routing needs. The prohibit/silent branches (owned elsewhere) are only checked NOT to fire a notify notice.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { shareItemToPublishedKey } from '../../src/v2/circleShare.js';
import { normalizeCirclePolicy, DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

function world() {
  const svc = makeCircleLists();
  return { svc, resolveService: async () => svc };
}

const RECIP = { recipient: 'did:dave', recipientNetworkKey: 'net-key-dave' };

describe('circlePolicy — notifyOutOfCircle setting', () => {
  it('defaults to "admins" (the quieter option) and is in the enum', () => {
    expect(DEFAULT_CIRCLE_POLICY.notifyOutOfCircle).toBe('admins');
    expect(normalizeCirclePolicy({}).notifyOutOfCircle).toBe('admins');
    expect(normalizeCirclePolicy({ notifyOutOfCircle: 'post' }).notifyOutOfCircle).toBe('post');
    // invalid → default
    expect(normalizeCirclePolicy({ notifyOutOfCircle: 'bogus' }).notifyOutOfCircle).toBe('admins');
  });
});

describe('shareItemToPublishedKey — notify TARGET routing (under shareOutOfCircle:notify)', () => {
  it('notifyOutOfCircle:"admins" → the ADMINS notify emitter fires with the right payload; no post', async () => {
    const { svc, resolveService } = world();
    const notify = vi.fn();
    const post = vi.fn();
    const src = await svc.createList('A', 'plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, notify, post,
      policyOf: () => ({ shareOutOfCircle: 'notify', notifyOutOfCircle: 'admins' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...RECIP,
    });

    expect(r.ok).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toEqual({
      event: 'item-shared-out-of-circle', itemId: src.id, fromCircleId: 'A', toCircleId: 'B',
      recipient: 'did:dave', by: 'alice',
    });
  });

  it('DEFAULT (no notifyOutOfCircle set) behaves as "admins"', async () => {
    const { svc, resolveService } = world();
    const notify = vi.fn();
    const post = vi.fn();
    const src = await svc.createList('A', 'plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, notify, post,
      policyOf: () => ({ shareOutOfCircle: 'notify' }),   // no notifyOutOfCircle ⇒ default 'admins'
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...RECIP,
    });

    expect(r.ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('notifyOutOfCircle:"post" → a CATEGORY-TAGGED noticeboard post is created; no admins notify', async () => {
    const { svc, resolveService } = world();
    const notify = vi.fn();
    const post = vi.fn();
    const src = await svc.createList('A', 'plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, notify, post,
      policyOf: () => ({ shareOutOfCircle: 'notify', notifyOutOfCircle: 'post' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...RECIP,
    });

    expect(r.ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    const wrote = post.mock.calls[0][0];
    // The forward-compat TAG a future logging section filters on — assert it is present.
    expect(wrote.category).toBe('permission-log');
    expect(wrote.logKind).toBe('item-shared-out-of-circle');
    // Reuses the existing noticeboard item machinery (a `type:'post'` item) + carries the event payload.
    expect(wrote.type).toBe('post');
    expect(wrote).toMatchObject({
      event: 'item-shared-out-of-circle', itemId: src.id, fromCircleId: 'A', toCircleId: 'B',
      recipient: 'did:dave', by: 'alice',
    });
  });
});

describe('shareItemToPublishedKey — the notify TARGET only fires under shareOutOfCircle:notify', () => {
  it('shareOutOfCircle:"silent" → neither the admins notify NOR the post fires (notify-only setting)', async () => {
    const { svc, resolveService } = world();
    const notify = vi.fn();
    const post = vi.fn();
    const src = await svc.createList('A', 'plan', 'alice');

    // silent WITHOUT the injected sealer/derivation degrades to a plain copy (memory path) — still ok — but the
    // notify TARGET must NOT fire: it belongs to the notify mode only.
    const r = await shareItemToPublishedKey({
      resolveService, notify, post,
      policyOf: () => ({ shareOutOfCircle: 'silent', notifyOutOfCircle: 'post' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...RECIP,
    });

    expect(r.ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('shareOutOfCircle:"prohibit" → refused; neither emitter fires', async () => {
    const { svc, resolveService } = world();
    const notify = vi.fn();
    const post = vi.fn();
    const src = await svc.createList('A', 'plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, notify, post,
      policyOf: () => ({ shareOutOfCircle: 'prohibit', notifyOutOfCircle: 'post' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...RECIP,
    });

    expect(r).toEqual({ ok: false, error: 'share-prohibited' });
    expect(notify).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
