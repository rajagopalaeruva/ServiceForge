// The owner-checked lock (F-15): only the worker that wrote the token may delete the lock.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { takeLock, releaseLock } from "../src/lock.mjs";

const made = [];
const newLock = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-lock-"));
  made.push(dir);
  return { dir, file: path.join(dir, ".sync.lock") };
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const makeOld = (file, ms = 10 * 60 * 1000) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };

describe("lock: take and release", () => {
  it("the lock file holds the owner's token, and a second taker is refused while it is fresh", () => {
    const { file } = newLock();
    const a = takeLock(file, { maxAgeMs: 60_000 });
    assert.ok(a);
    assert.equal(fs.readFileSync(file, "utf8"), a);
    assert.equal(takeLock(file, { maxAgeMs: 60_000 }), null);
    assert.equal(fs.readFileSync(file, "utf8"), a, "the second taker disturbed the lock");
  });

  it("tokens are unique", () => {
    const x = newLock(), y = newLock();
    assert.notEqual(takeLock(x.file, { maxAgeMs: 1000 }), takeLock(y.file, { maxAgeMs: 1000 }));
  });

  it("the owner can release; the lock can then be taken again", () => {
    const { file } = newLock();
    const a = takeLock(file, { maxAgeMs: 60_000 });
    assert.equal(releaseLock(file, a), true);
    assert.ok(!fs.existsSync(file));
    assert.ok(takeLock(file, { maxAgeMs: 60_000 }));
  });

  it("OWNERSHIP: a worker that does not own the lock cannot delete it", () => {
    const { file } = newLock();
    const a = takeLock(file, { maxAgeMs: 60_000 });
    assert.equal(releaseLock(file, "999:not-the-token"), false);
    assert.equal(releaseLock(file, undefined), false);
    assert.equal(releaseLock(file, null), false);
    assert.equal(releaseLock(file, ""), false);
    assert.ok(fs.existsSync(file));
    assert.equal(releaseLock(file, a), true);
  });

  it("OWNERSHIP: a worker whose stale lock was taken over cannot delete the new owner's lock", () => {
    const { file } = newLock();
    const a = takeLock(file, { maxAgeMs: 60_000 });
    makeOld(file);                                    // a is now considered stale (it hung)
    const b = takeLock(file, { maxAgeMs: 60_000 });   // b takes over
    assert.ok(b && b !== a);
    assert.equal(releaseLock(file, a), false, "the old owner deleted the new owner's lock");
    assert.equal(fs.readFileSync(file, "utf8"), b);
    assert.equal(releaseLock(file, b), true);
  });

  it("releasing a lock that is already gone is harmless", () => {
    const { file } = newLock();
    const a = takeLock(file, { maxAgeMs: 60_000 });
    fs.rmSync(file);
    assert.equal(releaseLock(file, a), false);
  });
});

describe("lock: stale locks", () => {
  it("a stale lock is taken over once, reported, and leaves no stray files", () => {
    const { dir, file } = newLock();
    fs.writeFileSync(file, "99999");
    makeOld(file);
    let reported = null;
    const a = takeLock(file, { maxAgeMs: 120_000, onStale: age => { reported = age; } });
    assert.ok(a);
    assert.ok(reported >= 9 * 60 * 1000);
    assert.equal(fs.readFileSync(file, "utf8"), a);
    assert.deepEqual(fs.readdirSync(dir), [".sync.lock"]);
  });

  it("a second worker arriving right after a takeover sees a fresh lock and does not delete it", () => {
    const { file } = newLock();
    fs.writeFileSync(file, "99999");
    makeOld(file);
    const first = takeLock(file, { maxAgeMs: 120_000 });
    const second = takeLock(file, { maxAgeMs: 120_000 });
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(fs.readFileSync(file, "utf8"), first, "the fresh lock was deleted");
  });

  it("a fresh lock written by another process is respected", () => {
    const { file } = newLock();
    fs.writeFileSync(file, "99999");
    assert.equal(takeLock(file, { maxAgeMs: 120_000 }), null);
    assert.equal(fs.readFileSync(file, "utf8"), "99999");
  });

  it("many workers racing for one stale lock: exactly one wins", async () => {
    const { file } = newLock();
    fs.writeFileSync(file, "99999");
    makeOld(file);
    const winners = Array.from({ length: 25 }, () => takeLock(file, { maxAgeMs: 120_000 })).filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(fs.readFileSync(file, "utf8"), winners[0]);
  });
});
