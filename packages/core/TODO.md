# Implementation Progress

## Group I — Storage (data sources)
**Status: IN PROGRESS**
Depends on: A, B. Fully independent of protocol and A2A.

- [x] `src/storage/DataSource.js` — abstract base class
- [x] `src/storage/MemorySource.js` — in-memory Map
- [x] `src/storage/IndexedDBSource.js` — browser IndexedDB
- [x] `src/storage/FileSystemSource.js` — Node.js fs
- [x] `src/storage/SolidPodSource.js` — Solid Pod stub
- [x] `src/storage/SolidVault.js` — Vault on Solid Pod stub
- [x] `src/storage/StorageManager.js` — policy-gated multi-source manager
- [x] `src/permissions/DataSourcePolicy.js` — access policy for storage
- [x] Tests: `test/storage.test.js`
- [x] Exports added to `src/index.js`

## Group H — A2A layer
**Status: IN PROGRESS**
Depends on: A, C, D, E, G.

- [x] `src/a2a/AgentCardBuilder.js` — builds A2A agent card JSON
- [x] `src/a2a/A2AAuth.js` — JWT auth (inbound validate + outbound headers)
- [x] `src/a2a/A2ATLSLayer.js` — security layer shim for A2A transport
- [x] `src/a2a/A2ATransport.js` — HTTP server (receive) + HTTP client (send)
- [x] `src/a2a/a2aDiscover.js` — fetch /.well-known/agent.json → PeerGraph
- [x] `src/a2a/a2aTaskSend.js` — POST /tasks/send → Task
- [x] `src/a2a/a2aTaskSubscribe.js` — POST /tasks/sendSubscribe SSE → Task stream
- [x] `PeerDiscovery.discoverByUrl` — wired up (was stub)
- [x] Tests: `test/AgentCardBuilder.test.js`
- [x] Tests: `test/A2ATransport.test.js`
- [x] Exports added to `src/index.js`

## Test suite baseline
325 tests passing before starting Groups H+I.
