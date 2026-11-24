# Testing the ServiceForge MCP server over HTTP with curl

The server speaks MCP **Streamable HTTP**: JSON-RPC 2.0 `POST`s to one endpoint, `http://localhost:8000/mcp`.
The session is stateful, so run the steps in order: **initialize → initialized → call**.

## Prerequisites

- The ServiceForge backend is running on `http://localhost:8080` (`mvn spring-boot:run` in `backend/`).
- The MCP server is running with the HTTP transport, in its own terminal:

  ```powershell
  cd mcp-server
  $env:SERVICEFORGE_BASE_URL = "http://localhost:8080"
  uv run serviceforge-dispatch-mcp --transport streamable-http
  ```

  Stdio is the default (`uv run serviceforge-dispatch-mcp`). Stdio opens no port, so curl cannot reach it.

> **Transport name.** With the official `mcp` Python SDK (`mcp.server.fastmcp`), the value is
> `streamable-http`, not `http`. `http` belongs to the standalone `fastmcp` package.
> Host and port are set with `MCP_HOST` and `MCP_PORT` (default `127.0.0.1:8000`).

## Rules that apply to every request

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/json` | JSON-RPC body |
| `Accept` | `application/json, text/event-stream` | Both are required, otherwise you get `406 Not Acceptable` |
| `mcp-session-id` | value returned by `initialize` | Required on every call after `initialize` |

- The `initialize` response carries the session id **in the response headers**, so use `-i`.
- Replies usually arrive as Server-Sent Events: `event: message` followed by `data: {...json...}`.
- `notifications/initialized` is a notification, so it has **no `id`** and returns `202 Accepted` with an empty body.
- `protocolVersion`: use `2025-03-26` or newer. Streamable HTTP was introduced in `2025-03-26`.
  `2024-11-05` is the older HTTP+SSE protocol, and servers may negotiate it down.

## Tools exposed by this server

| Tool | Arguments | Notes |
|---|---|---|
| `get_technician_availability` | `technicianId` (int ≥ 1), `windowStart`, `windowEnd` (ISO-8601, e.g. `2026-11-22T14:00:00`) | Read-only, applies the 45-minute travel buffer |
| `get_part_stock` | `sku` (string, e.g. `AIR-FILTER`) | Read-only |
| `reserve_part_for_job` | `jobId` (int ≥ 1), `sku`, `quantity` (int ≥ 1) | **Writes**: reduces stock until the backend restarts |

Resources: `serviceforge://catalog/parts` and `serviceforge://session/dispatch-brief`.
Prompt: `prep-job-dispatch`.

---

## Linux / macOS / Git Bash / WSL

### 1. Initialize (capture the session id)

```bash
SID=$(curl -s -D - -o /dev/null -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-tester","version":"1.0.0"}}}' \
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\r')
echo "$SID"
```

To see the full response instead, run the same command with `-i` and without the `SID=$(...)` wrapper.

### 2. Initialized notification

```bash
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

### 3. List tools

```bash
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### 4. Call a tool

```bash
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_part_stock","arguments":{"sku":"AIR-FILTER"}}}'
```

Availability example:

```bash
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_technician_availability","arguments":{"technicianId":1,"windowStart":"2026-11-22T14:00:00","windowEnd":"2026-11-22T16:00:00"}}}'
```

### 5. Read a resource

```bash
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"serviceforge://catalog/parts"}}'
```

(Use the same headers as in step 4.)

---

## Windows PowerShell

In PowerShell, `curl` is an alias for `Invoke-WebRequest`. **Always type `curl.exe`.**

Don't escape quotes inside `'...'` (the `\"` style). It works only on Windows PowerShell 5.1.
On PowerShell 7.3+ native-argument passing changes, and the `\"` style then sends broken JSON.
Pipe the JSON through stdin with a here-string and `-d '@-'`. That works on 5.1 and 7.x.

### 1. Initialize (capture the session id)

```powershell
$init = @'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ps-tester","version":"1.0.0"}}}
'@
$resp = $init | curl.exe -s -i -X POST http://localhost:8000/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '@-'
$resp                                   # full headers + body
$SID = ($resp | Select-String -Pattern '(?i)^mcp-session-id:\s*(\S+)').Matches[0].Groups[1].Value
$SID
```

### 2. Initialized notification

```powershell
'{"jsonrpc":"2.0","method":"notifications/initialized"}' | curl.exe -s -i -X POST http://localhost:8000/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "mcp-session-id: $SID" `
  -d '@-'
```

### 3. List tools

```powershell
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | curl.exe -s -X POST http://localhost:8000/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "mcp-session-id: $SID" `
  -d '@-'
```

### 4. Call a tool

```powershell
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_part_stock","arguments":{"sku":"AIR-FILTER"}}}' | curl.exe -s -X POST http://localhost:8000/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "mcp-session-id: $SID" `
  -d '@-'
```

Single quotes keep `$` and `"` literal, so `$SID` is used only in the header (double-quoted).

---

## Windows cmd.exe (last resort)

`cmd` uses `^` for line continuation and needs `\"` inside double quotes:

```cmd
curl -i -X POST http://localhost:8000/mcp ^
  -H "Content-Type: application/json" ^
  -H "Accept: application/json, text/event-stream" ^
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"cmd-tester\",\"version\":\"1.0.0\"}}}"
```

## Terminal comparison

| Terminal | Line continuation | JSON quoting |
|---|---|---|
| Bash / Git Bash / WSL | `\` | Single quotes `'...'` work as-is |
| PowerShell | `` ` `` (backtick) | `curl.exe`, JSON piped from a single-quoted string or here-string with `-d '@-'` |
| cmd.exe | `^` | Double quotes with `\"` escaping |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl: (7) Failed to connect` | The server is not running with `--transport streamable-http`, or the port differs. A stdio-only launch opens no port. |
| `406 Not Acceptable` | `Accept` must list both `application/json` and `text/event-stream`. |
| `400` / "Missing session ID" | Skipped `initialize`, or forgot the `mcp-session-id` header. |
| `404` on a later call | The session is gone (server restarted). Run `initialize` again. |
| Tool result has `isError: true` | Backend (port 8080) is down, or the input was rejected (unknown job, insufficient stock). |
| Bad JSON on PowerShell 7 | Don't use the `\"` escaping style. Pipe the JSON with `-d '@-'`. |

**Skipping sessions for quick tests.** Construct the server with `FastMCP(..., stateless_http=True)`.
No session id is then needed, so steps 1 and 2 can be skipped. Don't use this setting for real clients.
`@mcp.custom_route("/health", methods=["GET"])` also works without JSON-RPC or a session if you add one.

## Easier alternative: MCP Inspector

```powershell
npx @modelcontextprotocol/inspector
```

Choose **Streamable HTTP** and enter `http://localhost:8000/mcp`. It handles the session, lists tools,
and lets you call them from a UI.
