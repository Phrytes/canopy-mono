# MCP server — exposing anonymised outputs to Klai (or any MCP client)

`src/mcp/server.js` wraps the pipeline as an [MCP](https://modelcontextprotocol.io)
server. Klai's chat is **LibreChat**, which is an MCP *client* — so rather than
pushing data into Klai's Knowledge store, the curator queries our anonymised
tracks live. See `KLAI-evaluation.md` for the why.

## Guarantee
The server returns **only post-anonymisation data**. Raw/original text never
crosses the boundary — `stripRaw()` recursively drops any `raw` field, and the
`mcp-smoke` test asserts it. The `aggregate` tool runs the full local pipeline
and returns only the anonymised tracks.

## Tools
| Tool | Returns | Needs Ollama |
|---|---|---|
| `list_themes` | k-anon themes + user/message counts | no |
| `get_theme_summary` | the dedup summary for one theme | no |
| `get_signals` | crisis/medical/abuse/… signal track (cleaned text only) | no |
| `get_review_queue` | quarantined sensitive below-threshold items + flags | no |
| `get_transparency_report` | k-threshold, totals, rejected-by-reason, dropped themes | no |
| `aggregate` | run clean+triage+k-anon on new messages → anonymised tracks | **yes** |

Read tools load a saved aggregate-result JSON: `$FP_RESULTS` env, or a per-call
`resultsPath`. `aggregate` uses `$FP_MODEL` (default `qwen2.5:7b-instruct`).

## Test locally
```bash
# headless smoke (read tools, no Ollama) — asserts the no-raw guarantee
FP_RESULTS=/tmp/b-out4.json npm run mcp-smoke

# interactive — browse tools in the MCP inspector
FP_RESULTS=/tmp/b-out4.json npx @modelcontextprotocol/inspector npm run mcp
```

## Wire into Klai / LibreChat
Klai must whitelist a custom MCP server (contact them for the hosted trial; or
self-host). Add to `librechat.yaml`:
```yaml
mcpServers:
  feedback-pipeline:
    command: node
    args: ["/abs/path/apps/feedback-pipeline/src/mcp/server.js"]
    env:
      FP_RESULTS: "/abs/path/results/latest.json"
      FP_MODEL: "qwen2.5:7b-instruct"
```
Restart LibreChat; the tools appear in the chat tool dropdown.

## Remote Klai (later)
stdio assumes the server runs on the same box as Klai. For a remote/SaaS Klai,
swap `StdioServerTransport` → `StreamableHTTPServerTransport` (already in the
SDK) behind auth, and register the URL instead of a command. Same tools, same
guarantee. Self-hosting Klai next to this pipeline keeps anonymised data on one
box and is the recommended privacy posture.
