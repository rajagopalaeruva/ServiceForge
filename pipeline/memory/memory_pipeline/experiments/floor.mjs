// Measures the raw relevance of the best hit for nonsense queries and for the real queries, per store, to calibrate
// the minimum-similarity floor (finding F-7). Read-only. Needs the replay collections loaded (node src/cli.mjs ingest --reset).
// Usage: node experiments/floor.mjs [--stores json,chroma,qdrant] [--extracted]
// --extracted reads the extracted store instead (memory_store.extracted.json, collection memory_extracted; run sync first)
// and maps the key records of queries.mjs to their extracted ids.
// raw = the store's own score: cosine similarity for Chroma and Qdrant, share of query terms found for JSON.
import { openStore } from "../src/open-store.mjs";
import { REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES, EXTRACTED_STORE_FILE, EXTRACTED_COLLECTION } from "../src/config.mjs";
import { QUERIES } from "./queries.mjs";

const arg = process.argv.includes("--stores") ? process.argv[process.argv.indexOf("--stores") + 1] : "json,chroma,qdrant";
const extracted = process.argv.includes("--extracted");
// Seed id -> extracted id, for the key records named in queries.mjs.
const EXTRACTED_ID = {
  "mem-f1-buffered-interval": "mem-x-f1-buffered-interval-detection",
  "mem-f1-buffer-45": "mem-x-f1-standard-travel-buffer-per-job-is-45-minutes",
  "mem-rule-booking-conflicts": "mem-x-rule-booking-conflicts",
  "mem-bug-001": "mem-x-bug-001",
  "mem-bug-004": "mem-x-bug-004",
};
const keyId = id => (extracted ? EXTRACTED_ID[id] ?? id : id);
const NONSENSE = [
  "zebra giraffe quantum unrelated nonsense words",
  "recipe for banana bread",
  "football world cup final score",
  "how to knit a wool sweater",
  "weather forecast for tomorrow in Paris",
  "the capital city of Australia",
  "best pizza toppings and dough",
  "quarterly tax return deadline",
];
const filters = { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, includeHistory: false };
const f3 = n => (n === undefined ? "  n/a" : n.toFixed(3));

for (const kind of arg.split(",")) {
  const store = await openStore(kind, extracted ? { file: EXTRACTED_STORE_FILE, collection: EXTRACTED_COLLECTION } : {});
  console.log(`\n=== ${kind}${extracted ? " (extracted)" : ""}`);
  console.log("nonsense queries: top raw score, and the record that scored it");
  let maxNonsense = 0;
  for (const text of NONSENSE) {
    const [top] = await store.query(filters, text, 30);
    const raw = top?.raw ?? 0;
    maxNonsense = Math.max(maxNonsense, raw);
    console.log(`  ${f3(raw)}  ${top?.record.id ?? "(no hit)"}  | ${text}`);
  }
  console.log(`  highest nonsense score: ${f3(maxNonsense)}`);
  console.log("real queries: top raw score, and the raw score of each key record");
  let minKey = Infinity, minKeyWhere = "";
  for (const q of QUERIES) {
    const hits = await store.query(filters, q.text, 30);
    const byId = new Map(hits.map(h => [h.record.id, h.raw]));
    const keys = q.relevant.map(keyId).map(id => ({ id, raw: byId.get(id) }));
    for (const k of keys) if ((k.raw ?? 0) < minKey) { minKey = k.raw ?? 0; minKeyWhere = `${q.n}: ${k.id}`; }
    console.log(`  ${q.n}: top ${f3(hits[0]?.raw)}; key records ` + keys.map(k => `${k.id.replace("mem-", "")}=${f3(k.raw)}`).join(", "));
  }
  console.log(`  lowest key-record score: ${f3(minKey)} (${minKeyWhere})`);
  console.log(`  gap (lowest key minus highest nonsense): ${f3(minKey - maxNonsense)}`);
}
