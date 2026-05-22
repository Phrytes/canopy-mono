/**
 * @canopy-app/calendar — createCalendarAgent.
 *
 * In-process boot: builds an `@canopy/core` Agent with the calendar
 * skills registered against a CalendarStore (default: in-memory).
 * canopy-chat composes this for the v0.7.10 demo.
 *
 * The same factory works for a real deployment in v0.7.11 — caller
 * passes their own pre-wired CalendarStore (backed by a real pod
 * via @canopy/pseudo-pod cache mode).
 */

import { Agent, AgentIdentity, InternalTransport } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { CalendarStore } from './CalendarStore.js';
import { registerCalendarSkills } from './skills/index.js';

/**
 * @param {object}  opts
 * @param {object}  opts.bus              `@canopy/core` InternalBus
 * @param {CalendarStore} [opts.store]    pre-wired store (otherwise in-memory)
 * @param {string}  [opts.actor]          default actor
 * @param {() => object}            [opts.simulateSync]
 * @param {(event: object) => void} [opts.publishEvent]
 * @returns {Promise<{
 *   agent: Agent,
 *   store: CalendarStore,
 *   address: string,
 * }>}
 */
export async function createCalendarAgent({ bus, store, actor, simulateSync, publishEvent }) {
  if (!bus) throw new TypeError('createCalendarAgent: bus required');
  const calStore = store ?? new CalendarStore({ actor });
  const id = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(bus, id.pubKey);
  const agent = new Agent({ identity: id, transport });

  registerCalendarSkills(agent, calStore, { simulateSync, publishEvent });

  await agent.start();
  return { agent, store: calStore, address: agent.address };
}
