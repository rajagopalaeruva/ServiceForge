// Compares relevance scaling ("max" = approved, "minmax" = under trial) on every available store. Read-only.
// Usage: node experiments/scaling.mjs [--stores json,chroma,qdrant]
//
// The relevance key below is the AUTHOR'S JUDGMENT, not ground truth. Q1 follows the spec's dependencies DEP-1..DEP-3;
// Q2 to Q4 are judged from the record texts. Change it if you disagree, then rerun.
import { openStore } from "../src/open-store.mjs";
import { retrieve } from "../src/core.mjs";
import { REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES } from "../src/config.mjs";
import { TASK_QUERY } from "../test/contract.mjs";

const arg = process.argv.includes("--stores") ? process.argv[process.argv.indexOf("--stores") + 1] : "json,chroma,qdrant";
const stores = arg.split(",");

const QUERIES = [
  { n: "Q1 F2 task",         text: TASK_QUERY,
    relevant: ["mem-f1-buffered-interval", "mem-f1-buffer-45", "mem-rule-booking-conflicts"] },
  { n: "Q2 time between jobs", text: "how much time must separate two jobs for one technician",
    relevant: ["mem-f1-buffer-45", "mem-f1-buffered-interval", "mem-rule-booking-conflicts"] },
  { n: "Q3 finished job",    text: "can a part be reserved for a job that is already finished",
    relevant: ["mem-bug-004"] },
  { n: "Q4 overlap check",   text: "overlap check",
    relevant: ["mem-bug-001", "mem-f1-buffered-interval", "mem-rule-booking-conflicts"] },
];

const short = id => id.replace("mem-", "");
const pad = (s, n) => String(s).padEnd(n);

for (const kind of stores) {
  const store = await openStore(kind);
  console.log(`\n=== ${kind}`);
  console.log(pad("query", 22) + pad("scaling", 8) + pad("P@k", 6) + pad("all relevant in block", 23) + pad("tok", 5) + "order (relevant marked *)");
  for (const q of QUERIES) {
    for (const scaling of ["max", "minmax"]) {
      const r = await retrieve(store, { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: q.text, scaling });
      const ids = r.items.map(i => i.id);
      const k = q.relevant.length;
      const topK = ids.slice(0, k).filter(id => q.relevant.includes(id)).length;
      const present = q.relevant.every(id => ids.includes(id));
      const order = ids.map(id => (q.relevant.includes(id) ? "*" : "") + short(id)).join(" > ");
      console.log(pad(q.n, 22) + pad(scaling, 8) + pad(`${topK}/${k}`, 6) + pad(present ? "yes" : "NO (" + q.relevant.filter(x => !ids.includes(x)).map(short).join(",") + ")", 23) + pad(r.tokens, 5) + order);
    }
  }
}
console.log("\nP@k = how many of the top k results are on the relevance key, k = size of the key.");
