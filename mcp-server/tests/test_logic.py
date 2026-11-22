"""Unit tests with a fake ServiceForge (httpx MockTransport). No real server, no port 8080."""
import json
from datetime import datetime

import httpx
import pytest

from serviceforge_mcp import logic
from serviceforge_mcp.client import ServiceForgeClient, ServiceForgeError, slugify_sku

TODAY = datetime.now().strftime("%Y-%m-%d")
TECHS = [{"id": 1, "name": "Jordan Reyes", "region": "North"},
         {"id": 2, "name": "Priya Nair", "region": "South"},
         {"id": 3, "name": "Sam Okafor", "region": "East"}]
PARTS = [{"id": 1, "name": "Capacitor 40\u00b5F", "available": 12},
         {"id": 2, "name": "Air filter", "available": 25},
         {"id": 5, "name": "Refrigerant valve", "available": 0}]


def job(i, tech, s, e, status="SCHEDULED"):
    return {"id": i, "technicianId": tech, "customerName": "X", "status": status,
            "startTime": f"{TODAY}T{s}:00", "endTime": f"{TODAY}T{e}:00"}


JOBS = {1: [job(1, 1, "09:00", "11:00"), job(2, 1, "14:00", "15:30")], 2: [job(3, 2, "10:00", "12:00")], 3: []}


def make(handler_overrides=None):
    reserved = []

    def handler(req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if handler_overrides and p in handler_overrides:
            return handler_overrides[p](req)
        if p == "/api/technicians":
            return httpx.Response(200, json=TECHS)
        if p.startswith("/api/technicians/") and p.endswith("/jobs"):
            tid = int(p.split("/")[3])
            return httpx.Response(200, json=JOBS[tid]) if tid in JOBS else httpx.Response(404, json={"message": "No technician"})
        if p == "/api/parts":
            return httpx.Response(200, json=PARTS)
        if p.endswith("/reservations") and req.method == "POST":
            jid = int(p.split("/")[3])
            if jid == 99:
                return httpx.Response(404, json={"message": "Job 99 not found"})
            line = json.loads(req.content)["lines"][0]
            if line["quantity"] > 12 and line["partId"] == 1:
                return httpx.Response(409, json={"message": "Insufficient stock for part 1: requested 20, available 12"})
            reserved.append((jid, line))
            return httpx.Response(201, json={"jobId": jid, "reserved": [line]})
        if p.endswith("/reservations"):
            return httpx.Response(200, json=[{"partId": 2, "quantity": 1}] if p == "/api/jobs/2/reservations" else [])
        return httpx.Response(404, json={"message": "nope"})

    c = ServiceForgeClient("http://sf.test", transport=httpx.MockTransport(handler))
    c.reserved = reserved
    return c


def test_sku_slug():
    assert slugify_sku("Capacitor 40\u00b5F") == "CAPACITOR-40UF"
    assert slugify_sku("Air filter") == "AIR-FILTER"


@pytest.mark.parametrize("s,e,free", [
    ("12:00", "13:00", True),    # 13:00 + 45m = 13:45 < 14:00 start -> free
    ("12:00", "13:15", True),    # 13:15 + 45m = 14:00; job start 14:00 is not < 14:00 -> free
    ("12:00", "13:16", False),   # inside buffer before job 2
    ("15:30", "16:30", False),   # starts exactly at job end, inside the 45 min after
    ("16:15", "17:00", True),    # exactly end+45 -> free
    ("14:30", "15:00", False),   # overlap
])
def test_buffer(s, e, free):
    r = logic.technician_availability(make(), 1, f"{TODAY}T{s}:00", f"{TODAY}T{e}:00")
    assert r["available"] is free


def test_availability_free_technician_and_validation():
    assert logic.technician_availability(make(), 3, f"{TODAY}T14:00:00", f"{TODAY}T15:00:00")["available"]
    for args in [(0, "x", "y"), (1, f"{TODAY}T15:00:00", f"{TODAY}T14:00:00"), (1, "bad", f"{TODAY}T14:00:00"),
                 (1, f"{TODAY}T14:00:00Z", f"{TODAY}T15:00:00Z")]:
        with pytest.raises(ServiceForgeError):
            logic.technician_availability(make(), *args)


def test_unknown_technician_is_actionable():
    with pytest.raises(ServiceForgeError, match="known ids are 1, 2, 3"):
        logic.technician_availability(make(), 42, f"{TODAY}T14:00:00", f"{TODAY}T15:00:00")


def test_part_stock_and_unknown_sku():
    assert logic.part_stock(make(), "air-filter")["available"] == 25
    with pytest.raises(ServiceForgeError, match=r"unknown sku 'CMP-CLUTCH'; known skus are CAPACITOR-40UF, AIR-FILTER"):
        logic.part_stock(make(), "CMP-CLUTCH")


def test_reserve_success_insufficient_unknown_job_and_validation():
    c = make()
    assert logic.reserve_part(c, 2, "AIR-FILTER", 1)["status"] == "reserved"
    assert c.reserved[0][1] == {"partId": 2, "quantity": 1}
    with pytest.raises(ServiceForgeError, match="insufficient stock for CAPACITOR-40UF: requested 20, on hand 12"):
        logic.reserve_part(make(), 2, "CAPACITOR-40UF", 20)
    with pytest.raises(ServiceForgeError, match="unknown jobId 99"):
        logic.reserve_part(make(), 99, "AIR-FILTER", 1)
    for bad in [(2, "AIR-FILTER", 0), (0, "AIR-FILTER", 1), (2, " ", 1)]:
        c2 = make()
        with pytest.raises(ServiceForgeError):
            logic.reserve_part(c2, *bad)
        assert c2.reserved == []


def test_backend_down_is_actionable():
    def boom(req):
        raise httpx.ConnectError("refused")
    c = ServiceForgeClient("http://localhost:8080", transport=httpx.MockTransport(boom))
    with pytest.raises(ServiceForgeError, match=r"did not respond; is `mvn spring-boot:run` up"):
        logic.part_stock(c, "AIR-FILTER")


def test_server_error_hides_details():
    c = make({"/api/parts": lambda r: httpx.Response(500, text="java.lang.NullPointerException at ...")})
    with pytest.raises(ServiceForgeError) as ei:
        logic.part_stock(c, "AIR-FILTER")
    assert "NullPointer" not in str(ei.value)


def test_brief_is_small_and_has_reservations_without_customer_names():
    b = logic.dispatch_brief(make(), now=datetime.now().replace(hour=9, minute=0))
    raw = json.dumps(b, separators=(",", ":"))
    assert len(raw.encode()) < 2048
    assert "customer" not in raw.lower()
    ids = [j["id"] for j in b["openJobsThisAfternoon"]]
    assert ids == [2]          # job 1 ends 11:00 and job 3 ends 12:00 are not afternoon
    assert b["openJobsThisAfternoon"][0]["reserved"] == [{"sku": "AIR-FILTER", "qty": 1}]


def test_write_timeout_says_outcome_unknown_and_read_timeout_does_not():
    def slow(req):
        raise httpx.ReadTimeout("slow")
    c = ServiceForgeClient("http://sf.test", transport=httpx.MockTransport(slow))
    with pytest.raises(ServiceForgeError, match="did not respond in time"):
        c.parts()
    calls = {"n": 0}

    def handler(req):
        if req.url.path == "/api/parts":
            return httpx.Response(200, json=PARTS)
        calls["n"] += 1
        raise httpx.ReadTimeout("slow")
    c = ServiceForgeClient("http://sf.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ServiceForgeError, match="outcome is unknown.*Do NOT retry"):
        logic.reserve_part(c, 2, "AIR-FILTER", 1)
    assert calls["n"] == 1


def test_cancelled_job_409_and_400_are_actionable():
    c = make({"/api/jobs/2/reservations": lambda r: httpx.Response(409, json={"message": "Job 2 is CANCELLED and cannot take reservations"})})
    with pytest.raises(ServiceForgeError, match="cannot reserve for job 2: Job 2 is CANCELLED"):
        logic.reserve_part(c, 2, "AIR-FILTER", 1)
    c = make({"/api/jobs/2/reservations": lambda r: httpx.Response(400, json={"message": "lines: must not be empty"})})
    with pytest.raises(ServiceForgeError, match="invalid reservation request: lines"):
        logic.reserve_part(c, 2, "AIR-FILTER", 1)


def test_sku_collision_gets_unique_suffix():
    dup = [{"id": 1, "name": "Air filter", "available": 1}, {"id": 2, "name": "Air-filter", "available": 2},
           {"id": 3, "name": "\u00b5\u00b5", "available": 3}]
    c = make({"/api/parts": lambda r: httpx.Response(200, json=dup)})
    skus = [p["sku"] for p in c.parts()]
    assert len(set(skus)) == 3 and skus[0] == "AIR-FILTER-1" and skus[1] == "AIR-FILTER-2"
