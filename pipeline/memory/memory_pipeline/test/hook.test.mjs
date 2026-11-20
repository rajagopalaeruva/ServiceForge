// M-9: the Stop hook is non-blocking, safe to repeat, and cannot fail the session.
// Real processes, with state redirected to a temp folder so the real log, lock and store are never touched.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, PIPELINE_DIR, EXTRACT_SOURCES_FILE } from "../src/config.mjs";
import { extractAll } from "../src/extract.mjs";

const LAUNCHER = path.join(PIPELINE_DIR, "src", "hook-launch.mjs");
const HOOK_FILE = path.join(REPO_ROOT, ".kiro", "hooks", "memory-sync.json");
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The number of records the hook should write, from the same extractor and sources, so new source files do not break a literal.
const EXPECTED = extractAll(JSON.parse(fs.readFileSync(EXTRACT_SOURCES_FILE, "utf8")), { repoRoot: REPO_ROOT }).candidates.length;

// Temporary state folders are removed when the file's tests are done, once no writer still holds a lock in them (F-17).
const states = [];
after(async () => {
  const end = Date.now() + 20000;
  while (Date.now() < end && states.some(s => fs.existsSync(s.lock))) await sleep(200);
  await sleep(300);
  for (const s of states) fs.rmSync(s.dir, { recursive: true, force: true });
});

function newState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-hook-"));
  const state = {
    dir,
    log: () => (fs.existsSync(path.join(dir, "sync.log")) ? fs.readFileSync(path.join(dir, "sync.log"), "utf8") : ""),
    lock: path.join(dir, ".sync.lock"),
    store: path.join(dir, "memory_store.extracted.json"),
    records: () => (fs.existsSync(path.join(dir, "memory_store.extracted.json"))
      ? JSON.parse(fs.readFileSync(path.join(dir, "memory_store.extracted.json"), "utf8")).records.length : 0),
  };
  states.push(state);
  return state;
}

/** Runs the launcher exactly as the hook does (payload on STDIN) and times it. */
function launch(state, env = {}, input = '{"session_id":"s","hook_event_name":"Stop","cwd":"x"}') {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [LAUNCHER], {
    env: { ...process.env, MEMORY_STATE_DIR: state.dir, ...env }, input, timeout: 15000,
  });
  return { status: r.status, ms: Date.now() - t0, stdout: String(r.stdout), stderr: String(r.stderr) };
}

async function waitFor(cond, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(150); }
  return false;
}

const results = log => log.split("\n").filter(l => / json: /.test(l));

describe("M-9: Stop hook (background sync)", () => {
  it("returns at once even when the writer is slow, then the writer finishes on its own", async () => {
    const s = newState();
    const r = launch(s, { MEMORY_SYNC_DELAY_MS: "4000" });
    assert.equal(r.status, 0);
    assert.ok(r.ms < 2500, `launcher took ${r.ms} ms`);
    assert.equal(r.stdout.trim(), "", "the hook must print nothing");
    assert.equal(results(s.log()).length, 0, "the writer cannot have finished inside the delay");
    assert.ok(await waitFor(() => results(s.log()).length === 1), `no result logged:\n${s.log()}`);
    assert.match(results(s.log())[0], new RegExp(`json: added ${EXPECTED}, changed 0`));
    assert.equal(s.records(), EXPECTED);
    assert.ok(!fs.existsSync(s.lock), "lock was left behind");
  });

  it("a second run changes nothing", async () => {
    const s = newState();
    launch(s);
    assert.ok(await waitFor(() => results(s.log()).length === 1));
    launch(s);
    assert.ok(await waitFor(() => results(s.log()).length === 2));
    assert.match(results(s.log())[1], new RegExp(`json: no change; unchanged ${EXPECTED}`));
    assert.equal(s.records(), EXPECTED);
  });

  it("overlapping runs: one writes, the other skips", async () => {
    const s = newState();
    launch(s, { MEMORY_SYNC_DELAY_MS: "3000" });
    launch(s, { MEMORY_SYNC_DELAY_MS: "3000" });
    assert.ok(await waitFor(() => results(s.log()).length === 1 && !fs.existsSync(s.lock)));
    await sleep(300);
    assert.equal(results(s.log()).length, 1);
    assert.equal((s.log().match(/skipped: another sync is running/g) ?? []).length, 1);
    assert.equal(s.records(), EXPECTED);
  });

  it("a stale lock is removed and the sync still runs", async () => {
    const s = newState();
    fs.writeFileSync(s.lock, "99999");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(s.lock, old, old);
    launch(s);
    assert.ok(await waitFor(() => results(s.log()).length === 1));
    assert.match(s.log(), /removed stale lock/);
  });

  it("a fresh lock held by another run makes this one skip", async () => {
    const s = newState();
    fs.writeFileSync(s.lock, "99999");
    launch(s);
    assert.ok(await waitFor(() => /skipped: another sync is running/.test(s.log())));
    assert.equal(results(s.log()).length, 0);
    assert.equal(s.records(), 0);
    assert.equal(fs.readFileSync(s.lock, "utf8"), "99999", "the skipped run touched the other run's lock");
    fs.rmSync(s.lock);
  });

  it("a failing writer cannot fail the hook: it exits 0, logs the error and releases the lock", async () => {
    const s = newState();
    const r = launch(s, { MEMORY_SOURCES_FILE: path.join(s.dir, "does-not-exist.json") });
    assert.equal(r.status, 0);
    assert.ok(await waitFor(() => /ERROR/.test(s.log())), s.log());
    assert.ok(await waitFor(() => !fs.existsSync(s.lock)), "lock was left behind after an error");
  });

  it("garbage, empty or missing STDIN does not break the launcher", async () => {
    for (const input of ["", "not json {{{", "\u0000\u0001", undefined]) {
      const s = newState();
      const r = launch(s, { MEMORY_SYNC_DELAY_MS: "1500" }, input);
      assert.equal(r.status, 0, `status ${r.status} for ${JSON.stringify(input)}`);
      assert.ok(r.ms < 2500, `${r.ms} ms`);
      assert.ok(await waitFor(() => results(s.log()).length === 1), `writer did not finish:\n${s.log()}`);
    }
  });

  it("the hook file is valid, uses the Stop trigger, points at a real script and leaves the ADR guard alone", () => {
    const cfg = JSON.parse(fs.readFileSync(HOOK_FILE, "utf8"));
    assert.equal(cfg.version, "v1");
    const h = cfg.hooks[0];
    assert.equal(h.trigger, "Stop");
    assert.equal(h.action.type, "command");
    assert.match(h.action.command, /^node pipeline\/memory\/memory_pipeline\/src\/hook-launch\.mjs$/);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "pipeline/memory/memory_pipeline/src/hook-launch.mjs")));
    assert.ok(h.timeout <= 30, "a hook timeout this long would hold up the turn");
    const guard = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".kiro/hooks/guard-accepted-adr.json"), "utf8"));
    assert.equal(guard.hooks[0].trigger, "PreToolUse");
  });
});
