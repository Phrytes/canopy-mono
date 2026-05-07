import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectPlatform,
  isReactNative,
  _resetPlatformCache,
} from '../src/platform/service-factory.js';

describe('service-factory.selectPlatform', () => {
  beforeEach(() => {
    _resetPlatformCache();
  });

  it('returns the default factory result on Node (no RN navigator)', () => {
    const result = selectPlatform({
      rn:      () => 'rn',
      default: () => 'node',
    });
    expect(result).toBe('node');
  });

  it('detects RN when navigator.product === "ReactNative"', () => {
    const original = globalThis.navigator;
    globalThis.navigator = { product: 'ReactNative' };
    _resetPlatformCache();

    expect(isReactNative()).toBe(true);
    const result = selectPlatform({
      rn:      () => 'rn',
      default: () => 'node',
    });
    expect(result).toBe('rn');

    globalThis.navigator = original;
    _resetPlatformCache();
  });

  it('throws when factories are not functions (lazy resolution required)', () => {
    expect(() =>
      selectPlatform({ rn: 'rn', default: () => 'node' }),
    ).toThrow(TypeError);
    expect(() =>
      selectPlatform({ rn: () => 'rn', default: 'node' }),
    ).toThrow(TypeError);
  });

  it('caches the platform decision across calls', () => {
    let calls = 0;
    selectPlatform({
      rn:      () => { calls++; return 'rn'; },
      default: () => { calls++; return 'node'; },
    });
    selectPlatform({
      rn:      () => 'rn',
      default: () => 'node',
    });
    expect(calls).toBe(1); // only the default factory ran, once
  });
});
