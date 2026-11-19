// Store-independent contract tests for checks M-1 to M-8 (memory-architecture.md, section 8).
// M-9 (non-blocking hook) is a hook-wiring check and is not in this file.
// Usage: runContract("json", async () => ({ store, cleanup }))
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REPO_ROOT, SEED_FILE, BUDGET_TOKENS, REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES } from "../src/config.mjs";
import { ingest, evaluate } from "../src/retain.mjs";
import { retrieve } from "../src/core.mjs";
import { estimateTokens } from "../src/tokens.mjs";
import { REQUIRED, checkSource, normalise } from "../src/record.mjs";

export const seed = () => JSON.parse(fs.readFileSync(SEED_FILE, "utf8")).records;

// The Feature 2 task, as the read path would receive it.
export const TASK_QUERY =
  "Feature 2 parts reservation for a booked job must respect the Feature 1 booked slot: " +
  "buffered interval, 45 minute travel buffer, booking conflict 409 ApiError";

const replay = (extra = {}) => ({
  namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: TASK_QUERY, ...extra,
});
const ids = r => r.items.map(i => i.id);

export function runContract(label, makeStore) {
  describe(`${label}: contract M-1 to M-8`, () => {
    let store, cleanup, loaded;

    before(async () => {
      ({ store, cleanup } = await makeStore());
      await store.reset();
      loaded = await ingest(store, seed(), { repoRoot: REPO_ROOT });
    });
    after(async () => { await cleanup?.(); });

    it("seed: every replay record passes the Retain/Discard filter", () => {
      assert.deepEqual(loaded.discarded, []);
      assert.equal(loaded.written.length, seed().length);
    });

    it("M-1 round trip: a Feature 1 decision is written and retrieved by the Feature 2 task", async () => {
      const r = await retrieve(store, replay());
      assert.ok(ids(r).includes("mem-f1-buffered-interval"), `got ${ids(r)}`);
    });

    it("M-1 idempotent: ingesting the same seed twice adds no records", async () => {
      const before = (await store.all()).length;
      await ingest(store, seed(), { repoRoot: REPO_ROOT });
      assert.equal((await store.all()).length, before);
    });

    it("M-2 needed facts surface: buffered interval, 45-minute buffer, booking-conflicts rule", async () => {
      const r = await retrieve(store, replay());
      for (const id of ["mem-f1-buffered-interval", "mem-f1-buffer-45", "mem-rule-booking-conflicts"]) {
        assert.ok(ids(r).includes(id), `${id} missing; got ${ids(r)}`);
      }
      assert.match(r.block, /45/);
    });

    it("M-3 superseded rule is excluded by default and appears only with includeHistory", async () => {
      const normal = await retrieve(store, replay());
      assert.ok(!ids(normal).includes("mem-f1-exact-start"));
      assert.ok(!normal.block.includes("exactly matched"));
      // A history question: what was the original overlap check?
      const history = "original overlap check compared exact start time booking conflict";
      const off = await retrieve(store, replay({ text: history }));
      assert.ok(!ids(off).includes("mem-f1-exact-start"), `got ${ids(off)}`);
      const on = await retrieve(store, replay({ text: history, includeHistory: true }));
      assert.ok(ids(on).includes("mem-f1-exact-start"), `got ${ids(on)}`);
    });

    it("M-4 budget: the seed query stays within 500 estimated tokens", async () => {
      const r = await retrieve(store, replay());
      assert.ok(r.tokens <= BUDGET_TOKENS, `${r.tokens} tokens`);
      assert.equal(r.tokens, estimateTokens(r.block));
    });

    it("M-4 budget: a query built to overflow still stays within 500, and within a tight 120", async () => {
      const ns = "overflow:main:dev";
      const many = Array.from({ length: 40 }, (_, i) => ({
        id: `mem-ovf-${i}`, namespace: ns, feature: 1, type_tag: "fact", status: "current",
        source_task: "overflow-test", source_path: "AGENTS.md", timestamp: "2026-11-11",
        importance: (i % 3) + 1, keywords: ["buffer", "interval", "booking"],
        summary: `Overflow record ${i}: the travel buffer and the booking interval rule apply to every job on a technician calendar, ` +
                 `so a reservation tied to booking number ${i} must keep the buffered interval intact. Second sentence for shortening.`,
      }));
      const res = await ingest(store, many, { repoRoot: REPO_ROOT });
      assert.deepEqual(res.discarded, []);
      const q = { namespace: ns, asOf: REPLAY_AS_OF, features: [1], text: "travel buffer booking interval reservation technician" };
      const big = await retrieve(store, { ...q });
      assert.ok(big.tokens <= BUDGET_TOKENS, `${big.tokens} tokens`);
      assert.ok(big.items.length >= 1 && big.items.length < 40, `${big.items.length} items`);
      const tight = await retrieve(store, { ...q, budget: 120, reserve: 30 });
      assert.ok(tight.tokens <= 120, `${tight.tokens} tokens`);
    });

    it("M-5 namespace isolation: the decoy namespace never appears, and the reverse", async () => {
      const real = await retrieve(store, replay());
      assert.ok(!ids(real).includes("mem-decoy-buffer"));
      assert.ok(!real.block.includes("90"));
      const decoy = await retrieve(store, replay({ namespace: "decoy:main:dev" }));
      assert.deepEqual(ids(decoy), ["mem-decoy-buffer"]);
      const nothing = await retrieve(store, replay({ namespace: "no-such:main:dev" }));
      assert.deepEqual(ids(nothing), []);
    });

    it("M-6 as-of isolation: Feature 2's own records are not retrievable in the replay", async () => {
      const r = await retrieve(store, replay({ text: TASK_QUERY + " lock stock catalogue eligibility SCHEDULED api error contract" }));
      for (const id of ids(r)) assert.ok(!id.startsWith("mem-f2-"), `leaked ${id}`);
      assert.ok(!ids(r).includes("mem-rule-api-error-contract"), "a rule dated after as_of leaked");
    });

    it("defence in depth: a store that ignores every filter cannot leak into the block", async () => {
      const leaky = {
        all: () => store.all(),
        query: async (_filters, _text, _limit) => (await store.all()).map(record => ({ record, raw: 1 })),
      };
      const r = await retrieve(leaky, replay({ limit: 100 }));
      for (const id of ids(r)) {
        assert.ok(!["mem-f1-exact-start", "mem-decoy-buffer", "mem-f2-adr-001", "mem-f2-spec-eligibility",
          "mem-f2-seed-catalogue", "mem-rule-api-error-contract"].includes(id), `leaked ${id}`);
      }
      assert.ok(r.rejected.length >= 5, `only ${r.rejected.length} rejected`);
    });

    it("M-7 discard: stdout, logs, chatter, secrets, duplicates and unsourced facts are not written", async () => {
      const base = {
        namespace: REPLAY_NAMESPACE, feature: 1, type_tag: "fact", status: "current",
        source_task: "noise-test", source_path: "AGENTS.md", timestamp: "2026-11-11", importance: 1,
      };
      const noise = [
        { id: "n1", summary: "[INFO] BUILD SUCCESS in 4.2 s for module backend" },
        { id: "n2", summary: "Tests run: 12, Failures: 0, Errors: 0, Skipped: 0 in TechnicianAvailabilityServiceTest" },
        { id: "n3", summary: "    at com.serviceforge.service.TechnicianAvailabilityService.bookJob(TechnicianAvailabilityService.java:88)" },
        { id: "n4", summary: "2026-11-11T10:15:00 INFO started Tomcat on port 8080 with context path" },
        { id: "n5", summary: "Sure, let me look at that file and get back to you with the result shortly." },
        { id: "n6", summary: "The service uses api_key=sk-abcdefghijklmnop1234 for the calendar sync call" },
        { id: "n7", summary: "short" },
        { id: "n8", summary: "A fact with no real source behind it, so it cannot be checked.", source_path: "does/not/exist.md" },
        { id: "n9", summary: "A booked job occupies [start, end + 45 min) for its technician. The next job may start exactly at the buffered end. Both buffered intervals are compared, so inserting a job before an existing one also respects travel time." },
        { id: "n10", summary: "A fact with a missing provenance field must be refused outright.", source_task: "" },
      ].map(n => ({ ...base, ...n }));
      const before = (await store.all()).length;
      const res = await ingest(store, noise, { repoRoot: REPO_ROOT });
      assert.deepEqual(res.written, []);
      assert.equal(res.discarded.length, noise.length);
      assert.equal((await store.all()).length, before);
      assert.match(res.discarded.find(d => d.id === "n9").reasons.join(), /duplicate of mem-f1-buffered-interval/);
    });

    it("M-8 provenance: every stored record has all required fields and a real source", async () => {
      const all = await store.all();
      assert.ok(all.length >= seed().length);
      for (const r of all) {
        for (const f of REQUIRED) assert.ok(r[f] !== undefined && r[f] !== "", `${r.id} lacks ${f}`);
        assert.equal(checkSource(r.source_path, REPO_ROOT), "", `${r.id}: ${checkSource(r.source_path, REPO_ROOT)}`);
        assert.equal(typeof r.ts, "number", `${r.id} lacks numeric ts`);
      }
    });

    it("repeatable: the same query returns the same ids and scores twice", async () => {
      const a = await retrieve(store, replay());
      const b = await retrieve(store, replay());
      assert.deepEqual(a.items, b.items);
    });
  });
}
