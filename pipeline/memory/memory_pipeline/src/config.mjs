import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// memory_pipeline/src -> memory_pipeline -> memory -> pipeline -> repo root
export const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
export const PIPELINE_DIR = path.resolve(here, "..");
export const DEFAULT_STORE_FILE = path.resolve(PIPELINE_DIR, "..", "memory_store.json");
export const SEED_FILE = path.resolve(PIPELINE_DIR, "data", "replay-seed.json");

// Approved in memory-architecture.md, sections 7.3 and 7.4.
export const BUDGET_TOKENS = 500;
export const RESERVE_TOKENS = 100;
export const WEIGHTS = { relevance: 0.60, recency: 0.25, importance: 0.15 };

// Replay premise: Feature 2 spec v1.0 was baselined on 2026-11-12.
export const REPLAY_AS_OF = "2026-11-12";
export const REPLAY_NAMESPACE = "serviceforge:main:dev";
export const REPLAY_FEATURES = [1, "all"];
