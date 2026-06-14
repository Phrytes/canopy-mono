/**
 * contact/bot exposed-skill registry on mobile (feedback-extension P4 parity).
 *
 * `bootAgentBundle` constructs the SHARED `createContactSkillRegistry` from
 * `agent.peers` in its real-boot path (and exposes it as `bundle.contactSkills`).
 * Real boot needs vaults + a live agent, so here we exercise the SAME shared
 * registry + a real `@canopy/core` PeerGraph through the same import paths the
 * bundle uses — proving the web≡mobile core resolves + runs under mobile's
 * module graph and that discover→synth→route→remove behaves identically.
 */
import { describe, it, expect, vi } from 'vitest';

import { createContactSkillRegistry } from '../../canopy-chat/src/v2/contactSkillsLive.js';
import { sendA2ATask } from '../../../packages/core/src/a2a/a2aTaskSend.js';
import { PeerGraph } from '../../../packages/core/src/discovery/PeerGraph.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function botPeer(url, skills) {
  return {
    type: 'a2a', url, name: 'Feedback bot', reachable: true,
    skills: skills.map((id) => ({ id, description: '', tags: [] })),
  };
}

describe('contact-skill registry — mobile parity', () => {
  it('the shared registry + core PeerGraph resolve through mobile imports', () => {
    expect(typeof createContactSkillRegistry).toBe('function');
    expect(typeof sendA2ATask).toBe('function');      // the bundle binds this
    expect(typeof PeerGraph).toBe('function');
  });

  it('a discovered bot routes a dispatch to it; removing it removes the skills', async () => {
    const peers = new PeerGraph();
    const sendTask = vi.fn(async (peerUrl, skillId, args) => ({ peerUrl, skillId, args }));
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask });
    await reg.start();

    await peers.upsert(botPeer('https://bot.example', ['summarise']));
    await flush();
    expect(reg.contacts()).toHaveLength(1);

    const res = await reg.callSkill('contact_x', 'summarise', { text: 'hi' });
    expect(res).toEqual({ peerUrl: 'https://bot.example', skillId: 'summarise', args: { text: 'hi' } });
    expect(sendTask).toHaveBeenCalledWith('https://bot.example', 'summarise', { text: 'hi' });

    await peers.remove('https://bot.example');
    await flush();
    expect(reg.has('https://bot.example')).toBe(false);
    expect(reg.callSkill('contact_x', 'summarise', {})).toBeUndefined();

    reg.dispose();
  });
});
