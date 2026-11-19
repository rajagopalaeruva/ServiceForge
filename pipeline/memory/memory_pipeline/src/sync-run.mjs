// The detached worker started by hook-launch.mjs. Runs `sync` for the extracted store and logs one line.
// Safe to run on every turn: it is idempotent, skips when another run holds the lock, and never throws to the caller.
//   MEMORY_SYNC_STORES   comma list, default "json" (chroma/qdrant need their containers up)
//   MEMORY_SYNC_DELAY_MS test only: pretend the writer is slow
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, EXTRACT_SOURCES_FILE, SYNC_LOG_FILE, SYNC_LOCK_FILE, SYNC_LOCK_MAX_AGE_MS, EXTRACTED_STORE_FILE, EXTRACTED_COLLECTION } from "./config.mjs";
import { extractAll } from "./extract.mjs";
import { sync } from "./sync.mjs";
import { openStore } from "./open-store.mjs";

const MAX_LOG_BYTES = 100_000;

function log(line) {
  try {
    fs.mkdirSync(path.dirname(SYNC_LOG_FILE), { recursive: true });
    if (fs.existsSync(SYNC_LOG_FILE) && fs.statSync(SYNC_LOG_FILE).size > MAX_LOG_BYTES) fs.writeFileSync(SYNC_LOG_FILE, "");
    fs.appendFileSync(SYNC_LOG_FILE, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  } catch { /* logging must not fail the run */ }
}

function takeLock() {
  fs.mkdirSync(path.dirname(SYNC_LOCK_FILE), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(SYNC_LOCK_FILE, String(process.pid), { flag: "wx" }); return true; }
    catch {
      let age = 0;
      try { age = Date.now() - fs.statSync(SYNC_LOCK_FILE).mtimeMs; } catch { continue; }
      if (age < SYNC_LOCK_MAX_AGE_MS) return false;
      try { fs.rmSync(SYNC_LOCK_FILE); log(`removed stale lock (${Math.round(age / 1000)} s old)`); } catch { return false; }
    }
  }
  return false;
}

const started = Date.now();
if (!takeLock()) {
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
      const r = await sync(store, candidates, { repoRoot: REPO_ROOT });
      const nothing = r.added.length === 0 && r.changed.length === 0;
      log(`${kind}: ${nothing ? "no change" : `added ${r.added.length}, changed ${r.changed.length}`}; unchanged ${r.unchanged}; removed-from-source ${r.removed.length}; discarded ${r.discarded.length}; ${Date.now() - started} ms`);
    } catch (e) {
      log(`${kind}: ERROR ${e.message}`);
    }
  }
} catch (e) {
  log(`ERROR ${e.message}`);
} finally {
  try { fs.rmSync(SYNC_LOCK_FILE); } catch { /* already gone */ }
}
process.exit(0);
