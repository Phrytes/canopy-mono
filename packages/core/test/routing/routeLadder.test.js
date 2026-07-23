/**
 * routeLadder tests (C14) — the 'direct → mesh → hop → companion' rung
 * ladder on RoutingStrategy. Proves rung SELECTION in ladder order plus the
 * HONEST DEGRADE (logged + seam-marked) when a rung's adapter/route is absent.
 */
import { describe, it, expect, vi } from 'vitest';
import { RoutingStrategy } from '../../src/routing/RoutingStrategy.js';
import { TIERS }           from '../../src/routing/ReachabilityTier.js';

// Stub transport whose `.name` drives tier classification (see ReachabilityTier).
const mkTransport = (name) => ({ name });

describe('RoutingStrategy.routeLadder', () => {
  it('returns the four rungs in ladder order: direct → mesh → hop → companion', async () => {
    const rs = new RoutingStrategy({
      transports: { local: mkTransport('local'), relay: mkTransport('relay') },
    });
    const ladder = await rs.routeLadder('peer1');
    expect(ladder.map(r => r.tier)).toEqual([TIERS.DIRECT, TIERS.MESH, TIERS.HOP, TIERS.COMPANION]);
  });

  it('selects direct + mesh rungs from the real transports', async () => {
    const rs = new RoutingStrategy({
      transports: { local: mkTransport('local'), relay: mkTransport('relay') },
    });
    const [direct, mesh] = await rs.routeLadder('peer1');
    expect(direct).toMatchObject({ tier: TIERS.DIRECT, available: true, name: 'local' });
    expect(mesh).toMatchObject({ tier: TIERS.MESH, available: true, name: 'relay' });
    expect(direct.transport).toBeTruthy();
  });

  it('marks a tier with no transport as unavailable (no-transport)', async () => {
    const rs = new RoutingStrategy({ transports: { relay: mkTransport('relay') } });
    const [direct] = await rs.routeLadder('peer1');
    expect(direct).toMatchObject({ tier: TIERS.DIRECT, available: false, reason: 'no-transport' });
  });

  it('degrades hop + companion HONESTLY when no adapter is wired (seam + logged)', async () => {
    const logger = { warn: vi.fn() };
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
      logger,
    });
    const ladder = await rs.routeLadder('peerZ');
    const hop       = ladder.find(r => r.tier === TIERS.HOP);
    const companion = ladder.find(r => r.tier === TIERS.COMPANION);

    expect(hop).toMatchObject({ available: false, seam: true, reason: 'no-hop-bridge-resolver' });
    expect(companion).toMatchObject({ available: false, seam: true, reason: 'companion-adapter-not-wired' });

    // Honest-degrade is logged for both absent rungs.
    expect(logger.warn).toHaveBeenCalledTimes(2);
    const reasons = logger.warn.mock.calls.map(c => c[1]?.reason);
    expect(reasons).toEqual(expect.arrayContaining(['no-hop-bridge-resolver', 'companion-adapter-not-wired']));
  });

  it('selects the hop rung when a bridge resolver yields a reachable bridge', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
      hopResolver: () => ({ kind: 'hop', through: 'bridgeX' }),
    });
    const hop = (await rs.routeLadder('peer1')).find(r => r.tier === TIERS.HOP);
    expect(hop).toMatchObject({ tier: TIERS.HOP, available: true, through: 'bridgeX', name: 'relay' });
    expect(hop.transport).toBeTruthy();
  });

  it('accepts a per-call opts.via hop descriptor', async () => {
    const rs = new RoutingStrategy({ transports: { relay: mkTransport('relay') } });
    const hop = (await rs.routeLadder('peer1', { via: { kind: 'hop', through: 'bridgeY' } }))
      .find(r => r.tier === TIERS.HOP);
    expect(hop).toMatchObject({ available: true, through: 'bridgeY' });
  });

  it('reports hop-bridge-unreachable when the resolved bridge has no transport', async () => {
    const rs = new RoutingStrategy({
      transports: {},                                   // no transport reaches the bridge
      hopResolver: () => ({ kind: 'hop', through: 'ghost' }),
    });
    const hop = (await rs.routeLadder('peer1')).find(r => r.tier === TIERS.HOP);
    expect(hop).toMatchObject({ tier: TIERS.HOP, available: false, reason: 'hop-bridge-unreachable', through: 'ghost' });
    expect(hop.seam).toBeUndefined();                   // wiring present; runtime degrade, not a seam
  });

  it('selects the companion rung when opted-in, still flagging the adapter seam', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
      companionRoute: () => ({ kind: 'companion', through: 'my-companion' }),
    });
    const companion = (await rs.routeLadder('peer1')).find(r => r.tier === TIERS.COMPANION);
    expect(companion).toMatchObject({ tier: TIERS.COMPANION, available: true, through: 'my-companion', seam: true });
  });

  it('does not change selectTransport (additive regression guard)', async () => {
    const rs = new RoutingStrategy({
      transports: { local: mkTransport('local'), relay: mkTransport('relay') },
    });
    const before = await rs.selectTransport('peer1');
    await rs.routeLadder('peer1');
    const after  = await rs.selectTransport('peer1');
    expect(after?.name).toBe(before?.name);
    expect(after?.name).toBe('local');
  });
});
