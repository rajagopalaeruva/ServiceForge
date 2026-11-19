// Qdrant adapter. Same interface as the JSON and Chroma stores: write / query / all / reset.
// Needs a running server (podman run -d --name qdrant -p 6333:6333 -p 6334:6334 -v qdrant_storage:/qdrant/storage docker.io/qdrant/qdrant).
// Qdrant does not embed text, so this adapter makes the vectors itself: only `summary` is embedded (not `keywords`),
// with the same default MiniLM function Chroma uses, so the two vector stores are compared on equal terms.
import crypto from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { validateRecord } from "../record.mjs";

/** Qdrant point ids must be integers or UUIDs. This turns a record id into a stable UUID, so re-writing the same record overwrites it. */
export function uuidFor(recordId) {
  const h = crypto.createHash("sha1").update(`serviceforge-memory:${recordId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;   // version 5 layout
  h[8] = (h[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export class QdrantStore {
  constructor({ collection = "memory_replay", host = "localhost", port = 6333 } = {}) {
    this.name = collection;
    this.client = new QdrantClient({ host, port });
    this.embedder = new DefaultEmbeddingFunction();
    this._ready = false;
  }

  async heartbeat() { return (await this.client.versionInfo()).version; }

  async _ensure() {
    if (this._ready) return;
    const have = (await this.client.getCollections()).collections.map(c => c.name);
    if (!have.includes(this.name)) {
      const [probe] = await this.embedder.generate(["size probe"]);
      await this.client.createCollection(this.name, { vectors: { size: probe.length, distance: "Cosine" } });
    }
    this._ready = true;
  }

  _filter(f) {
    const must = [
      { key: "namespace", match: { value: f.namespace } },
      { key: "ts", range: { lte: Number(f.asOf.replaceAll("-", "")) } },
      { key: "feature", match: { any: f.features.map(String) } },
    ];
    const filter = { must };
    if (!f.includeHistory) filter.must_not = [{ key: "status", match: { value: "superseded" } }];
    return filter;
  }

  async write(record) {
    const problems = validateRecord(record);
    if (problems.length) throw new Error(`invalid record ${record?.id}: ${problems.join("; ")}`);
    await this._ensure();
    const [vector] = await this.embedder.generate([record.summary]);
    await this.client.upsert(this.name, {
      wait: true,
      points: [{
        id: uuidFor(record.id),
        vector,
        payload: {
          key: record.id, namespace: record.namespace, feature: String(record.feature),
          status: record.status, type_tag: record.type_tag, ts: record.ts, record_json: JSON.stringify(record),
        },
      }],
    });
  }

  async all() {
    await this._ensure();
    const out = [];
    let offset;
    do {
      const page = await this.client.scroll(this.name, { limit: 256, with_payload: true, with_vector: false, offset });
      for (const p of page.points) out.push(JSON.parse(p.payload.record_json));
      offset = page.next_page_offset ?? undefined;
    } while (offset !== undefined);
    return out;
  }

  async reset() {
    await this.drop();
    await this._ensure();
  }

  async drop() {
    try { await this.client.deleteCollection(this.name); } catch { /* already gone */ }
    this._ready = false;
  }

  /** raw = cosine similarity (Qdrant's score), higher is better. */
  async query(filters, text, limit = 10) {
    if (!String(text).trim()) return [];
    await this._ensure();
    const [vector] = await this.embedder.generate([text]);
    const res = await this.client.query(this.name, { query: vector, limit, with_payload: true, filter: this._filter(filters) });
    return res.points.map(p => ({ record: JSON.parse(p.payload.record_json), raw: p.score }));
  }
}
