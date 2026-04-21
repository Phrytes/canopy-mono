# Group D / E / F — remaining work

_Last updated: 2026-04-17_

---

## Group D — Protocol handlers

### Source files
| File | Status | Notes |
|------|--------|-------|
| `src/protocol/Task.js` | ✅ written | State machine, stream(), done(), cancel(), send() |
| `src/protocol/hello.js` | ✅ written | Bidirectional HI handshake |
| `src/protocol/ping.js` | ✅ written | Round-trip latency |
| `src/protocol/messaging.js` | ✅ written | sendMessage / handleMessage |
| `src/protocol/skillDiscovery.js` | ✅ written | requestSkills / handleSkillDiscovery |
| `src/protocol/taskExchange.js` | ✅ written | callSkill / handleTaskRequest / handleTaskOneWay |
| `src/protocol/pubSub.js` | ✅ written | subscribe / unsubscribe / publish / handlePubSub |
| `src/state/StateManager.js` | ✅ written | Task / stream / session registries |
| `src/protocol/streaming.js` | ✅ written | streamOut / handleStreamChunk / streamBidi |
| `src/protocol/session.js` | ✅ written | session-open / session-message / session-close + registerSessionSkills() |
| `src/protocol/fileSharing.js` | ✅ written | sendFile (smart dispatch) + bulkTransferSend + handleBulkChunk |

### Tests
| File | Status | Notes |
|------|--------|-------|
| `test/hello.test.js` | ✅ passing | 4 tests |
| `test/Task.test.js` | ✅ passing | 16 tests |
| `test/Agent.test.js` | ✅ passing | 17 tests |
| `test/ping.test.js` | ✅ passing | 4 tests |
| `test/messaging.test.js` | ✅ passing | 5 tests |
| `test/skillDiscovery.test.js` | ✅ passing | 5 tests |
| `test/pubSub.test.js` | ✅ passing | 6 tests |
| `test/StateManager.test.js` | ✅ passing | 16 tests |
| `test/streaming.test.js` | ✅ passing | 8 tests (streamOut, handleStreamChunk, Task.stream() integration) |
| `test/session.test.js` | ✅ passing | 8 tests (lifecycle, concurrent sessions, registerSessionSkills) |
| `test/fileSharing.test.js` | ✅ passing | 9 tests (inline, bulk, handleBulkChunk unit) |
| `test/negotiation.test.js` | ✅ passing | 7 tests (wizard, branching, parallel, cancel, error) |

---

## Group E — Permissions

### Source files
| File | Status | Notes |
|------|--------|-------|
| `src/permissions/TrustRegistry.js` | ✅ written | tier / group / tokenId storage in vault |
| `src/permissions/PolicyEngine.js` | ✅ written | checkInbound (visibility + policy + never gate) |
| `src/permissions/CapabilityToken.js` | ✅ written | issue / verify / verifyChain |
| `src/permissions/TokenRegistry.js` | ✅ written | store / get / revoke / cleanup |
| `src/permissions/GroupManager.js` | ✅ written | issueProof / storeProof / verifyProof / listGroups |
| `src/permissions/DataSourcePolicy.js` | ✅ written | allowedSkills / allowedAgents access control |

### Tests
| File | Status | Notes |
|------|--------|-------|
| `test/Permissions.test.js` | ✅ passing | 27 tests (TrustRegistry, PolicyEngine unit, CapabilityToken, TokenRegistry, GroupManager) |
| `test/PolicyEngine.integration.test.js` | ✅ passing | 10 tests — end-to-end blocking/allowing via Agent |

---

## Group F — Transport implementations

### Source files
| File | Status | Notes |
|------|--------|-------|
| `src/transport/NknTransport.js` | ✅ written | seed from pubKey, poll-retry on DataChannel transients |
| `src/transport/MqttTransport.js` | ✅ written | QoS-1, inbox topic per agent |
| `src/transport/RelayTransport.js` | ✅ written | WS relay, auto-reconnect with backoff |
| `src/transport/LocalTransport.js` | ✅ written | localhost WS / same relay protocol as RelayTransport |
| `src/transport/RendezvousTransport.js` | ✅ written | WebRTC DataChannel via signaling transport (browser / rtcLib polyfill) |

### Tests
| File | Status | Notes |
|------|--------|-------|
| `test/RelayTransport.test.js` | ✅ passing | 8 tests; in-process relay fixture |
| `test/LocalTransport.test.js` | ✅ passing | 6 tests; in-process WS server fixture |
| `test/NknTransport.test.js` | ✅ passing | 4 unit + 1 integration (skipped unless RUN_NKN_TESTS=1) |
| `test/MqttTransport.test.js` | ✅ passing | 3 unit + 1 integration (skipped unless RUN_MQTT_TESTS=1) |

---

## index.js exports — complete

All protocol, permission, transport, A2A, and storage exports are present in `src/index.js`.

---

## Status: ALL ITEMS COMPLETE ✅

Total: **449 tests passing, 2 skipped (live-network integration)** across 36 test files.
