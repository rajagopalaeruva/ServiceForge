// Qdrant smoke test. Same 4 records, same embedding model and same query as chroma-smoke.mjs.
import { QdrantClient } from "@qdrant/js-client-rest";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

const client = new QdrantClient({ host: "localhost", port: 6333 });
const embedder = new DefaultEmbeddingFunction();
const NAME = "memory_smoke";

const records = [
  { key: "m1", text: "A booked job occupies [start, end + 45 min). The next job may start exactly at the buffered end.",
    meta: { namespace: "serviceforge:main:dev", feature: 1, status: "current",    ts: 20261111 } },
  { key: "m2", text: "Overlap is rejected only when two jobs have exactly the same start time.",
    meta: { namespace: "serviceforge:main:dev", feature: 1, status: "superseded", ts: 20261101 } },
  { key: "m3", text: "Standard travel buffer per job is 45 minutes (TRAVEL_BUFFER_MINUTES).",
    meta: { namespace: "serviceforge:main:dev", feature: 1, status: "current",    ts: 20261105 } },
  { key: "m4", text: "Decoy: warehouse picking uses FIFO ordering.",
    meta: { namespace: "decoy:main:dev",        feature: 1, status: "current",    ts: 20261105 } },
];

// Qdrant has no embedder: we make the vectors ourselves (same MiniLM model Chroma used).
const vectors = await embedder.generate(records.map(r => r.text));
const size = vectors[0].length;
console.log("version:", (await client.versionInfo()).version, "| vector size:", size);

// Collection (fixed vector size + distance). Recreate so the script is repeatable.
const existing = (await client.getCollections()).collections.map(c => c.name);
if (existing.includes(NAME)) await client.deleteCollection(NAME);
await client.createCollection(NAME, { vectors: { size, distance: "Cosine" } });

// Point ids must be integers or UUIDs, so the readable id goes in the payload.
await client.upsert(NAME, {
  wait: true,
  points: records.map((r, i) => ({
    id: i + 1,
    vector: vectors[i],
    payload: { key: r.key, text: r.text, ...r.meta },
  })),
});

async function ask(label, query, must) {
  const [qv] = await embedder.generate([query]);
  const res = (await client.query(NAME, { query: qv, limit: 3, with_payload: true, filter: { must } })).points;
  console.log(`\n${label}`);
  res.forEach(p => console.log(p.payload.key, p.score.toFixed(3), p.payload.status, "|", p.payload.text));
}

const q = "how much time must separate two jobs for one technician";
const ns = { key: "namespace", match: { value: "serviceforge:main:dev" } };
const asOf = { key: "ts", range: { lte: 20261119 } };

await ask("1) filtered: namespace + status=current + as_of (expect m3, m1; no m2, no m4)",
  q, [ns, { key: "status", match: { value: "current" } }, asOf]);
await ask("2) no status filter (does the superseded m2 rank near the top?)", q, [ns, asOf]);
await ask("3) keyword query, filtered", "overlap check",
  [ns, { key: "status", match: { value: "current" } }, asOf]);
