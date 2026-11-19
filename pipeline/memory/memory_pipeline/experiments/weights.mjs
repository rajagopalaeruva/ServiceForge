// Compares ranking weights on the replay data. Read-only: it never writes to the store.
// Usage: node experiments/weights.mjs [--store json|chroma]
import { openStore } from "../src/open-store.mjs";
import { retrieve } from "../src/core.mjs";
import { REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES } from "../src/config.mjs";
import { TASK_QUERY } from "../test/contract.mjs";

const kind = process.argv.includes("--store") ? process.argv[process.argv.indexOf("--store") + 1] : "json";
const store = await openStore(kind);

const SETS = {
  "A approved 0.60/0.25/0.15": { relevance: 0.60, recency: 0.25, importance: 0.15 },
  "B trial    0.70/0.20/0.10": { relevance: 0.70, recency: 0.20, importance: 0.10 },
};
const QUERIES = {
  "Q1 Feature 2 task": TASK_QUERY,
  "Q2 paraphrase: time between jobs": "how much time must separate two jobs for one technician",
  "Q3 paraphrase: finished job": "can a part be reserved for a job that is already finished",
  "Q4 keywords: overlap check": "overlap check",
};
const MUST = ["mem-f1-buffered-interval", "mem-f1-buffer-45", "mem-rule-booking-conflicts"];

console.log(`store: ${kind}\n`);
for (const [qn, text] of Object.entries(QUERIES)) {
  console.log(qn);
  for (const [wn, weights] of Object.entries(SETS)) {
    const r = await retrieve(store, { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text, weights });
    const order = r.items.map(i => i.id.replace("mem-", "")).join(" > ");
    const weak = r.items.filter(i => i.relevance < 0.25).map(i => i.id.replace("mem-", ""));
    const musts = MUST.map(m => r.items.findIndex(i => i.id === m) + 1);   // 1-based rank, 0 = absent
    console.log(`  ${wn}: ${r.tokens} tok`);
    console.log(`    order: ${order}`);
    console.log(`    weak-relevance (<0.25) items kept: ${weak.length ? weak.join(", ") : "none"}`);
    if (qn.startsWith("Q1")) console.log(`    rank of the 3 needed facts: ${musts.join(", ")}  (0 = missing)`);
  }
  console.log();
}
