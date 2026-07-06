/**
 * @canopy/mcp-bridge — bidirectional bridge between the Model Context Protocol
 * (MCP) and canopy's gated `{opId, args}` dispatch (the #63 MCP-integration tail).
 *
 * Two directions, one contract (the manifest):
 *   • EXPORT  — `manifestToMcpTools(manifest)` projects an app's ops into an
 *     MCP `tools/list` (pure, no I/O).
 *   • INBOUND — `handleMcpToolCall(agent, toolCall, opts)` maps an MCP
 *     `tools/call` to `{opId, args}` and dispatches it THROUGH the capability
 *     gate (the same `callSkill`/`dispatchRemoteOp` path #63 uses). A denied
 *     or unknown call returns an MCP `{ isError:true }` — never a silent run.
 *
 * `createMcpServer` wires both over an INJECTED transport; the real
 * stdio/HTTP+SSE server + auth-token handshake are DEFERRED (see that file).
 */

export { manifestToMcpTools } from './manifestToMcpTools.js';
export { handleMcpToolCall }  from './handleMcpToolCall.js';
export { createMcpServer, createLoopbackPair } from './createMcpServer.js';
export { mcpResult, mcpError, partsFromArguments } from './mcpShapes.js';
