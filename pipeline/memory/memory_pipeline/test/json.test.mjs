import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
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

// JSON-store specifics: keyword scoring uses `keywords` as well as `summary` (the vector stores embed `summary` only).
describe("json: keyword scoring", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-json-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filters = { namespace: "ns:main:dev", asOf: "2026-11-12", features: [1, "all"], includeHistory: false };
  const rec = (id, summary, keywords) => ({
    id, namespace: "ns:main:dev", feature: 1, type_tag: "fact", status: "current", source_task: "t", source_path: "AGENTS.md",
    timestamp: "2026-11-11", ts: 20261111, importance: 2, summary, keywords,
  });

  it("a term found only in keywords still matches, and the score is the share of query terms found", async () => {
    const store = new JsonStore(path.join(dir, "k.json"));
    await store.write(rec("only-keyword", "Plain statement about the calendar.", ["zebra"]));
    await store.write(rec("only-summary", "A zebra crossing near the depot.", []));
    await store.write(rec("neither", "Plain statement about parts.", []));
    const hits = await store.query(filters, "zebra depot", 10);
    const score = id => hits.find(h => h.record.id === id)?.raw;
    assert.equal(score("only-keyword"), 0.5);
    assert.equal(score("only-summary"), 1);
    assert.equal(score("neither"), 0);
    assert.equal(store.minRelevance, 0);
  });

  it("the same id in two namespaces is two records; writing one again replaces only that one (F-4)", async () => {
    const store = new JsonStore(path.join(dir, "n.json"));
    await store.write(rec("same", "First namespace text.", []));
    await store.write({ ...rec("same", "Second namespace text.", []), namespace: "other:main:dev" });
    assert.equal((await store.all()).length, 2);
    await store.write(rec("same", "First namespace text, updated.", []));
    const all = await store.all();
    assert.equal(all.length, 2);
    assert.equal(all.find(r => r.namespace === "ns:main:dev").summary, "First namespace text, updated.");
    assert.equal(all.find(r => r.namespace === "other:main:dev").summary, "Second namespace text.");
  });

  it("writes leave no temporary file behind", async () => {
    const store = new JsonStore(path.join(dir, "t.json"));
    await store.write(rec("one", "Some text here.", []));
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith(".tmp")), []);
  });
});