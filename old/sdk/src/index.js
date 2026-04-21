// ── Core ──────────────────────────────────────────────────────────────────────
export { Agent }           from './Agent.js';
export { AgentFile }       from './AgentFile.js';
export { Emitter }         from './Emitter.js';
export { Task, TaskState } from './protocol/Task.js';

// ── Transport layer ───────────────────────────────────────────────────────────
export { Transport, PATTERNS } from './transport/Transport.js';
export { NknTransport }        from './transport/NknTransport.js';
export { MqttTransport }       from './transport/MqttTransport.js';
export { PeerJSTransport }     from './transport/PeerJSTransport.js';
export { BleTransport }        from './transport/BleTransport.js';

// ── Interaction pattern layer ─────────────────────────────────────────────────
export { P, mkEnvelope, isEnvelope } from './patterns/Envelope.js';
export { PatternHandler }            from './patterns/PatternHandler.js';
export { Session }                   from './patterns/Session.js';
export { Streaming }                 from './patterns/Streaming.js';
export { BulkTransfer }              from './patterns/BulkTransfer.js';

// ── Roles ─────────────────────────────────────────────────────────────────────
export { Role }                from './roles/Role.js';
export { RoleRegistry, roles } from './roles/RoleRegistry.js';

// ── Groups ────────────────────────────────────────────────────────────────────
export { GroupManager } from './groups/GroupManager.js';

// ── Discovery utilities ───────────────────────────────────────────────────────
export { AgentCache }    from './discovery/AgentCache.js';
export { PeerDiscovery } from './discovery/PeerDiscovery.js';
