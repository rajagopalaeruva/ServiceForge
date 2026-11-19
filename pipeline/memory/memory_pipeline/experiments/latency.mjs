// Rough timing per store on the replay data. Read-only against memory_replay (it times queries, and times ingest into a throwaway collection/file).
// Usage: node experiments/latency.mjs [--runs 10]
// Numbers depend on this machine, on warm-up, and on the embedding model already being cached. Compare stores, not absolutes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../src/open-store.mjs";
import { retrieve } from "../src/core.mjs";
import { ingest } from "../src/retain.mjs";
import { REPO_ROOT, SEED_FILE, REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES } from "../src/config.mjs";
import { TASK_QUERY } from "../test/contract.mjs";

const runs = process.argv.includes("--runs") ? Number(process.argv[process.argv.indexOf("--runs") + 1]) : 10;
const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")).records;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = () => Number(process.hrtime.bigint() / 1_000_000n);

console.log(`runs per store: ${runs}; ${seed.length} records\n`);
console.log("store    ingest(14, ms)  1st query(ms)  median query(ms)  max query(ms)");
for (const kind of ["json", "chroma", "qdrant"]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "memlat-"));
  const name = `memlat_${Date.now()}`;
  const scratch = await openStore(kind, { file: path.join(tmp, "s.json"), collection: name });
  await scratch.reset();
  const t0 = ms();
  await ingest(scratch, seed, { repoRoot: REPO_ROOT });
  const ingestMs = ms() - t0;

  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = ms();
    await retrieve(scratch, { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: TASK_QUERY });
    times.push(ms() - t);
  }
  console.log(`${kind.padEnd(8)} ${String(ingestMs).padStart(14)}  ${String(times[0]).padStart(13)}  ${String(median(times)).padStart(16)}  ${String(Math.max(...times)).padStart(13)}`);
  if (scratch.drop) await scratch.drop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
