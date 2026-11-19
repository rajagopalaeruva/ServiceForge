// One place that knows how to build each store, so the CLI, tests and experiments agree.
import { DEFAULT_STORE_FILE } from "./config.mjs";
import { JsonStore } from "./stores/json-store.mjs";

export async function openStore(kind = "json", opts = {}) {
  if (kind === "json") return new JsonStore(opts.file ?? DEFAULT_STORE_FILE);
  if (kind === "chroma") {
    const { ChromaStore } = await import("./stores/chroma-store.mjs");
    return new ChromaStore({ collection: opts.collection ?? "memory_replay", host: opts.host, port: opts.port });
  }
  if (kind === "qdrant") {
    const { QdrantStore } = await import("./stores/qdrant-store.mjs");
    return new QdrantStore({ collection: opts.collection ?? "memory_replay", host: opts.host, port: opts.port });
  }
  throw new Error(`unknown store "${kind}" (json, chroma, qdrant)`);
}
