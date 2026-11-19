// Usage (from memory_pipeline/):
//   node src/cli.mjs ingest [--seed <file>] [--reset]     load hand-written records through the Retain/Discard filter
//   node src/cli.mjs extract [--sources <file>] [--out <file>]   propose candidates from repo documents (read-only; prints a summary)
//   node src/cli.mjs sync [--sources <file>]               extract, then write only what is new or changed (idempotent)
//   node src/cli.mjs stale [--sources <file>]              report new / changed / removed records without writing; exit 3 if any, 0 if in sync
//   node src/cli.mjs query --text "<task text>" [--as-of YYYY-MM-DD] [--namespace ns] [--features 1,all]
//                          [--include-history] [--budget 500] [--json]
// Store: --store json (default), chroma or qdrant. sync and stale default to the extracted store
// (memory_store.extracted.json, or the memory_extracted collection), never the hand-written replay seed.
// Add --extracted to query or any command to use the extracted store.
// Exit codes: 0 ok, 1 bad usage or input, 2 records discarded by the filter, 3 stale found drift, 4 sync busy (another writer holds the lock).
import fs from "node:fs";
import { DEFAULT_STORE_FILE, SEED_FILE, REPO_ROOT, REPLAY_AS_OF, REPLAY_NAMESPACE, BUDGET_TOKENS, EXTRACT_SOURCES_FILE, EXTRACTED_STORE_FILE, EXTRACTED_COLLECTION, SYNC_LOCK_FILE, SYNC_LOCK_MAX_AGE_MS } from "./config.mjs";
import { openStore } from "./open-store.mjs";
import { ingest } from "./retain.mjs";
import { retrieve } from "./core.mjs";
import { extractAll } from "./extract.mjs";
import { sync, hasDrift } from "./sync.mjs";
import { takeLock, releaseLock } from "./lock.mjs";
import { tsOf } from "./record.mjs";

function parse(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return { cmd, opts };
}

const { cmd, opts } = parse(process.argv.slice(2));
const fail = (msg, code = 1) => { console.error(`error: ${msg}`); process.exit(code); };

const extractedMode = cmd === "sync" || cmd === "stale" || Boolean(opts.extracted);
const store = await openStore(opts.store ?? "json", {
  file: opts.file ?? (extractedMode ? EXTRACTED_STORE_FILE : undefined),
  collection: opts.collection ?? (extractedMode ? EXTRACTED_COLLECTION : undefined),
});

const loadConfig = () => JSON.parse(fs.readFileSync(opts.sources ?? EXTRACT_SOURCES_FILE, "utf8"));

if (cmd === "extract") {
  const { candidates, skipped } = extractAll(loadConfig(), { repoRoot: REPO_ROOT });
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ records: candidates }, null, 2) + "\n", "utf8");
  console.log(`candidates ${candidates.length}, skipped ${skipped.length}${opts.out ? `, written to ${opts.out}` : ""}`);
  for (const c of candidates) console.log(`  ${c.id}  ${c.status}  ${c.timestamp}${c.note ? " (date assumed)" : ""}`);
  for (const s of skipped) console.log(`  skipped ${s.source}: ${s.reason}`);
} else if (cmd === "sync" || cmd === "stale") {
  const config = loadConfig();
  const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
  // sync writes, so it takes the same lock as the Stop hook worker. stale only reads.
  const token = cmd === "sync" ? takeLock(SYNC_LOCK_FILE, { maxAgeMs: SYNC_LOCK_MAX_AGE_MS }) : null;
  if (cmd === "sync" && !token) fail(`another sync is running (lock file ${SYNC_LOCK_FILE}); try again in a moment`, 4);
  let r;
  try { r = await sync(store, candidates, { repoRoot: REPO_ROOT, dryRun: cmd === "stale", namespace: config.namespace }); }
  finally { releaseLock(SYNC_LOCK_FILE, token); }
  const verb = cmd === "stale" ? "would be marked" : "marked";
  console.log(`${cmd}: ${hasDrift(r) ? `added ${r.added.length}, changed ${r.changed.length}, removed from source ${r.removed.length}` : "no change"}; unchanged ${r.unchanged}`);
  for (const id of r.added) console.log(`  + ${id}`);
  for (const id of r.changed) console.log(`  ~ ${id}`);
  for (const id of r.removed) console.log(`  - ${id} (source section gone; ${verb} superseded, record kept)`);
  for (const d of r.discarded) console.log(`  discarded ${d.id}: ${d.reasons.join("; ")}`);
  if (r.discarded.length) process.exitCode = 2;
  if (cmd === "stale" && hasDrift(r)) process.exitCode = 3;
} else if (cmd === "ingest") {
  if (opts.reset) await store.reset();
  const records = JSON.parse(fs.readFileSync(opts.seed ?? SEED_FILE, "utf8")).records;
  const res = await ingest(store, records, { repoRoot: REPO_ROOT });
  console.log(`written ${res.written.length}, discarded ${res.discarded.length}`);
  for (const d of res.discarded) console.log(`  discarded ${d.id}: ${d.reasons.join("; ")}`);
} else if (cmd === "query") {
  if (!opts.text || opts.text === true) fail("--text is required");
  const budget = opts.budget === undefined ? BUDGET_TOKENS : (/^\d+$/.test(String(opts.budget)) ? Number(opts.budget) : NaN);
  if (!Number.isInteger(budget) || budget < 1) fail(`--budget must be a positive whole number, got "${opts.budget}"`);
  const asOf = opts["as-of"] ?? REPLAY_AS_OF;
  try { tsOf(asOf); } catch (e) { fail(`--as-of: ${e.message}`); }
  const r = await retrieve(store, {
    namespace: opts.namespace ?? REPLAY_NAMESPACE,
    asOf,
    features: String(opts.features ?? "1,all").split(",").map(f => (f === "all" ? "all" : Number(f))),
    includeHistory: Boolean(opts["include-history"]),
    budget,
    text: opts.text,
  });
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(r.block || "(nothing relevant found; nothing injected)");
    console.log(`\n${r.tokens}/${r.budget} estimated tokens (characters / 4). skipped: ${r.skipped.map(s => s.id).join(", ") || "none"}; rejected by filter: ${r.rejected.length}`);
  }
} else {
  console.log("commands: ingest | extract | sync | stale | query  (see the header of src/cli.mjs)");
  process.exitCode = 1;
}
