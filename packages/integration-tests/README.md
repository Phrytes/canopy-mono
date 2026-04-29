# @canopy/integration-tests

Cross-component scenario tests for the @canopy SDK.

This workspace hosts the **scenario-based integration tier** of the SDK
test strategy.  Unit tests live alongside their packages
(`packages/core/test/`, `packages/relay/test/`, etc.); this workspace
covers flows that span multiple packages — routing across transports,
identity recovery via the pod, governance role transitions mid-call,
and so on.

See:
- [`coding-plans/sdk-test-strategy.md`](../../coding-plans/sdk-test-strategy.md) — the strategy.
- [`coding-plans/sdk-test-implementation.md`](../../coding-plans/sdk-test-implementation.md) — task plan for T.1–T.7.

## Running

```bash
# From repo root
npm run test:scenarios          # runs only this workspace
npm test                        # runs everything, including this

# From this workspace
npm test                        # vitest run
npm run test:watch              # vitest watch mode
```

## Writing a scenario

Scenario files live under `test/<area>/<name>.scenario.test.js` (post-T.1).
Each scenario boots a `Lab`, drives a flow, asserts on the outcome.

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Lab } from '@canopy/integration-tests';

describe('routing/fall-through', () => {
  let lab;
  beforeEach(async () => {
    lab = await Lab.boot({
      agents:   ['alice', 'bob', 'carol'],
      relay:    'in-process',
      pod:      'mock',
      topology: 'mesh',
    });
  });
  afterEach(() => lab.teardown());

  it('falls through direct → relay → hop as transports drop', async () => {
    // ... drive the flow via lab helpers + assert via lab.assertRoute ...
  });
});
```

## Lab API reference

### Boot / teardown

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await Lab.boot(opts)`                                         | Construct N agents on a shared InternalBus.                  |
| `lab.teardown()`                                               | Stop all agents, restore monkey-patches, drop the bus.       |
| `lab.agent(name)`                                              | Underlying `Agent` instance (escape hatch).                  |
| `lab.relay()`                                                  | The in-process relay handle, if `relay: 'in-process'`.       |
| `lab.pod(name)`                                                | The agent's MockPod (or throw if `pod: 'real:css'` — v2).    |
| `lab.agentNames()`                                             | All booted agent names.                                      |

### Network manipulation

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `lab.partitionMesh(groups)`                                    | Hard partition into N groups (cross-group sends drop).       |
| `lab.healPartition()`                                          | Restore full delivery.                                       |
| `lab.dropTransport(agent, name)`                               | Disable one transport on one agent.                          |
| `lab.addTransport(agent, name)`                                | Re-enable it.                                                |
| `lab.injectLatency(a, b, ms)`                                  | Add per-transport latency (v1: applies to all of `a`'s out). |

### Agent lifecycle

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.killAgent(name)`                                    | Stop the agent; mark slot dead.                              |
| `await lab.restartAgent(name)`                                 | Re-boot with the SAME identity (vault restore).              |
| `await lab.respawnFromMnemonic(name, mnemonic)`                | Re-boot with a fresh identity from a BIP-39 phrase.          |

### Clock control

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.advanceTime(ms)`                                    | `vi.advanceTimersByTime(ms)` (caller manages fake-timers).   |
| `lab.injectClockSkew(name, offsetMs)`                          | Set the agent's MockClock offset (see v1 limitation below).  |
| `lab.clock(name)`                                              | The agent's `MockClock` — `clock.now()`, `clock.date()`.     |

**v1 clock-skew limitation:** the SDK reads time via raw `Date.now()` in
~100 places.  `injectClockSkew` sets a per-agent MockClock that
*scenarios* can read; the SDK ITSELF doesn't honour the offset until
the v2 clock-injection refactor lands (tracked in `TODO-GENERAL.md`
under HIGH PRIORITY).  Scenarios that depend on the SDK using the
skewed clock for replay-window checks, token expiry, etc. must wait.

### Inspection

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.routeFor(a, b)`                                     | `{ tier, transport, via? }` (default `'direct'`/`'internal'`).|
| `lab.peers(name)`                                              | Names of peers known to the agent.                           |

### Sugar — agent operations

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.invoke(a, b, skill, input, opts?)`                  | Sugar over `agent.invoke`; auto-wraps input via Parts.       |
| `lab.invokeStream(a, b, skill, input, opts?)`                  | Returns a `Task` for streaming + cancel.                     |

### Sugar — pod operations

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.podWrite(name, uri, content, opts?)`                | MockPod write.                                               |
| `await lab.podRead(name, uri, opts?)`                          | MockPod read.                                                |
| `await lab.podList(name, container, opts?)`                    | MockPod list.                                                |
| `await lab.podDelete(name, uri, opts?)`                        | MockPod delete.                                              |

### Assertions (vitest-aware)

| Method                                                         | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `await lab.assertRoute(a, b, expected)`                        | `expected = { tier?, transport?, via? }`.                    |
| `await lab.assertNoLeak(viaName, secretBytes)`                 | Bridge log doesn't contain `secretBytes` (call `enableLeakLogging` first). |
| `lab.enableLeakLogging(viaName)`                               | Start capturing every envelope through the agent.            |
| `await lab.assertManifestIntact(name)`                         | `IdentityPodStore.verifyManifest` (attach store first).      |
| `lab.attachIdentityPodStore(name, store)`                      | Wire a store into a slot for assertions.                     |
| `await lab.assertSyncConverged(names, path)`                   | All named agents have matching content at `path`.            |

## Harness invariants

- **No real network.**  Every transport is in-process unless a scenario
  opts in to `relay: 'in-process'` (still localhost; no real wire).
- **No real pod by default.**  `pod: 'mock'` is in-memory.  `pod: 'real:css'`
  is opt-in (T.6) and currently not implemented.
- **Deterministic.**  Identities are random per boot but local; bus delivery
  is microtask-async.  Scenarios should not introduce wall-clock dependencies
  beyond what the SDK already has.
- **Teardown leaves no timers.**  Each scenario MUST call `lab.teardown()`
  in `afterEach` (or equivalent).  `teardown` is idempotent.
