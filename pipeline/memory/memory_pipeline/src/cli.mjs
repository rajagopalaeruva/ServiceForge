// Usage (from memory_pipeline/):
//   node src/cli.mjs ingest [--seed <file>] [--reset]     load records through the Retain/Discard filter
//   node src/cli.mjs query --text "<task text>" [--as-of YYYY-MM-DD] [--namespace ns] [--features 1,all]
//                          [--include-history] [--budget 500] [--json]
// Store: --store json (default), chroma or qdrant.
import fs from "node:fs";
import { DEFAULT_STORE_FILE, SEED_FILE, REPO_ROOT, REPLAY_AS_OF, REPLAY_NAMESPACE, BUDGET_TOKENS } from "./config.mjs";
import { openStore } from "./open-store.mjs";
import { ingest } from "./retain.mjs";
import { retrieve } from "./core.mjs";

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
const store = await openStore(opts.store ?? "json", { file: opts.file, collection: opts.collection });

if (cmd === "ingest") {
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
