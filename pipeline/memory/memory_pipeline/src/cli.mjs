// Usage (from memory_pipeline/):
//   node src/cli.mjs ingest [--seed <file>] [--reset]     load hand-written records through the Retain/Discard filter
//   node src/cli.mjs extract [--sources <file>] [--out <file>]   propose candidates from repo documents (read-only; prints a summary)
//   node src/cli.mjs sync [--sources <file>]               extract, then write only what is new or changed (idempotent)
//   node src/cli.mjs stale [--sources <file>]              report new / changed / removed records without writing
//   node src/cli.mjs query --text "<task text>" [--as-of YYYY-MM-DD] [--namespace ns] [--features 1,all]
//                          [--include-history] [--budget 500] [--json]
// Store: --store json (default), chroma or qdrant. sync and stale default to the extracted store
// (memory_store.extracted.json, or the memory_extracted collection), never the hand-written replay seed.
// Add --extracted to query or any command to use the extracted store.
import fs from "node:fs";
import { DEFAULT_STORE_FILE, SEED_FILE, REPO_ROOT, REPLAY_AS_OF, REPLAY_NAMESPACE, BUDGET_TOKENS, EXTRACT_SOURCES_FILE, EXTRACTED_STORE_FILE, EXTRACTED_COLLECTION } from "./config.mjs";
import { openStore } from "./open-store.mjs";
import { ingest } from "./retain.mjs";
import { retrieve } from "./core.mjs";
import { extractAll } from "./extract.mjs";
import { sync } from "./sync.mjs";

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
const extractedMode = cmd === "sync" || cmd === "stale" || Boolean(opts.extracted);
const store = await openStore(opts.store ?? "json", {
  file: opts.file ?? (extractedMode ? EXTRACTED_STORE_FILE : undefined),
  collection: opts.collection ?? (extractedMode ? EXTRACTED_COLLECTION : undefined),
});

const loadExtract = () => {
  const config = JSON.parse(fs.readFileSync(opts.sources ?? EXTRACT_SOURCES_FILE, "utf8"));
  return extractAll(config, { repoRoot: REPO_ROOT });
};

if (cmd === "extract") {
  const { candidates, skipped } = loadExtract();
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ records: candidates }, null, 2) + "\n", "utf8");
  console.log(`candidates ${candidates.length}, skipped ${skipped.length}${opts.out ? `, written to ${opts.out}` : ""}`);
  for (const c of candidates) console.log(`  ${c.id}  ${c.status}  ${c.timestamp}${c.note ? " (date assumed)" : ""}`);
  for (const s of skipped) console.log(`  skipped ${s.source}: ${s.reason}`);
} else if (cmd === "sync" || cmd === "stale") {
  const { candidates } = loadExtract();
  const r = await sync(store, candidates, { repoRoot: REPO_ROOT, dryRun: cmd === "stale" });
  const nothing = r.added.length === 0 && r.changed.length === 0;
  console.log(`${cmd}: ${nothing ? "no change" : `added ${r.added.length}, changed ${r.changed.length}`}; unchanged ${r.unchanged}; removed from source ${r.removed.length}`);
  for (const id of r.added) console.log(`  + ${id}`);
  for (const id of r.changed) console.log(`  ~ ${id}`);
  for (const id of r.removed) console.log(`  - ${id} (source section gone; record kept)`);
  for (const d of r.discarded) console.log(`  discarded ${d.id}: ${d.reasons.join("; ")}`);
  if (r.discarded.length) process.exitCode = 2;
} else if (cmd === "ingest") {
  if (opts.reset) await store.reset();
  const records = JSON.parse(fs.readFileSync(opts.seed ?? SEED_FILE, "utf8")).records;
  const res = await ingest(store, records, { repoRoot: REPO_ROOT });
  console.log(`written ${res.written.length}, discarded ${res.discarded.length}`);
  for (const d of res.discarded) console.log(`  discarded ${d.id}: ${d.reasons.join("; ")}`);
} else if (cmd === "query") {
  if (!opts.text || opts.text === true) throw new Error("--text is required");
  const r = await retrieve(store, {
    namespace: opts.namespace ?? REPLAY_NAMESPACE,
    asOf: opts["as-of"] ?? REPLAY_AS_OF,
    features: String(opts.features ?? "1,all").split(",").map(f => (f === "all" ? "all" : Number(f))),
    includeHistory: Boolean(opts["include-history"]),
    budget: Number(opts.budget ?? BUDGET_TOKENS),
    text: opts.text,
  });
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(r.block);
    console.log(`\n${r.tokens}/${r.budget} estimated tokens (characters / 4). skipped: ${r.skipped.map(s => s.id).join(", ") || "none"}; rejected by filter: ${r.rejected.length}`);
  }
} else {
  console.log("commands: ingest | query  (see the header of src/cli.mjs)");
  process.exitCode = 1;
}
