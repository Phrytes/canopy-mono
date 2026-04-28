/**
 * @canopy/core — public API
 *
 * Exports every stable surface that downstream packages and applications
 * should import. Internal helpers (b64, canonicalize, etc.) are intentionally
 * not exported here; import them directly if needed.
 */

// ── Envelope ────────────────────────────────────────────────────────────────
export { P, REPLY_CODES, mkEnvelope, canonicalize, isEnvelope } from './Envelope.js';

// ── Parts ───────────────────────────────────────────────────────────────────
export {
  TextPart,
  DataPart,
  FilePart,
  ImagePart,
  Parts,
} from './Parts.js';

// ── Identity ────────────────────────────────────────────────────────────────
export { Vault }              from './identity/Vault.js';
export { VaultMemory }        from './identity/VaultMemory.js';
export { VaultLocalStorage }  from './identity/VaultLocalStorage.js';
export { VaultIndexedDB }     from './identity/VaultIndexedDB.js';
export { VaultNodeFs }        from './identity/VaultNodeFs.js';
export { AgentIdentity }      from './identity/AgentIdentity.js';
export { KeyRotation }        from './identity/KeyRotation.js';
export { Bootstrap }          from './identity/Bootstrap.js';
export {
  generateMnemonic,
  mnemonicToSeed,
  seedToMnemonic,
  validateMnemonic,
} from './identity/Mnemonic.js';

// ── Security ─────────────────────────────────────────────────────────────────
export { SecurityLayer, SecurityError, SEC } from './security/SecurityLayer.js';
export {
  signReachabilityClaim,
  verifyReachabilityClaim,
  createMemorySeqStore,
  CLAIM_VERSION,
  DEFAULT_VERIFY_LIMITS,
}                                            from './security/reachabilityClaim.js';
export {
  signOrigin,
  verifyOrigin,
  ORIGIN_SIG_VERSION,
  DEFAULT_ORIGIN_WINDOW_MS,
}                                            from './security/originSignature.js';
export {
  packSealed,
  openSealed,
  SEALED_VERSION,
}                                            from './security/sealedForward.js';

// ── Transport ────────────────────────────────────────────────────────────────
export { Transport }                      from './transport/Transport.js';
export { InternalBus, InternalTransport } from './transport/InternalTransport.js';
export { RelayTransport }                 from './transport/RelayTransport.js';
export { MqttTransport }                  from './transport/MqttTransport.js';
export { NknTransport }                   from './transport/NknTransport.js';
export { LocalTransport }                 from './transport/LocalTransport.js';
export { RendezvousTransport }            from './transport/RendezvousTransport.js';
export { OfflineTransport }               from './transport/OfflineTransport.js';

// ── Skills ────────────────────────────────────────────────────────────────────
export { defineSkill }         from './skills/defineSkill.js';
export { SkillRegistry }       from './skills/SkillRegistry.js';
export { registerRelayForward }        from './skills/relayForward.js';
export { registerRelayReceiveSealed }  from './skills/relayReceiveSealed.js';
export { registerReachablePeersSkill } from './skills/reachablePeers.js';
export { registerCapabilitiesSkill }   from './skills/capabilities.js';
export { registerTunnelOpen }          from './skills/tunnelOpen.js';
export { registerTunnelOw }            from './skills/tunnelOw.js';
export { registerTunnelReceiveSealed } from './skills/tunnelReceiveSealed.js';
export { TunnelSessions }              from './skills/tunnelSessions.js';
export { generateTunnelKey,
         sealTunnelOW,
         openTunnelOW }                from './security/tunnelSeal.js';

// ── Protocol ──────────────────────────────────────────────────────────────────
export { Task }                                           from './protocol/Task.js';
export { ping }                                           from './protocol/ping.js';
export { sendMessage, handleMessage }                     from './protocol/messaging.js';
export { sendHello, handleHello }                         from './protocol/hello.js';
export { requestSkills, handleSkillDiscovery }            from './protocol/skillDiscovery.js';
export { callSkill, handleTaskRequest, handleTaskOneWay } from './protocol/taskExchange.js';
export { subscribe, unsubscribe, publish, handlePubSub }  from './protocol/pubSub.js';
export { streamOut, handleStreamChunk, streamBidi }       from './protocol/streaming.js';
export {
  handleSessionOpen, handleSessionMessage, handleSessionClose,
  registerSessionSkills,
}                                                         from './protocol/session.js';
export {
  sendFile, bulkTransferSend, handleBulkChunk,
}                                                         from './protocol/fileSharing.js';

// ── State ─────────────────────────────────────────────────────────────────────
export { StateManager } from './state/StateManager.js';

// ── Permissions ───────────────────────────────────────────────────────────────
export { TrustRegistry, TIER_LEVEL } from './permissions/TrustRegistry.js';
export { PolicyEngine }     from './permissions/PolicyEngine.js';
export { CapabilityToken }  from './permissions/CapabilityToken.js';
export { TokenRegistry }    from './permissions/TokenRegistry.js';
export { GroupManager }     from './permissions/GroupManager.js';
export { DataSourcePolicy, DataSourceAccessDeniedError } from './permissions/DataSourcePolicy.js';

// ── Routing (Group G) ────────────────────────────────────────────────────────
export { FallbackTable }                       from './routing/FallbackTable.js';
export { RoutingStrategy, TRANSPORT_PRIORITY } from './routing/RoutingStrategy.js';
export { invokeWithHop }                       from './routing/invokeWithHop.js';
export {
  default as ReachabilityTier,
  TIERS as REACHABILITY_TIERS,
  tierForTransport,
  tierForRouteVia,
  compareTiers,
}                                              from './routing/ReachabilityTier.js';

// ── Discovery (Group G) ──────────────────────────────────────────────────────
export { PeerGraph }      from './discovery/PeerGraph.js';
export { PeerDiscovery }  from './discovery/PeerDiscovery.js';
export { GossipProtocol } from './discovery/GossipProtocol.js';
export { PingScheduler }  from './discovery/PingScheduler.js';
export { pullPeerList }   from './discovery/pullPeerList.js';

// ── A2A layer (Group H) ───────────────────────────────────────────────────────
export { A2ATLSLayer }      from './a2a/A2ATLSLayer.js';
export { A2AAuth }          from './a2a/A2AAuth.js';
export { A2ATransport }     from './a2a/A2ATransport.js';
export { AgentCardBuilder } from './a2a/AgentCardBuilder.js';
export { discoverA2A }      from './a2a/a2aDiscover.js';
export { sendA2ATask }      from './a2a/a2aTaskSend.js';
export { sendA2AStreamTask } from './a2a/a2aTaskSubscribe.js';

// ── Storage (Group I) ────────────────────────────────────────────────────────
export { DataSource }        from './storage/DataSource.js';
export { MemorySource }      from './storage/MemorySource.js';
export { IndexedDBSource }   from './storage/IndexedDBSource.js';
export { FileSystemSource }  from './storage/FileSystemSource.js';
export { SolidPodSource }    from './storage/SolidPodSource.js';
export { SolidVault }        from './storage/SolidVault.js';
export { StorageManager }    from './storage/StorageManager.js';

// ── Config ────────────────────────────────────────────────────────────────────
export { AgentConfig } from './config/AgentConfig.js';

// ── Agent ─────────────────────────────────────────────────────────────────────
export { Agent } from './Agent.js';

// ── Utilities ────────────────────────────────────────────────────────────────
export { Emitter } from './Emitter.js';
