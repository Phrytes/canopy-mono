/**
 * NudgeTimer — Phase 4 Stream 4a unit tests.
 *
 * All time-based assertions use vitest fake timers; nothing here
 * calls real `setTimeout`.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { NudgeTimer } from '../../src/scheduler/NudgeTimer.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

describe('NudgeTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('defaults `delayMs` to 3_600_000 (1 hour, per Q-H2.7)', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ onFire });
      timer.schedule('chat-1', 'item-1');

      // Just under one hour: nothing fires yet.
      await vi.advanceTimersByTimeAsync(ONE_HOUR_MS - 1);
      expect(onFire).not.toHaveBeenCalled();

      // Crossing the boundary: it fires exactly once.
      await vi.advanceTimersByTimeAsync(1);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith({
        chatId: 'chat-1',
        itemId: 'item-1',
      });
    });

    it('throws if `onFire` is not a function', () => {
      expect(() => new NudgeTimer({})).toThrow(TypeError);
      expect(() => new NudgeTimer({ onFire: 'nope' })).toThrow(TypeError);
    });

    it('throws on a negative or non-finite `delayMs`', () => {
      const onFire = () => {};
      expect(() => new NudgeTimer({ delayMs: -1, onFire })).toThrow(TypeError);
      expect(() => new NudgeTimer({ delayMs: Infinity, onFire })).toThrow(TypeError);
      expect(() => new NudgeTimer({ delayMs: 'soon', onFire })).toThrow(TypeError);
    });
  });

  describe('schedule + size', () => {
    it('`schedule` increments `size()`', () => {
      const timer = new NudgeTimer({ delayMs: 1000, onFire: vi.fn() });
      expect(timer.size()).toBe(0);

      timer.schedule('chat-1', 'item-1');
      expect(timer.size()).toBe(1);

      timer.schedule('chat-1', 'item-2');
      expect(timer.size()).toBe(2);

      timer.schedule('chat-2', 'item-3');
      expect(timer.size()).toBe(3);
    });

    it('after `delayMs` advance, `onFire` is called with the right payload and `size()` returns to 0', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 5000, onFire });

      timer.schedule('chat-A', 'item-A');
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(5000);

      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith({
        chatId: 'chat-A',
        itemId: 'item-A',
      });
      expect(timer.size()).toBe(0);
    });
  });

  describe('cancel', () => {
    it('`cancel` before maturity prevents `onFire`', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-1', 'item-1');
      timer.cancel('chat-1', 'item-1');

      expect(timer.size()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFire).not.toHaveBeenCalled();
    });

    it('`cancel` for an unknown key is a no-op', () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });
      expect(() => timer.cancel('ghost-chat', 'ghost-item')).not.toThrow();
      expect(timer.size()).toBe(0);
    });
  });

  describe('re-arm semantics', () => {
    it('re-`schedule` for the same key resets the countdown — fires only after the FULL `delayMs` from the LAST schedule', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-1', 'item-1');
      // Burn 600 ms of the original window…
      await vi.advanceTimersByTimeAsync(600);
      expect(onFire).not.toHaveBeenCalled();

      // …then re-arm.  Original timer must be cancelled.
      timer.schedule('chat-1', 'item-1');
      expect(timer.size()).toBe(1);

      // 600 ms more = 1200 ms since the *first* schedule.  The
      // FIRST timer would have fired 200 ms ago.  The re-armed one
      // must NOT have fired yet (only 600 / 1000 ms elapsed).
      await vi.advanceTimersByTimeAsync(600);
      expect(onFire).not.toHaveBeenCalled();

      // Cross the re-armed boundary.
      await vi.advanceTimersByTimeAsync(400);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(timer.size()).toBe(0);
    });
  });

  describe('cancelAll', () => {
    it('cancels every timer for the given chatId, leaves others intact', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-A', 'item-1');
      timer.schedule('chat-A', 'item-2');
      timer.schedule('chat-A', 'item-3');
      timer.schedule('chat-B', 'item-4');
      expect(timer.size()).toBe(4);

      timer.cancelAll('chat-A');
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith({
        chatId: 'chat-B',
        itemId: 'item-4',
      });
    });

    it('`cancelAll` for an unknown chatId is a no-op', () => {
      const timer = new NudgeTimer({ delayMs: 1000, onFire: vi.fn() });
      timer.schedule('chat-A', 'item-1');
      timer.cancelAll('chat-Z');
      expect(timer.size()).toBe(1);
    });
  });

  describe('stop', () => {
    it('`stop` clears every pending timer', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-1', 'a');
      timer.schedule('chat-1', 'b');
      timer.schedule('chat-2', 'c');
      expect(timer.size()).toBe(3);

      timer.stop();
      expect(timer.size()).toBe(0);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFire).not.toHaveBeenCalled();
    });

    it('`stop` is idempotent and the instance is still usable afterwards', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-1', 'a');
      timer.stop();
      timer.stop(); // no throw
      expect(timer.size()).toBe(0);

      // Still usable.
      timer.schedule('chat-2', 'b');
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith({
        chatId: 'chat-2',
        itemId: 'b',
      });
    });
  });

  describe('error handling in onFire', () => {
    it('a synchronous throw in `onFire` does not break subsequent timers', async () => {
      const calls = [];
      const timer = new NudgeTimer({
        delayMs: 1000,
        onFire: ({ chatId, itemId }) => {
          calls.push(`${chatId}/${itemId}`);
          if (itemId === 'bad') {
            throw new Error('boom');
          }
        },
      });

      timer.schedule('chat-1', 'bad');
      timer.schedule('chat-1', 'good');

      // Must not throw out of the timer callback.
      await expect(
        vi.advanceTimersByTimeAsync(1000),
      ).resolves.not.toThrow();

      expect(calls).toContain('chat-1/bad');
      expect(calls).toContain('chat-1/good');
      expect(timer.size()).toBe(0);
    });

    it('a rejecting async `onFire` does not break subsequent timers', async () => {
      const calls = [];
      const timer = new NudgeTimer({
        delayMs: 1000,
        onFire: async ({ chatId, itemId }) => {
          calls.push(`${chatId}/${itemId}`);
          if (itemId === 'bad') {
            throw new Error('async boom');
          }
        },
      });

      timer.schedule('chat-1', 'bad');
      timer.schedule('chat-1', 'good');

      await expect(
        vi.advanceTimersByTimeAsync(1000),
      ).resolves.not.toThrow();

      expect(calls).toContain('chat-1/bad');
      expect(calls).toContain('chat-1/good');
      expect(timer.size()).toBe(0);
    });
  });

  describe('concurrent timers', () => {
    it('different `(chatId, itemId)` pairs fire independently', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      // Three timers, scheduled at t=0, t=200, t=500.
      timer.schedule('chat-A', 'a1');
      await vi.advanceTimersByTimeAsync(200);
      timer.schedule('chat-A', 'a2');
      await vi.advanceTimersByTimeAsync(300);
      timer.schedule('chat-B', 'b1');

      expect(timer.size()).toBe(3);

      // t = 1000: first fires.
      await vi.advanceTimersByTimeAsync(500);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenLastCalledWith({
        chatId: 'chat-A',
        itemId: 'a1',
      });
      expect(timer.size()).toBe(2);

      // t = 1200: second fires.
      await vi.advanceTimersByTimeAsync(200);
      expect(onFire).toHaveBeenCalledTimes(2);
      expect(onFire).toHaveBeenLastCalledWith({
        chatId: 'chat-A',
        itemId: 'a2',
      });
      expect(timer.size()).toBe(1);

      // t = 1500: third fires.
      await vi.advanceTimersByTimeAsync(300);
      expect(onFire).toHaveBeenCalledTimes(3);
      expect(onFire).toHaveBeenLastCalledWith({
        chatId: 'chat-B',
        itemId: 'b1',
      });
      expect(timer.size()).toBe(0);
    });

    it('the same itemId in different chats does not collide', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-A', 'shared-id');
      timer.schedule('chat-B', 'shared-id');
      expect(timer.size()).toBe(2);

      timer.cancel('chat-A', 'shared-id');
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith({
        chatId: 'chat-B',
        itemId: 'shared-id',
      });
    });
  });

  describe('auto-cleanup', () => {
    it('after a timer fires it is removed from the internal map', async () => {
      const onFire = vi.fn();
      const timer = new NudgeTimer({ delayMs: 1000, onFire });

      timer.schedule('chat-1', 'item-1');
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(timer.size()).toBe(0);

      // Re-scheduling the same key works fine.
      timer.schedule('chat-1', 'item-1');
      expect(timer.size()).toBe(1);
    });

    it('an `onFire` that calls `schedule` for the same key re-arms cleanly', async () => {
      let fired = 0;
      let timerRef;
      const onFire = vi.fn(({ chatId, itemId }) => {
        fired += 1;
        if (fired === 1) {
          timerRef.schedule(chatId, itemId);
        }
      });
      const timer = new NudgeTimer({ delayMs: 1000, onFire });
      timerRef = timer;

      timer.schedule('chat-1', 'item-1');
      await vi.advanceTimersByTimeAsync(1000);
      expect(fired).toBe(1);
      // Re-armed inside the handler.
      expect(timer.size()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(fired).toBe(2);
      expect(timer.size()).toBe(0);
    });
  });
});
