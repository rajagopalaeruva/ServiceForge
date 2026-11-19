import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runContract } from "./contract.mjs";
import { QdrantStore, uuidFor } from "../src/stores/qdrant-store.mjs";

// Needs the Qdrant container on localhost:6333. Without it, one visible skipped test is reported instead of a failure.
let up = true;
try { await new QdrantStore({ collection: "probe" }).heartbeat(); } catch { up = false; }

if (!up) {
  describe("qdrant: contract M-1 to M-8", () => {
    it("SKIPPED: Qdrant server not reachable on localhost:6333", { skip: true }, () => {});
  });
} else {
  describe("qdrant: id mapping", () => {
    it("record ids map to stable, distinct, well-formed UUIDs", () => {
      assert.equal(uuidFor("mem-a"), uuidFor("mem-a"));
      assert.notEqual(uuidFor("mem-a"), uuidFor("mem-b"));
      assert.match(uuidFor("mem-a"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  // A uniquely named collection per run, so tests never touch memory_replay and never see old data.
  runContract("qdrant", async () => {
    const store = new QdrantStore({ collection: `memtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}` });
    return { store, cleanup: () => store.drop() };
  });
}
