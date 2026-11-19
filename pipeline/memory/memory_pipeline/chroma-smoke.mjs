import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

// Step 3: connect
const client = new ChromaClient({ host: "localhost", port: 8000 });
console.log("heartbeat:", await client.heartbeat());

// Step 4: collection (one collection, namespace kept in metadata)
const collection = await client.getOrCreateCollection({
    name: "memory_smoke",
    embeddingFunction: new DefaultEmbeddingFunction(),
});

// Step 5: add records. ts is a number (YYYYMMDD) so range filters work.
await collection.upsert({
    ids: ["m1", "m2", "m3", "m4"],
    documents: [
        "A booked job occupies [start, end + 45 min). The next job may start exactly at the buffered end.",
        "Overlap is rejected only when two jobs have exactly the same start time.",
        "Standard travel buffer per job is 45 minutes (TRAVEL_BUFFER_MINUTES).",
        "Decoy: warehouse picking uses FIFO ordering."
    ],
    metadatas: [
        { namespace: "serviceforge:main:dev", feature: 1, status: "current",    ts: 20261111 },
        { namespace: "serviceforge:main:dev", feature: 1, status: "superseded", ts: 20261101 },
        { namespace: "serviceforge:main:dev", feature: 1, status: "current",    ts: 20261105 },
        { namespace: "decoy:main:dev",        feature: 1, status: "current",    ts: 20261105 },
    ],
});

// Step 6: query. A paraphrase, with filters.
const q = "how much time must separate two jobs for one technician";
const res = await collection.query({
    queryTexts: [q],
    nResults: 3,
    where: { $and: [
            { namespace: "serviceforge:main:dev" },
            { status: "current" },
            { ts: { $lte: 20261119 } },
        ]},
});
res.ids[0].forEach((id, i) =>
    console.log(id, res.distances[0][i].toFixed(3), res.documents[0][i]));
