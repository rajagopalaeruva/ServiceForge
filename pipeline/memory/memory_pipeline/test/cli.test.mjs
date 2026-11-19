// The command line: option checks (F-10), exit codes of stale and sync (F-2, F-15). Real processes.
// Sync and stale use a temporary store file and a temporary state folder (lock), and only read the repo's documents.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PIPELINE_DIR } from "../src/config.mjs";

const CLI = path.join(PIPELINE_DIR, "src", "cli.mjs");
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-cli-")); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const query = (...extra) => cli(["query", "--text", "buffer between jobs", ...extra]);

describe("cli query: option validation (F-10)", () => {
  it("a good query exits 0", () => {
    const r = query("--budget", "300", "--as-of", "2026-11-12");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\/300 estimated tokens/);
  });

  it("--budget must be a positive whole number", () => {
    for (const bad of ["abc", "0", "-5", "5.5", "1e3", "", "12abc"]) {
      const r = query("--budget", bad);
      assert.equal(r.code, 1, `budget "${bad}" gave exit ${r.code}`);
      assert.match(r.err, /--budget must be a positive whole number/);
      assert.equal(r.out, "");
    }
    assert.equal(query("--budget").code, 1);    // flag without a value
  });

  it("--as-of must be a real date", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "garbage", "2026-1-1", "20261112"]) {
      const r = query("--as-of", bad);
      assert.equal(r.code, 1, `as-of "${bad}" gave exit ${r.code}`);
      assert.match(r.err, /--as-of: bad date/);
    }
  });

  it("--text is required", () => {
    const r = cli(["query"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /--text is required/);
  });
});

describe("cli stale and sync: exit codes and the lock", () => {
  it("stale exits 3 when the store differs from the sources, and 0 once it is in sync", () => {
    const dir = tmp();
    const file = path.join(dir, "extracted.json");
    const env = { MEMORY_STATE_DIR: dir };
    const drift = cli(["stale", "--file", file], env);
    assert.equal(drift.code, 3, drift.out + drift.err);
    assert.match(drift.out, /added \d+/);
    assert.ok(!fs.existsSync(file), "stale must not write");
    const sync = cli(["sync", "--file", file], env);
    assert.equal(sync.code, 0, sync.out + sync.err);
    const inSync = cli(["stale", "--file", file], env);
    assert.equal(inSync.code, 0, inSync.out + inSync.err);
    assert.match(inSync.out, /stale: no change/);
    const second = cli(["sync", "--file", file], env);
    assert.equal(second.code, 0);
    assert.match(second.out, /sync: no change/);
  });

  it("stale exits 3 when a record's source section is gone (removed), without writing", () => {
    const dir = tmp();
    const file = path.join(dir, "extracted.json");
    const env = { MEMORY_STATE_DIR: dir };
    assert.equal(cli(["sync", "--file", file], env).code, 0);
    // Add an extractor record that no source produces any more.
    const store = JSON.parse(fs.readFileSync(file, "utf8"));
    store.records.push({ ...store.records[0], id: "mem-x-gone", source_hash: "000000000000" });
    fs.writeFileSync(file, JSON.stringify(store));
    const r = cli(["stale", "--file", file], env);
    assert.equal(r.code, 3, r.out + r.err);
    assert.match(r.out, /removed from source 1/);
    assert.match(r.out, /- mem-x-gone/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).records.find(x => x.id === "mem-x-gone").status, store.records[0].status, "stale must not write");
    // sync then marks it, and stale is quiet afterwards.
    assert.equal(cli(["sync", "--file", file], env).code, 0);
    const marked = JSON.parse(fs.readFileSync(file, "utf8")).records.find(x => x.id === "mem-x-gone");
    assert.deepEqual([marked.status, marked.stale_reason], ["superseded", "source section no longer found"]);
    assert.equal(cli(["stale", "--file", file], env).code, 0);
  });

  it("sync exits 4 with a clear message when another writer holds the lock, and leaves that lock alone", () => {
    const dir = tmp();
    const file = path.join(dir, "extracted.json");
    fs.writeFileSync(path.join(dir, ".sync.lock"), "4242:abcdef");
    const r = cli(["sync", "--file", file], { MEMORY_STATE_DIR: dir });
    assert.equal(r.code, 4, r.out + r.err);
    assert.match(r.err, /another sync is running/);
    assert.ok(!fs.existsSync(file), "a refused sync wrote the store");
    assert.equal(fs.readFileSync(path.join(dir, ".sync.lock"), "utf8"), "4242:abcdef");
  });

  it("sync releases its lock when it finishes", () => {
    const dir = tmp();
    assert.equal(cli(["sync", "--file", path.join(dir, "e.json")], { MEMORY_STATE_DIR: dir }).code, 0);
    assert.ok(!fs.existsSync(path.join(dir, ".sync.lock")));
  });

  it("stale does not need the lock", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, ".sync.lock"), "4242:abcdef");
    const r = cli(["stale", "--file", path.join(dir, "e.json")], { MEMORY_STATE_DIR: dir });
    assert.equal(r.code, 3, r.out + r.err);
  });
});
