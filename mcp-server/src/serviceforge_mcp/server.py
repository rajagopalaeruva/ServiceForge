"""ServiceForge dispatcher MCP server (stdio only).

Primitives: 3 tools (model-controlled), 2 resources (application-controlled),
1 prompt (user-controlled).
"""
from __future__ import annotations

import json
import logging
import sys
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import Field
from typing_extensions import TypedDict

from . import logic
from .client import ServiceForgeClient, ServiceForgeError

# stdout is the MCP channel; log to stderr only, and never log bodies.
logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

class Conflict(TypedDict):
    jobId: int
    start: str
    end: str
    status: str


class AvailabilityResult(TypedDict):
    technicianId: int
    available: bool
    travelBufferMinutes: int
    conflicts: list[Conflict]


class StockResult(TypedDict):
    sku: str
    name: str
    available: int  # units still free to reserve: already net of existing reservations


class ReservationResult(TypedDict):
    jobId: int
    sku: str
    reservedQuantity: int
    status: str


mcp = FastMCP("serviceforge-dispatch")
_client: ServiceForgeClient | None = None


def client() -> ServiceForgeClient:
    global _client
    if _client is None:
        _client = ServiceForgeClient()
    return _client


def _guard(fn, *args):
    try:
        return fn(client(), *args)
    except ServiceForgeError as e:
        raise ToolError(str(e)) from None


@mcp.tool()
def get_technician_availability(
    technicianId: Annotated[int, Field(ge=1, description="ServiceForge technician id (see the dispatch brief)")],
    windowStart: Annotated[str, Field(description="Job start, local ISO-8601, e.g. 2026-11-22T14:00:00")],
    windowEnd: Annotated[str, Field(description="Job end, local ISO-8601, must be after windowStart")],
) -> AvailabilityResult:
    """Use when the dispatcher asks whether one specific technician can take a job in a time window.
    Applies ServiceForge's 45-minute travel buffer: the technician is free only if no existing job
    overlaps the window or sits within 45 minutes before or after it. Read-only. To compare several
    technicians, call once per technician id listed in the dispatch brief. Returns conflicting jobs."""
    return _guard(logic.technician_availability, technicianId, windowStart, windowEnd)


@mcp.tool()
def get_part_stock(
    sku: Annotated[str, Field(min_length=1, description="Part sku, e.g. AIR-FILTER. Not a free-text name.")],
) -> StockResult:
    """Use when the dispatcher asks whether a part can be committed to a job, or how many are left after
    existing reservations. Input is a sku, not a free-text part name. If you only have a name, resolve it
    first from the resource serviceforge://catalog/parts. Read-only. Call this before reserve_part_for_job."""
    return _guard(logic.part_stock, sku)


@mcp.tool()
def reserve_part_for_job(
    jobId: Annotated[int, Field(ge=1, description="ServiceForge job id")],
    sku: Annotated[str, Field(min_length=1, description="Part sku from the parts catalog")],
    quantity: Annotated[int, Field(ge=1, description="Units to hold, at least 1")],
) -> ReservationResult:
    """Use ONLY after the dispatcher has explicitly confirmed they want to hold stock for this job.
    WRITES to ServiceForge: it reduces on-hand stock for the part (in memory, lost on backend restart).
    Run get_part_stock first. Fails if stock is insufficient, the job is unknown, or the job is not SCHEDULED (cancelled or completed).
    If it fails with an unknown outcome, check get_part_stock before retrying; never retry blindly."""
    return _guard(logic.reserve_part, jobId, sku, quantity)


@mcp.resource("serviceforge://catalog/parts", mime_type="application/json")
def parts_catalog() -> str:
    """Parts catalogue (sku, name, available; available is already net of existing reservations). Attach at session start to resolve a part name to a sku."""
    try:
        return json.dumps(logic.parts_catalog(client()), separators=(",", ":"))
    except ServiceForgeError as e:
        return json.dumps({"error": str(e)})


@mcp.resource("serviceforge://session/dispatch-brief", mime_type="application/json")
def dispatch_brief() -> str:
    """Short brief: technicians, today's open afternoon jobs, assignees and parts already reserved (< 2 KB)."""
    try:
        return json.dumps(logic.dispatch_brief(client()), separators=(",", ":"))
    except ServiceForgeError as e:
        return json.dumps({"error": str(e)})


@mcp.prompt(name="prep-job-dispatch", description="Check technician and part readiness for a job, then offer to reserve.")
def prep_job_dispatch(jobId: str) -> str:
    if not jobId.strip().isdigit() or int(jobId) < 1:
        raise ValueError("jobId must be a positive integer")
    return f"""Prepare dispatch for ServiceForge job {jobId.strip()}. Work in this order and report briefly.

1. Read serviceforge://session/dispatch-brief. If it is not already in context, say so and read it now.
   Find job {jobId.strip()} in it for its time window. If it is missing, say so and stop.
2. Call get_technician_availability for each technician listed in the brief, using that job's window.
   ServiceForge has no technician skills data, so do not claim a skill match; list who is free and who is not.
3. Decide whether the job likely needs a part. Heuristic: HVAC or cooling work suggests an air filter,
   capacitor or refrigerant valve; electrical work suggests a contactor relay or capacitor; thermostat
   complaints suggest a thermostat. Use serviceforge://catalog/parts to map a part name to a sku.
   If unsure, ask the dispatcher instead of guessing.
4. Call get_part_stock for each candidate sku before offering to reserve anything.
5. Summarise: free technicians, part stock, and a proposed reservation (sku, quantity).
   Do NOT call reserve_part_for_job until the dispatcher explicitly confirms."""


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
