import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// memory_pipeline/src -> memory_pipeline -> memory -> pipeline -> repo root
export const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
export const PIPELINE_DIR = path.resolve(here, "..");
export const DEFAULT_STORE_FILE = path.resolve(PIPELINE_DIR, "..", "memory_store.json");
export const SEED_FILE = path.resolve(PIPELINE_DIR, "data", "replay-seed.json");
export const EXTRACT_SOURCES_FILE = path.resolve(PIPELINE_DIR, "data", "extract-sources.json");
// Extracted records live apart from the hand-written replay seed, so the two never mix.
export const EXTRACTED_STORE_FILE = path.resolve(PIPELINE_DIR, "..", "memory_store.extracted.json");
export const EXTRACTED_COLLECTION = "memory_extracted";

// Approved in memory-architecture.md, sections 7.3 and 7.4.
export const BUDGET_TOKENS = 500;
export const RESERVE_TOKENS = 100;
export const WEIGHTS = { relevance: 0.60, recency: 0.25, importance: 0.15 };
// "max" = divide by the best score (approved design, section 7.3). "minmax" = stretch best..worst to 1..0 (under trial).
// MEMORY_SCALING lets the test suite and experiments try minmax without changing code.
export const SCALING = process.env.MEMORY_SCALING ?? "max";

// Replay premise: Feature 2 spec v1.0 was baselined on 2026-11-12.
export const REPLAY_AS_OF = "2026-11-12";
export const REPLAY_NAMESPACE = "serviceforge:main:dev";
export const REPLAY_FEATURES = [1, "all"];
