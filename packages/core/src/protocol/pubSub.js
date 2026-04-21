/**
 * pubSub.js — topic-based publish/subscribe over PB envelopes.
 *
 * Native-to-native only. A2A peers use the 'subscribe' skill (streaming task).
 *
 * Agent keeps a subscriber registry: topic → Set<peerAddress>
 * When a peer sends { type:'subscribe', topic } as OW, we add them.
 * When a peer sends { type:'unsubscribe', topic } as OW, we remove them.
 * publish() fans out to all registered subscribers.
 */
import { Parts } from '../Parts.js';

/**
 * Subscribe to a topic on a publisher agent.
 * Sends a subscribe request and listens for PB envelopes from that peer.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   publisherAddress
 * @param {string}   topic
 * @param {Function} callback — called with (parts) on each published message
 */
export async function subscribe(agent, publisherAddress, topic, callback) {
  // Register listener BEFORE sending the subscribe OW so history replay
  // messages (fired as microtasks by the publisher) are not missed.
  agent.on('publish', ({ from, topic: t, parts }) => {
    if (from === publisherAddress && t === topic) callback(parts);
  });

  await agent.transport.sendOneWay(publisherAddress, { type: 'subscribe', topic });
}

/**
 * Unsubscribe from a topic on a publisher agent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} publisherAddress
 * @param {string} topic
 */
export async function unsubscribe(agent, publisherAddress, topic) {
  await agent.transport.sendOneWay(publisherAddress, { type: 'unsubscribe', topic });
}

/**
 * Publish a message to all local subscribers for a topic.
 * Uses OW (PB envelope type).
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   topic
 * @param {Array|*}  partsOrValue
 */
export async function publish(agent, topic, partsOrValue) {
  const parts = Parts.wrap(partsOrValue);

  // Store in history if the agent has history configured.
  const maxHistory = agent.pubSubHistory ?? 0;
  if (maxHistory > 0) {
    if (!agent._pubSubHistory) agent._pubSubHistory = new Map();
    if (!agent._pubSubHistory.has(topic)) agent._pubSubHistory.set(topic, []);
    const hist = agent._pubSubHistory.get(topic);
    hist.push(parts);
    while (hist.length > maxHistory) hist.shift();
  }

  const subs = agent._pubSubSubscribers?.get(topic);
  if (!subs || subs.size === 0) return;

  await Promise.all([...subs].map(addr =>
    agent.transport.sendOneWay(addr, { type: 'publish', topic, parts })
      .catch(err => agent.emit('error', err)),
  ));
}

/**
 * Handle an inbound subscribe/unsubscribe/publish OW envelope.
 * Returns true if handled.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 */
export function handlePubSub(agent, envelope) {
  const { type, topic, parts = [] } = envelope.payload ?? {};

  switch (type) {
    case 'subscribe': {
      if (!agent._pubSubSubscribers) agent._pubSubSubscribers = new Map();
      if (!agent._pubSubSubscribers.has(topic)) agent._pubSubSubscribers.set(topic, new Set());
      agent._pubSubSubscribers.get(topic).add(envelope._from);
      // Replay history to new subscriber.
      const history = agent._pubSubHistory?.get(topic);
      if (history?.length) {
        for (const parts of history) {
          agent.transport.sendOneWay(envelope._from, { type: 'publish', topic, parts })
            .catch(err => agent.emit('error', err));
        }
      }
      return true;
    }
    case 'unsubscribe': {
      agent._pubSubSubscribers?.get(topic)?.delete(envelope._from);
      return true;
    }
    case 'publish': {
      // Inbound publish from a peer (for local subscribers who used subscribe()).
      agent.emit('publish', { from: envelope._from, topic, parts });
      return true;
    }
    default:
      return false;
  }
}
