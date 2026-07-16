/**
 * B · #81 — nouns migration for canopy-chat.
 *
 * Proof that canopy-chat's DECLARED item-type surface converges with the
 * shared `@onderling/item-types` registry (the L4≡B source of truth):
 *
 *   1. Every noun canopy-chat declares (`chat-thread`, `chat-message`) is a
 *      registry type — `isRegistryType` resolves it.
 *   2. `validateManifest(canopyChatManifest)` produces ZERO
 *      `noncanonical-itemtype` warnings (default posture).
 *   3. It passes under `{ strictNouns: true }` (the default-deny posture) —
 *      the registry-unknown-noun error path is empty. This is the migration's
 *      completion criterion for this app.
 *
 * NOTE — canopy-chat is the shell/unifier manifest and is deliberately EXEMPT
 * from declaring a `nouns` block: every op is an app-level command that names
 * NO item noun (0 noun-bearing atom ops), so there is nothing to curate.
 * Adding a vacuous `nouns:{}` would flip it to declared-authoritative and
 * silently drop future chat-thread/chat-message capabilities — the §1a closure
 * guard in `atom-discipline.test.js` enforces exactly that. #81 for this app is
 * therefore "register the declared nouns so itemTypes validate clean", NOT
 * "add a nouns block".
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, isRegistryType } from '@onderling/app-manifest';
import { canopyChatManifest } from '../manifest.js';

describe('B #81 — canopy-chat nouns migration', () => {
  it('every declared itemType resolves in the @onderling/item-types registry', () => {
    for (const t of canopyChatManifest.itemTypes) {
      expect(isRegistryType(t), `itemType "${t}" is not a registry type`).toBe(true);
    }
  });

  it('chat-thread + chat-message are both registry types', () => {
    expect(isRegistryType('chat-thread')).toBe(true);
    expect(isRegistryType('chat-message')).toBe(true);
  });

  it('validates with ZERO noncanonical-itemtype warnings (default posture)', () => {
    const { warnings } = validateManifest(canopyChatManifest);
    const noncanonical = warnings.filter((w) => w.code === 'noncanonical-itemtype');
    expect(noncanonical, JSON.stringify(noncanonical, null, 2)).toEqual([]);
  });

  it('passes under { strictNouns: true } — no registry-unknown-noun errors', () => {
    const { ok, errors } = validateManifest(canopyChatManifest, { strictNouns: true });
    const noncanonical = errors.filter((e) => e.code === 'noncanonical-itemtype');
    expect(noncanonical, JSON.stringify(noncanonical, null, 2)).toEqual([]);
    expect(ok).toBe(true);
  });
});
