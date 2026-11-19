import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runContract } from "./contract.mjs";
import { JsonStore } from "../src/stores/json-store.mjs";

// A throwaway file per run, so tests never touch pipeline/memory/memory_store.json.
runContract("json", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-json-"));
  const store = new JsonStore(path.join(dir, "store.json"));
  return { store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
});
