---
mode: agent
description: "Prepare dispatch for a ServiceForge job using the serviceforge-dispatch MCP server (technician availability, part stock, then offer to reserve)"
---
Prepare dispatch for ServiceForge job ${input:jobId:job id, e.g. 2}. This uses the `serviceforge-dispatch` MCP server (see `mcp-server/README.md`). The backend must be running on `http://localhost:8080`.

1. Read the resource `serviceforge://session/dispatch-brief` if your host can read MCP resources. Find the job's time window and the technician ids in it.
   If you cannot read resources, say so. Do not search the repo for the data. Ask me for the job's start and end time. The seeded technician ids are 1, 2 and 3.
2. Call `get_technician_availability` once per technician for the job window. ServiceForge has no technician skills data, so do not claim a skill match. List who is free and who is not, and the conflicting job ids.
3. Decide whether the job likely needs a part. HVAC or cooling work suggests an air filter, capacitor or refrigerant valve. Electrical work suggests a contactor relay or capacitor. Thermostat complaints suggest a thermostat. Resolve names to skus from `serviceforge://catalog/parts` if you can read it. The derived skus are `CAPACITOR-40UF`, `AIR-FILTER`, `CONTACTOR-RELAY`, `THERMOSTAT` and `REFRIGERANT-VALVE`. If unsure which part, ask me.
4. Call `get_part_stock` for each candidate sku before offering to reserve. `available` is already net of existing reservations.
5. Summarise: free technicians, part availability, and a proposed reservation (sku, quantity).
   Do NOT call `reserve_part_for_job` until I explicitly confirm. It writes to ServiceForge.
