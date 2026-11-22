"""Pure dispatch logic. All input validation happens here, before any HTTP call to ServiceForge."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from .client import ServiceForgeClient, ServiceForgeError, _HttpFailure, _generic

# Mirrors TechnicianAvailabilityService.TRAVEL_BUFFER_MINUTES in the backend (Feature 1).
# The backend exposes no availability endpoint, so this is a documented duplication.
TRAVEL_BUFFER = timedelta(minutes=45)
BRIEF_MAX_BYTES = 2048
AFTERNOON_START_HOUR = 12


def _parse_dt(label: str, value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ServiceForgeError(f"{label} must be an ISO-8601 local date-time like 2026-11-22T14:00:00") from None
    if dt.tzinfo is not None:
        raise ServiceForgeError(f"{label} must not carry a timezone; ServiceForge uses local date-times")
    return dt


def _require_id(label: str, value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ServiceForgeError(f"{label} must be a positive integer")
    return value


def technician_availability(c: ServiceForgeClient, technician_id: int, window_start: str, window_end: str) -> dict:
    _require_id("technicianId", technician_id)
    start, end = _parse_dt("windowStart", window_start), _parse_dt("windowEnd", window_end)
    if end <= start:
        raise ServiceForgeError("windowEnd must be after windowStart")
    conflicts = []
    for j in c.technician_jobs(technician_id):
        js, je = datetime.fromisoformat(j["startTime"]), datetime.fromisoformat(j["endTime"])
        # Same rule as the backend: new.start < existing.end + 45m  and  existing.start < new.end + 45m
        if start < je + TRAVEL_BUFFER and js < end + TRAVEL_BUFFER:
            conflicts.append({"jobId": j["id"], "start": j["startTime"], "end": j["endTime"], "status": j["status"]})
    return {
        "technicianId": technician_id,
        "available": not conflicts,
        "travelBufferMinutes": 45,
        "conflicts": conflicts,
    }


def _resolve_sku(c: ServiceForgeClient, sku: str) -> dict:
    if not isinstance(sku, str) or not sku.strip():
        raise ServiceForgeError("sku must be a non-empty string; read serviceforge://catalog/parts to resolve a name")
    parts = c.parts()
    wanted = sku.strip().upper()
    for p in parts:
        if p["sku"] == wanted:
            return p
    raise ServiceForgeError(f"unknown sku '{sku}'; known skus are {', '.join(p['sku'] for p in parts)}")


def part_stock(c: ServiceForgeClient, sku: str) -> dict:
    p = _resolve_sku(c, sku)
    return {"sku": p["sku"], "name": p["name"], "quantityOnHand": p["quantityOnHand"]}


def reserve_part(c: ServiceForgeClient, job_id: int, sku: str, quantity: int) -> dict:
    _require_id("jobId", job_id)
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
        raise ServiceForgeError("quantity must be an integer >= 1")
    p = _resolve_sku(c, sku)
    try:
        res = c.reserve(job_id, p["partId"], quantity)
    except _HttpFailure as e:
        if e.status == 404 and e.message.lower().startswith("job"):
            raise ServiceForgeError(f"unknown jobId {job_id}; check the dispatch brief for open job ids") from None
        if e.status == 404:
            raise ServiceForgeError(f"unknown sku '{p['sku']}'; re-read serviceforge://catalog/parts") from None
        if e.status == 409 and "insufficient" in e.message.lower():
            have = next((x["quantityOnHand"] for x in c.parts() if x["sku"] == p["sku"]), "unknown")
            raise ServiceForgeError(
                f"insufficient stock for {p['sku']}: requested {quantity}, on hand {have}"
            ) from None
        if e.status == 409:
            raise ServiceForgeError(f"cannot reserve for job {job_id}: {e.message}") from None
        if e.status == 400:
            raise ServiceForgeError(f"invalid reservation request: {e.message}") from None
        raise _generic(e) from None
    line = next((r for r in res.get("reserved", []) if r.get("partId") == p["partId"]), {})
    return {"jobId": job_id, "sku": p["sku"], "reservedQuantity": line.get("quantity", quantity), "status": "reserved"}


def parts_catalog(c: ServiceForgeClient) -> dict:
    return {"parts": [{"sku": p["sku"], "name": p["name"], "quantityOnHand": p["quantityOnHand"]} for p in c.parts()]}


def dispatch_brief(c: ServiceForgeClient, now: datetime | None = None) -> dict:
    """Open afternoon jobs for today, assignee, and parts reserved. Compact by design (< 2 KB)."""
    now = now or datetime.now()
    noon = now.replace(hour=AFTERNOON_START_HOUR, minute=0, second=0, microsecond=0)
    day_end = noon.replace(hour=23, minute=59)
    sku_by_id = {p["partId"]: p["sku"] for p in c.parts()}
    techs = c.technicians()
    jobs = []
    for j in sorted(c.all_jobs(), key=lambda x: x["startTime"]):
        js, je = datetime.fromisoformat(j["startTime"]), datetime.fromisoformat(j["endTime"])
        if j["status"] != "SCHEDULED" or je <= noon or js > day_end or js.date() != now.date():
            continue
        res = [{"sku": sku_by_id.get(r["partId"], str(r["partId"])), "qty": r["quantity"]} for r in c.job_reservations(j["id"])]
        jobs.append({"id": j["id"], "tech": j["technicianId"], "start": js.strftime("%H:%M"),
                     "end": je.strftime("%H:%M"), "reserved": res})
    brief = {"date": now.date().isoformat(),
             "technicians": [{"id": t["id"], "name": t["name"], "region": t["region"]} for t in techs],
             "openJobsThisAfternoon": jobs, "truncated": False}
    while len(json.dumps(brief, separators=(",", ":")).encode()) > BRIEF_MAX_BYTES and brief["openJobsThisAfternoon"]:
        brief["openJobsThisAfternoon"].pop()
        brief["truncated"] = True
    return brief
