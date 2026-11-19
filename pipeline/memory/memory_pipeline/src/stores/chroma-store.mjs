// ChromaDB adapter. Same interface as the JSON store: write / query / all / reset.
// Needs a running server (podman run -d --name chroma -p 8000:8000 -v chroma_data:/data docker.io/chromadb/chroma).
// Embedding: only `summary` is embedded (not `keywords`), with Chroma's default MiniLM function, run in this Node process.
import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { validateRecord } from "../record.mjs";

export class ChromaStore {
  constructor({ collection = "memory_replay", host = "localhost", port = 8000 } = {}) {
    this.name = collection;
    this.client = new ChromaClient({ host, port });
    this.embedder = new DefaultEmbeddingFunction();
    this._col = null;
  }

  async _collection() {
    if (!this._col) {
      this._col = await this.client.getOrCreateCollection({
        name: this.name,
        embeddingFunction: this.embedder,
        configuration: { hnsw: { space: "cosine" } },   // explicit, so score = 1 - distance is cosine similarity
      });
    }
    return this._col;
  }

  async heartbeat() { return this.client.heartbeat(); }

  /** Chroma metadata values must be scalars, so feature is kept as a string and the full record rides along as JSON. */
  _meta(r) {
    return {
      namespace: r.namespace, feature: String(r.feature), status: r.status, type_tag: r.type_tag,
      ts: r.ts, record_json: JSON.stringify(r),
    };
  }

  _where(f) {
    const and = [
      { namespace: f.namespace },
      { ts: { $lte: Number(f.asOf.replaceAll("-", "")) } },
      { feature: { $in: f.features.map(String) } },
    ];
    if (!f.includeHistory) and.push({ status: { $ne: "superseded" } });
    return { $and: and };
  }

  async write(record) {
    const problems = validateRecord(record);
    if (problems.length) throw new Error(`invalid record ${record?.id}: ${problems.join("; ")}`);
    const col = await this._collection();
    await col.upsert({ ids: [record.id], documents: [record.summary], metadatas: [this._meta(record)] });
  }

  async all() {
    const col = await this._collection();
    const res = await col.get({ include: ["metadatas"] });
    return res.metadatas.map(m => JSON.parse(m.record_json));
  }

  async reset() {
    try { await this.client.deleteCollection({ name: this.name }); } catch { /* did not exist */ }
    this._col = null;
    await this._collection();
  }

  async drop() {
    try { await this.client.deleteCollection({ name: this.name }); } catch { /* already gone */ }
    this._col = null;
  }

  /** raw = cosine similarity (1 - distance), higher is better. */
  async query(filters, text, limit = 10) {
    if (!String(text).trim()) return [];
    const col = await this._collection();
    const res = await col.query({
      queryTexts: [text], nResults: limit, where: this._where(filters), include: ["metadatas", "distances"],
    });
    return (res.ids[0] ?? []).map((_, i) => ({
      record: JSON.parse(res.metadatas[0][i].record_json),
      raw: 1 - res.distances[0][i],
    }));
  }
}
