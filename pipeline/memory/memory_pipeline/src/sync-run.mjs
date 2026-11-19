// The detached worker started by hook-launch.mjs. Runs `sync` for the extracted store and logs one line.
// Safe to run on every turn: it is idempotent, skips when another run holds the lock, and never throws to the caller.
//   MEMORY_SYNC_STORES   comma list, default "json" (chroma/qdrant need their containers up)
//   MEMORY_SYNC_DELAY_MS test only: pretend the writer is slow
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, EXTRACT_SOURCES_FILE, SYNC_LOG_FILE, SYNC_LOCK_FILE, SYNC_LOCK_MAX_AGE_MS, EXTRACTED_STORE_FILE, EXTRACTED_COLLECTION } from "./config.mjs";
import { extractAll } from "./extract.mjs";
import { sync, hasDrift } from "./sync.mjs";
import { openStore } from "./open-store.mjs";
import { takeLock, releaseLock } from "./lock.mjs";

const MAX_LOG_BYTES = 100_000;

function log(line) {
  try {
    fs.mkdirSync(path.dirname(SYNC_LOG_FILE), { recursive: true });
    if (fs.existsSync(SYNC_LOG_FILE) && fs.statSync(SYNC_LOG_FILE).size > MAX_LOG_BYTES) fs.writeFileSync(SYNC_LOG_FILE, "");
    fs.appendFileSync(SYNC_LOG_FILE, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  } catch { /* logging must not fail the run */ }
}

const started = Date.now();
const lockToken = takeLock(SYNC_LOCK_FILE, { maxAgeMs: SYNC_LOCK_MAX_AGE_MS, onStale: age => log(`removed stale lock (${Math.round(age / 1000)} s old)`) });
if (!lockToken) {
  log("skipped: another sync is running");
  process.exit(0);
}

try {
  if (process.env.MEMORY_SYNC_DELAY_MS) await new Promise(r => setTimeout(r, Number(process.env.MEMORY_SYNC_DELAY_MS)));
  const config = JSON.parse(fs.readFileSync(EXTRACT_SOURCES_FILE, "utf8"));
  const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
  for (const kind of (process.env.MEMORY_SYNC_STORES ?? "json").split(",").map(s => s.trim()).filter(Boolean)) {
    try {
      const store = await openStore(kind, { file: EXTRACTED_STORE_FILE, collection: EXTRACTED_COLLECTION });
      const r = await sync(store, candidates, { repoRoot: REPO_ROOT, namespace: config.namespace });
      const nothing = !hasDrift(r);
      log(`${kind}: ${nothing ? "no change" : `added ${r.added.length}, changed ${r.changed.length}`}; unchanged ${r.unchanged}; removed-from-source ${r.removed.length} (marked superseded); discarded ${r.discarded.length}; ${Date.now() - started} ms`);
    } catch (e) {
      log(`${kind}: ERROR ${e.message}`);
    }
  }
} catch (e) {
  log(`ERROR ${e.message}`);
} finally {
  releaseLock(SYNC_LOCK_FILE, lockToken);   // only deletes the lock if it is still ours
}
process.exit(0);
