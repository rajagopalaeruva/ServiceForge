"""Thin HTTP client for ServiceForge. Turns HTTP failures into actionable messages.

The MCP server is an external client of ServiceForge; it never touches MockDataStore.
Nothing here logs request or response bodies (they contain customer names).
"""
from __future__ import annotations

import os
import re
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://localhost:8080"
TIMEOUT_SECONDS = 5.0


class ServiceForgeError(Exception):
    """Error whose message is safe and useful to show to the model."""


def slugify_sku(name: str) -> str:
    """Derive a stable sku from a part name. ServiceForge parts have only a numeric id."""
    s = name.replace("\u00b5", "u").upper()
    return re.sub(r"[^A-Z0-9]+", "-", s).strip("-")


class ServiceForgeClient:
    def __init__(self, base_url: str | None = None, transport: httpx.BaseTransport | None = None):
        self.base_url = (base_url or os.environ.get("SERVICEFORGE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._http = httpx.Client(base_url=self.base_url, timeout=TIMEOUT_SECONDS, transport=transport)

    def _request(self, method: str, path: str, write: bool = False, **kw: Any) -> Any:
        try:
            r = self._http.request(method, path, **kw)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Request never reached the backend, so a retry is safe.
            raise ServiceForgeError(
                f"ServiceForge at {self.base_url} did not respond; is `mvn spring-boot:run` up?"
            ) from None
        except httpx.HTTPError:
            if write:
                raise ServiceForgeError(
                    "connection to ServiceForge failed after the reservation was sent; the outcome is unknown. "
                    "Do NOT retry yet: call get_part_stock to check whether stock changed."
                ) from None
            raise ServiceForgeError(
                f"ServiceForge at {self.base_url} did not respond in time; is `mvn spring-boot:run` up?"
            ) from None
        if r.status_code >= 400:
            raise _HttpFailure(r.status_code, _message(r))
        try:
            return r.json()
        except ValueError:
            raise ServiceForgeError("ServiceForge returned a non-JSON response; retry or check the backend.") from None

    # -- reads -------------------------------------------------------------
    def technicians(self) -> list[dict]:
        return self._request("GET", "/api/technicians")

    def technician_jobs(self, technician_id: int) -> list[dict]:
        try:
            return self._request("GET", f"/api/technicians/{technician_id}/jobs")
        except _HttpFailure as e:
            if e.status == 404:
                known = ", ".join(str(t["id"]) for t in self.technicians())
                raise ServiceForgeError(f"unknown technicianId {technician_id}; known ids are {known}") from None
            raise _generic(e) from None

    def parts(self) -> list[dict]:
        """Catalogue with a derived sku. `available` is stock remaining after reservations."""
        try:
            raw = self._request("GET", "/api/parts")
        except _HttpFailure as e:
            raise _generic(e) from None
        skus = [slugify_sku(p["name"]) for p in raw]
        out = []
        for p, sku in zip(raw, skus):
            if not sku or skus.count(sku) > 1:  # collision or empty slug: make it unique and stable
                sku = f"{sku or 'PART'}-{p['id']}"
            out.append({"sku": sku, "partId": p["id"], "name": p["name"], "available": p["available"]})
        return out

    def all_jobs(self) -> list[dict]:
        """No GET /api/jobs exists, so collect per technician."""
        jobs: list[dict] = []
        for t in self.technicians():
            jobs.extend(self.technician_jobs(t["id"]))
        return jobs

    def job_reservations(self, job_id: int) -> list[dict]:
        try:
            return self._request("GET", f"/api/jobs/{job_id}/reservations")
        except _HttpFailure as e:
            if e.status == 404:
                raise ServiceForgeError(f"unknown jobId {job_id}") from None
            raise _generic(e) from None

    # -- the only write ----------------------------------------------------
    def reserve(self, job_id: int, part_id: int, quantity: int) -> dict:
        try:
            return self._request(
                "POST", f"/api/jobs/{job_id}/reservations", write=True,
                json={"lines": [{"partId": part_id, "quantity": quantity}]},
            )
        except _HttpFailure as e:
            raise e


class _HttpFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _message(r: httpx.Response) -> str:
    try:
        body = r.json()
        return str(body.get("message", "")) if isinstance(body, dict) else ""
    except ValueError:
        return ""


def _generic(e: _HttpFailure) -> ServiceForgeError:
    if e.status >= 500:
        return ServiceForgeError("ServiceForge reported an internal error; retry later or check the backend log.")
    return ServiceForgeError(f"ServiceForge rejected the request ({e.status}): {e.message or 'no detail'}")
