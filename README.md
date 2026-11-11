# ServiceForge

A Field Service Management platform boilerplate: work orders, technician scheduling, parts inventory, a customer portal, SLA tracking, and mobile dispatch — deliberately bigger and messier than a toy app, with features built one after another over time.

**This boilerplate ships with Feature 1 — Technician Availability Calendar — already built**, as the worked reference for the agentic-engineering program built on top of it. Everything else (the parts-reservation feature, memory, tools, guardrails, testing, review, packaging) is built by the program on top of this starting point.

## Quick start

### Backend (Java 17 + Spring Boot 3)
```bash
cd backend
mvn spring-boot:run
```
Runs on `http://localhost:8080`. Key endpoints:
- `GET /api/technicians` — list technicians
- `GET /api/technicians/{id}/jobs` — a technician's scheduled jobs
- `POST /api/jobs` — book a new job (`{ "technicianId": 1, "customerName": "...", "startTime": "2026-07-10T09:00:00", "endTime": "2026-07-10T11:00:00" }`)

### Frontend (Angular)
```bash
cd frontend
npm install
npm start
```
Runs on `http://localhost:4200` and calls the backend above.

## For anyone directing an AI coding agent in this repo

Start at **[`AGENTS.md`](AGENTS.md)**. It's the entry point for Claude Code, GitHub Copilot, Codex, or any equivalent tool, and it points to everything else: the orchestration pipeline, the agent role definitions, the skills, and the feature specs.

## What's deliberately here

- A real, working technician-booking flow (list technicians → view their jobs → book a new one).
- A documented bug-fix training exercise in that flow, now resolved with pre-fix and post-fix evidence in `pipeline/bugs/bug-001-booking-overlap.md`; the original requirement and decision history are preserved.
- Pre-baked agent, skill, and pipeline artifacts, ready to extend — nothing about the *next* feature exists yet. That starts with you.
