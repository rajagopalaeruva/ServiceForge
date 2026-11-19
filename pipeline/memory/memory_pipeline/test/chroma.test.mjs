import { describe, it } from "node:test";
import { runContract } from "./contract.mjs";
import { ChromaStore } from "../src/stores/chroma-store.mjs";

// Needs the Chroma container on localhost:8000. Without it, one visible skipped test is reported instead of a failure.
let up = true;
try { await new ChromaStore({ collection: "probe" }).heartbeat(); } catch { up = false; }

if (!up) {
  describe("chroma: contract M-1 to M-8", () => {
    it("SKIPPED: Chroma server not reachable on localhost:8000", { skip: true }, () => {});
  });
} else {
  // A uniquely named collection per run, so tests never touch memory_replay and never see old data.
  runContract("chroma", async () => {
    const store = new ChromaStore({ collection: `memtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}` });
    return { store, cleanup: () => store.drop() };
  });
}
