# ServiceForge Dispatcher MCP Server

A local **stdio** MCP server (Python, official `mcp` SDK 1.x) that lets a dispatcher agent answer
"can we send a technician, and is the part in stock?" without dumping the store into context.
It is an external client of ServiceForge (`SERVICEFORGE_BASE_URL`, default `http://localhost:8080`).
The Spring Boot app is not modified.

## Surface

| Primitive | Name | Notes |
|---|---|---|
| Tool (read) | `get_technician_availability(technicianId, windowStart, windowEnd)` | Applies the 45-minute travel buffer to the technician's jobs. |
| Tool (read) | `get_part_stock(sku)` | Stock remaining after reservations. |
| Tool (**write**) | `reserve_part_for_job(jobId, sku, quantity)` | Only write. Calls `POST /api/jobs/{jobId}/reservations`. Use only after the dispatcher confirms. |
| Resource | `serviceforge://catalog/parts` | sku, name, available (already net of reservations). |
| Resource | `serviceforge://session/dispatch-brief` | Technicians, today's open afternoon jobs, reserved parts. Capped at 2 KB; contains no customer names. |
| Prompt | `prep-job-dispatch(jobId)` | User-invoked workflow. The part heuristic lives here, not in a tool. |

Errors are actionable, for example `unknown sku 'CMP-CLUTCH'; known skus are ...`,
`insufficient stock for AIR-FILTER: requested 30, on hand 25`,
`ServiceForge at http://localhost:8080 did not respond; is mvn spring-boot:run up?`.
Inputs are validated (ids >= 1, quantity >= 1, ISO local date-times, end after start) before any HTTP call.
No secrets, no API key, no bodies logged, logs go to stderr.

## Deviations from the task text (the real backend differs)

| Task assumed | This repo | What the server does |
|---|---|---|
| Parts have a `sku`; `POST /api/parts/{sku}/reservations` | Parts have numeric `id`, `name`, `available`. Reserving is `POST /api/jobs/{jobId}/reservations` with `{lines:[{partId, quantity}]}`. | **Derives a sku from the name** (`Air filter` -> `AIR-FILTER`, `Capacitor 40µF` -> `CAPACITOR-40UF`) and maps it to `partId` at the boundary. |
| Compressor clutch part | No clutch is seeded. | Not invented. For HVAC the prompt suggests **Air filter**, **Capacitor** or **Refrigerant valve**. `REFRIGERANT-VALVE` has 0 stock (the scarcest part). |
| Technicians have skills; Alex/Jordan/Sam | Seeded: Jordan Reyes, Priya Nair, Sam Okafor, with region only. | No skill matching. The tool takes one `technicianId`; the prompt checks every technician in the brief. |
| Jobs like `J-104`, `requiredSkill`, `windowStart/End` | Numeric ids; `startTime`/`endTime`; no skill. Seeded jobs: 1 (09:00-11:00, tech 1), 2 (14:00-15:30, tech 1), 3 (10:00-12:00, tech 2). Job 2 is the "afternoon" job. | Uses them as is. |
| Availability from ServiceForge | **No availability endpoint** and no `GET /api/jobs`. | **Duplicates the 45-minute rule** from `TechnicianAvailabilityService` using `GET /api/technicians/{id}/jobs`. Like the backend, it ignores job status. If the backend rule changes, update `TRAVEL_BUFFER` in `logic.py`. Stated risk of drift. |

## Known limits

- `available` is the backend's field of the same name: stock **after** reservations, so it is the number you can still reserve.
- The sku is derived from the part name, so renaming a part changes its sku. Two parts that slug to the same value get `-<partId>` appended.
- A timeout *after* the reservation POST is sent returns "outcome unknown, check get_part_stock before retrying". There is no idempotency key because the backend has none.
- The dispatch brief uses this machine's clock for "today" and "afternoon" (from 12:00); the backend uses its own `LocalDateTime.now()`. They agree when both run on one machine.
- Resource read errors are returned as `{"error": ...}` content, not raised.

## Run

```powershell
cd mcp-server
uv sync                     # or: py -m venv .venv; .venv\Scripts\pip install -e .
uv run serviceforge-dispatch-mcp
```

Host config (paste into your MCP client config; adjust the path):

```json
{
  "mcpServers": {
    "serviceforge-dispatch": {
      "command": "uv",
      "args": ["--directory", "C:/path/to/ServiceForge/mcp-server", "run", "serviceforge-dispatch-mcp"],
      "env": { "SERVICEFORGE_BASE_URL": "http://localhost:8080" }
    }
  }
}
```

The `mcp` dependency is pinned `>=1.10,<2` (1.10 added structured tool output): version 2 renamed `FastMCP` and changed the API.

## Test

```powershell
cd mcp-server
py -m venv .venv; .venv\Scripts\pip install "mcp>=1.2,<2" "httpx>=0.27" pytest
$env:PYTHONPATH="src"; .venv\Scripts\python -m pytest -q          # 17 unit tests, fake backend, no ports
.venv\Scripts\python tests\smoke_stdio.py                          # real stdio session vs fake backend on port 18080
```

## Out of scope

HTTP/SSE transport, low-stock alerts, reservation expiry, any backend change, technician skills.
