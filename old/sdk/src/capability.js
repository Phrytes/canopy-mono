/**
 * capability() — register a function as an A2A agent skill.
 *
 * Works in three ways:
 *
 * 1. HOF (works everywhere, no build step needed):
 *
 *      const myFn = capability({ agent: 'my-agent', skill: 'do_thing' })(
 *        async (params) => { ... }
 *      );
 *
 * 2. Method decorator (TC39 Stage 3, TypeScript 5+, Babel):
 *
 *      class MyService {
 *        @capability({ agent: 'my-agent', skill: 'do_thing' })
 *        async doThing(params) { ... }
 *      }
 *
 * 3. Register on an Agent instance directly (most explicit):
 *
 *      agent.register('do_thing', async (params) => { ... }, { name: 'Do Thing' });
 *
 * For options 1 and 2, AgentApp.start() scans the global registry and wires
 * each function to the agent identified by meta.agent.
 */

// Global registry: agentId -> Map<skillId, { handler, meta }>
const _registry = new Map();

export function getRegistry() {
  return _registry;
}

export function capability(meta = {}) {
  const { agent: agentId, skill, id, ...rest } = meta;
  const skillId = skill ?? id;

  if (!agentId) throw new Error('capability() requires an "agent" id');
  if (!skillId) throw new Error('capability() requires a "skill" id');

  function decorator(target, context) {
    // ── Stage 3 decorator (context object present) ──
    if (context && typeof context === 'object' && context.kind) {
      if (context.kind !== 'method') {
        throw new Error('@capability can only decorate methods');
      }
      _register(agentId, skillId, target, rest);
      return target;
    }

    // ── HOF usage: target is the function ──
    if (typeof target === 'function') {
      _register(agentId, skillId, target, rest);
      return target;
    }

    throw new Error('capability() must wrap a function');
  }

  return decorator;
}

function _register(agentId, skillId, handler, meta) {
  if (!_registry.has(agentId)) {
    _registry.set(agentId, new Map());
  }
  _registry.get(agentId).set(skillId, { handler, meta: { id: skillId, ...meta } });
}
