// Unit tests for the read path (memory-architecture.md, section 7), on a fake in-memory store.
// They pin the scoring weights, recency, importance, the reserve, shortening, the 500-token ceiling, as_of and ties.
// The fake store returns exactly what a test gives it, so the core's own filtering and ranking are what is under test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retrieve } from "../src/core.mjs";
import { estimateTokens } from "../src/tokens.mjs";
import { tsOf } from "../src/record.mjs";

const NS = "ns:main:dev";
const ASOF = "2026-11-12";

const rec = (id, over = {}) => {
  const timestamp = over.timestamp ?? "2026-11-11";
  return {
    id, namespace: NS, feature: 1, type_tag: "fact", status: "current", source_task: "t", source_path: "x.md",
    timestamp, ts: tsOf(timestamp), importance: 2, keywords: [], summary: `Plain summary for ${id}.`, ...over,
  };
};
const cand = (id, raw, over) => ({ record: rec(id, over), raw });

/** A store that returns exactly the given candidates and remembers how it was called. */
function fake(cands, extra = {}) {
  const calls = [];
  return { calls, query: async (filters, text, limit) => { calls.push({ filters, text, limit }); return cands; }, all: async () => [], ...extra };
}
const run = (cands, o = {}, extra) => retrieve(fake(cands, extra), { namespace: NS, asOf: ASOF, text: "q", scaling: "max", ...o });
const ids = r => r.items.map(i => i.id);
const item = (r, id) => r.items.find(i => i.id === id);

// The same line format as core.mjs, so tests can compute exact token counts.
const lineOf = (r, summary = r.summary) => `- [${r.id}] ${summary} (source: ${r.source_path}; ${r.status}; ${r.timestamp})`;
const headerOf = (n, asOf = ASOF) => `MEMORY ns=${NS} as_of=${asOf} n=${String(n).padStart(2, "0")}`;
const blockOf = (records) => [headerOf(records.length), ...records.map(r => lineOf(r))].join("\n");

/** A one-sentence summary whose single-record block is exactly `tokens` estimated tokens (imp 3 record, id "big"). */
function summaryForTokens(tokens, over = {}) {
  for (let len = 20; len < 4000; len++) {
    const summary = "x".repeat(len);
    if (estimateTokens(blockOf([rec("big", { summary, ...over })])) === tokens) return summary;
  }
  throw new Error(`no summary found for ${tokens} tokens`);
}

describe("core: scoring", () => {
  it("score = 0.60 relevance + 0.25 recency + 0.15 importance, exactly, for known inputs", async () => {
    const r = await run([cand("a", 0.8, { timestamp: "2026-11-10", importance: 3 }), cand("b", 0.4, { timestamp: "2026-11-12", importance: 1 })]);
    // a: relevance 1, recency 0, importance 1 -> 0.60 + 0 + 0.15. b: relevance 0.5, recency 1, importance 1/3 -> 0.30 + 0.25 + 0.05.
    assert.deepEqual(item(r, "a"), { id: "a", score: 0.75, relevance: 1, recency: 0, importance: 1, shortened: false });
    assert.deepEqual(item(r, "b"), { id: "b", score: 0.6, relevance: 0.5, recency: 1, importance: 0.333333, shortened: false });
    assert.deepEqual(ids(r), ["a", "b"]);
  });

  it("custom weights are used", async () => {
    // One candidate: relevance 1, recency 1, importance 1/3 -> 0.5 + 0.3 + 0.2 / 3
    const r = await run([cand("a", 0.8, { importance: 1 })], { weights: { relevance: 0.5, recency: 0.3, importance: 0.2 } });
    assert.equal(item(r, "a").score, 0.866667);
  });

  it("recency is linear over the candidates' date range, oldest 0 and newest 1", async () => {
    const r = await run([
      cand("old", 0.5, { timestamp: "2026-11-10" }),
      cand("mid", 0.5, { timestamp: "2026-11-11" }),
      cand("new", 0.5, { timestamp: "2026-11-12" }),
    ]);
    assert.equal(item(r, "old").recency, 0);
    assert.equal(item(r, "mid").recency, 0.5);
    assert.equal(item(r, "new").recency, 1);
    assert.deepEqual(ids(r), ["new", "mid", "old"]);
  });

  it("recency is 1 for a single candidate, and for several candidates on the same date", async () => {
    assert.equal(item(await run([cand("a", 0.5, { timestamp: "2026-01-01" })]), "a").recency, 1);
    const same = await run([cand("a", 0.5), cand("b", 0.4)]);
    assert.deepEqual(same.items.map(i => i.recency), [1, 1]);
  });

  it("recency range comes from the candidates that pass the filters, not from rejected ones (design section 9)", async () => {
    const r = await run([
      cand("a", 0.5, { timestamp: "2026-11-10" }),
      cand("b", 0.5, { timestamp: "2026-11-11" }),
      cand("future", 0.5, { timestamp: "2026-12-31" }),   // after as_of: rejected, must not stretch the range
    ]);
    assert.equal(item(r, "a").recency, 0);
    assert.equal(item(r, "b").recency, 1);
  });

  it("importance counts as importance / 3 and orders otherwise equal records", async () => {
    const r = await run([cand("i1", 0.5, { importance: 1 }), cand("i3", 0.5, { importance: 3 }), cand("i2", 0.5, { importance: 2 })]);
    assert.deepEqual(ids(r), ["i3", "i2", "i1"]);
    assert.deepEqual([item(r, "i1").importance, item(r, "i2").importance, item(r, "i3").importance], [0.333333, 0.666667, 1]);
  });

  it("relevance orders otherwise equal records", async () => {
    const r = await run([cand("low", 0.2), cand("high", 0.9), cand("mid", 0.5)]);
    assert.deepEqual(ids(r), ["high", "mid", "low"]);
  });

  it("scaling 'max' divides by the best raw score", async () => {
    const r = await run([cand("a", 0.8), cand("b", 0.4), cand("c", 0.2)], { scaling: "max" });
    assert.deepEqual(r.items.map(i => i.relevance).sort((x, y) => y - x), [1, 0.5, 0.25]);
  });

  it("scaling 'minmax' stretches worst..best to 0..1; one candidate or all equal score 1", async () => {
    const r = await run([cand("a", 0.8), cand("b", 0.4), cand("c", 0.2)], { scaling: "minmax" });
    assert.equal(item(r, "a").relevance, 1);
    assert.equal(item(r, "b").relevance, 0.333333);
    assert.equal(item(r, "c").relevance, 0);
    assert.equal(item(await run([cand("a", 0.3)], { scaling: "minmax" }), "a").relevance, 1);
    const equal = await run([cand("a", 0.3), cand("b", 0.3)], { scaling: "minmax" });
    assert.deepEqual(equal.items.map(i => i.relevance), [1, 1]);
  });
});

describe("core: ties and determinism", () => {
  it("equal scores are ordered by importance (higher first), then by id", async () => {
    // Only relevance counts here, so every score ties; importance and id decide.
    const w = { weights: { relevance: 1, recency: 0, importance: 0 } };
    const r = await run([cand("a", 1, { importance: 1 }), cand("z", 1, { importance: 3 }), cand("m", 1, { importance: 3 }), cand("b", 1, { importance: 1 })], w);
    assert.deepEqual(ids(r), ["m", "z", "a", "b"]);
  });

  it("identical records come out in id order whatever the input order", async () => {
    const order = ["z", "y", "x"];
    const a = await run(order.map(id => cand(id, 0.5)));
    const b = await run([...order].reverse().map(id => cand(id, 0.5)));
    assert.deepEqual(ids(a), ["x", "y", "z"]);
    assert.deepEqual(a.items, b.items);
    assert.equal(a.block, b.block);
  });

  it("the same input twice gives the same output", async () => {
    const cands = [cand("a", 0.7, { importance: 3 }), cand("b", 0.7, { timestamp: "2026-11-12" }), cand("c", 0.1, { importance: 1 })];
    assert.deepEqual(await run(cands), await run(cands));
  });
});

describe("core: filters applied again by the core", () => {
  it("as_of: a record on the as_of date is read, one day later is not, one day earlier is", async () => {
    const c = [cand("r", 0.5, { timestamp: "2026-11-12" })];
    assert.deepEqual(ids(await run(c, { asOf: "2026-11-12" })), ["r"]);
    const before = await run(c, { asOf: "2026-11-11" });
    assert.deepEqual(ids(before), []);
    assert.deepEqual(before.rejected, [{ id: "r", why: "after as_of" }]);
    assert.deepEqual(ids(await run(c, { asOf: "2026-11-13" })), ["r"]);
  });

  it("a store that ignores every filter cannot leak a record", async () => {
    const r = await run([
      cand("ok", 0.5),
      cand("othernamespace", 0.9, { namespace: "other:main:dev" }),
      cand("feature2", 0.9, { feature: 2 }),
      cand("old", 0.9, { status: "superseded" }),
      cand("later", 0.9, { timestamp: "2026-12-01" }),
    ]);
    assert.deepEqual(ids(r), ["ok"]);
    assert.deepEqual(r.rejected.map(x => `${x.id}:${x.why}`).sort(), ["feature2:feature", "later:after as_of", "old:superseded", "othernamespace:namespace"]);
  });

  it("superseded records are read only with includeHistory; feature 'all' is read by the default features", async () => {
    const c = [cand("old", 0.5, { status: "superseded" }), cand("rule", 0.4, { feature: "all" })];
    assert.deepEqual(ids(await run(c)), ["rule"]);
    assert.deepEqual(ids(await run(c, { includeHistory: true })).sort(), ["old", "rule"]);
  });

  it("the store gets the filters, the text and the limit", async () => {
    const store = fake([]);
    await retrieve(store, { namespace: NS, asOf: ASOF, text: "hello", includeHistory: true, features: [2], limit: 7 });
    assert.deepEqual(store.calls, [{ filters: { namespace: NS, asOf: ASOF, features: [2], includeHistory: true }, text: "hello", limit: 7 }]);
    await retrieve(store, { namespace: NS, asOf: ASOF, text: "hello" });
    assert.equal(store.calls[1].limit, 10);
    assert.deepEqual(store.calls[1].filters.features, [1, "all"]);
  });
});

describe("core: minimum relevance floor (F-7)", () => {
  const c = () => [cand("zero", 0), cand("low", 0.2), cand("atfloor", 0.3), cand("above", 0.31), cand("top", 0.9)];

  it("default floor is 0: a raw score of 0 is dropped, any positive score is kept", async () => {
    assert.deepEqual(ids(await run(c())).sort(), ["above", "atfloor", "low", "top"]);
  });

  it("a store's minRelevance is a floor: only raw scores above it are kept", async () => {
    const r = await run(c(), {}, { minRelevance: 0.3 });
    assert.deepEqual(ids(r).sort(), ["above", "top"]);
  });

  it("the floor applies before scaling: the best surviving hit is scaled to 1", async () => {
    const r = await run([cand("a", 0.4), cand("b", 0.2)], {}, { minRelevance: 0.3 });
    assert.deepEqual(r.items.map(i => [i.id, i.relevance]), [["a", 1]]);
  });

  it("nothing above the floor means nothing is injected: empty block, 0 tokens", async () => {
    const r = await run([cand("a", 0.1), cand("b", 0.29)], {}, { minRelevance: 0.3 });
    assert.deepEqual(r.items, []);
    assert.equal(r.block, "");
    assert.equal(r.tokens, 0);
  });

  it("the option minRelevance overrides the store's value", async () => {
    const r = await run(c(), { minRelevance: 0.5 }, { minRelevance: 0 });
    assert.deepEqual(ids(r), ["top"]);
  });
});

describe("core: token budget", () => {
  it("the header is counted: a block that fits exactly at the ceiling is kept, one token over is skipped", async () => {
    const summary = summaryForTokens(60);
    const c = [cand("big", 0.5, { importance: 3, summary })];
    const fits = await run(c, { budget: 60 });
    assert.deepEqual(ids(fits), ["big"]);
    assert.equal(fits.tokens, 60);
    const over = await run(c, { budget: 59 });
    assert.deepEqual(ids(over), []);
    assert.deepEqual(over.skipped, [{ id: "big", why: "does not fit the budget" }]);
  });

  it("the default ceiling is 500: a block of 500 tokens is kept, 501 is not", async () => {
    const at500 = await run([cand("big", 0.5, { importance: 3, summary: summaryForTokens(500) })]);
    assert.deepEqual(ids(at500), ["big"]);
    assert.equal(at500.tokens, 500);
    for (const over of [501, 502, 503, 504]) {
      const r = await run([cand("big", 0.5, { importance: 3, summary: summaryForTokens(over) })]);
      assert.deepEqual(ids(r), [], `${over} tokens was injected`);
      assert.equal(r.budget, 500);
    }
  });

  it("importance 3 may use the whole budget; any other record stops at budget minus the reserve", async () => {
    const summary = summaryForTokens(60);
    // reserve 20: budget 80 leaves 60 for the others, so a 60-token block fits for importance 2 at 80, not at 79.
    assert.deepEqual(ids(await run([cand("big", 0.5, { importance: 2, summary })], { budget: 80, reserve: 20 })), ["big"]);
    assert.deepEqual(ids(await run([cand("big", 0.5, { importance: 2, summary })], { budget: 79, reserve: 20 })), []);
    assert.deepEqual(ids(await run([cand("big", 0.5, { importance: 1, summary })], { budget: 79, reserve: 20 })), []);
    // importance 3 at the same settings is not held back by the reserve.
    assert.deepEqual(ids(await run([cand("big", 0.5, { importance: 3, summary })], { budget: 60, reserve: 20 })), ["big"]);
  });

  it("the reserve is kept for importance 3: lesser records stop early, a later importance-3 record still fits", async () => {
    const small = i => cand(`low${i}`, 1, { importance: 1, summary: "y".repeat(120) });
    const lows = [0, 1, 2, 3, 4, 5].map(small);
    const only = await run(lows, { budget: 200, reserve: 100 });
    assert.ok(only.tokens <= 100, `${only.tokens} tokens for importance-1 records only`);
    assert.ok(only.items.length >= 1 && only.items.length < lows.length, `${only.items.length} items`);
    assert.ok(only.skipped.length >= 1);
    const withRule = await run([...lows, cand("rule", 0.2, { importance: 3, summary: "z".repeat(120) })], { budget: 200, reserve: 100 });
    assert.ok(ids(withRule).includes("rule"), `got ${ids(withRule)}`);
    assert.ok(withRule.tokens > 100 && withRule.tokens <= 200, `${withRule.tokens} tokens`);
    // Without a reserve the lesser records may fill the whole budget.
    const noReserve = await run(lows, { budget: 200, reserve: 0 });
    assert.ok(noReserve.tokens > 100 && noReserve.tokens <= 200, `${noReserve.tokens} tokens`);
  });

  it("a record that does not fit is skipped and a later, shorter one is still tried", async () => {
    const r = await run([
      cand("huge", 0.9, { importance: 3, summary: "h".repeat(4000) }),
      cand("tiny", 0.5, { importance: 3, summary: "Tiny fact." }),
    ], { budget: 100 });
    assert.deepEqual(ids(r), ["tiny"]);
    assert.deepEqual(r.skipped, [{ id: "huge", why: "does not fit the budget" }]);
  });

  it("never above 500 estimated tokens, for many mixed record sets", async () => {
    let seed = 12345;
    const next = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 40; round++) {
      const cands = Array.from({ length: 1 + next(30) }, (_, i) => cand(`r${i}`, (1 + next(100)) / 100, {
        importance: 1 + next(3), timestamp: `2026-11-${String(1 + next(12)).padStart(2, "0")}`,
        summary: "w".repeat(20 + next(500)) + (next(2) ? ". Second sentence stays here." : "."),
      }));
      const r = await run(cands, { limit: 100 });
      assert.ok(r.tokens <= 500, `round ${round}: ${r.tokens} tokens`);
      assert.equal(r.tokens, r.block ? estimateTokens(r.block) : 0);
    }
  });
});

describe("core: shortening to the first sentence", () => {
  const two = "The buffer is 45 minutes between any two jobs. " + "Second sentence with a lot of extra detail that costs tokens. ".repeat(6).trim();
  const fullTokens = estimateTokens(blockOf([rec("s", { importance: 3, summary: two })]));
  const shortTokens = estimateTokens(blockOf([rec("s", { importance: 3, summary: "The buffer is 45 minutes between any two jobs." })]));

  it("a record that does not fit is shortened to its first sentence, which does fit", async () => {
    assert.ok(shortTokens < fullTokens);
    const r = await run([cand("s", 0.5, { importance: 3, summary: two })], { budget: shortTokens });
    assert.deepEqual(ids(r), ["s"]);
    assert.equal(item(r, "s").shortened, true);
    assert.ok(r.block.includes("The buffer is 45 minutes between any two jobs. (source:"), r.block);
    assert.ok(!r.block.includes("Second sentence"));
    assert.equal(r.tokens, shortTokens);
  });

  it("a record that fits is not shortened", async () => {
    const r = await run([cand("s", 0.5, { importance: 3, summary: two })], { budget: fullTokens });
    assert.equal(item(r, "s").shortened, false);
    assert.ok(r.block.includes("Second sentence"));
  });

  it("a record whose first sentence still does not fit is skipped, never cut in the middle", async () => {
    const r = await run([cand("s", 0.5, { importance: 3, summary: two })], { budget: shortTokens - 1 });
    assert.deepEqual(ids(r), []);
    assert.deepEqual(r.skipped.map(s => s.id), ["s"]);
  });

  it("a one-sentence record that does not fit is skipped, not truncated", async () => {
    const r = await run([cand("s", 0.5, { importance: 3, summary: "No second sentence here, only one long clause that goes on and on and on." })], { budget: 20 });
    assert.deepEqual(ids(r), []);
    assert.equal(r.block, "");
  });

  it("an abbreviation such as 'e.g.' does not end the sentence (F-12)", async () => {
    const text = "Rules differ by region, e.g. the northern depot uses a longer buffer. " + "More detail follows in a second sentence for the budget. ".repeat(5).trim();
    const short = "Rules differ by region, e.g. the northern depot uses a longer buffer.";
    const budget = estimateTokens(blockOf([rec("s", { importance: 3, summary: short })]));
    const r = await run([cand("s", 0.5, { importance: 3, summary: text })], { budget });
    assert.equal(item(r, "s").shortened, true);
    assert.ok(r.block.includes(`${short} (source:`), r.block);
  });

  it("a sentence may end before a digit, '!' or '?'", async () => {
    for (const first of ["Is the buffer 45 minutes?", "Always keep the buffer!", "The buffer is fixed. 45 minutes apply to all jobs."]) {
      const text = `${first} ${"Extra sentence that makes the whole record far too long for a small budget. ".repeat(6)}`.trim();
      const firstOnly = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)[0];
      const budget = estimateTokens(blockOf([rec("s", { importance: 3, summary: firstOnly })]));
      const r = await run([cand("s", 0.5, { importance: 3, summary: text })], { budget });
      assert.ok(r.block.includes(`${firstOnly} (source:`), `${first}: ${r.block}`);
    }
  });
});

describe("core: budget edge cases (F-11)", () => {
  const rule = [cand("rule", 0.5, { importance: 3, summary: "Keep the buffer at 45 minutes." })];
  const lesser = [cand("low", 0.5, { importance: 1, summary: "Keep the buffer at 45 minutes." })];

  it("a budget smaller than the header returns an empty block", async () => {
    for (const budget of [0, 1, 8]) {
      const r = await run(rule, { budget });
      assert.equal(r.block, "", `budget ${budget}`);
      assert.equal(r.tokens, 0);
      assert.deepEqual(r.items, []);
      assert.deepEqual(r.skipped, [{ id: "rule", why: "header alone exceeds the budget" }]);
      assert.equal(r.budget, budget);
    }
  });

  it("budget 40: the block never exceeds 40 tokens, and the reserve is clamped below the budget", async () => {
    const r = await run(rule, { budget: 40 });   // default reserve 100 is far above 40
    assert.deepEqual(ids(r), ["rule"]);
    assert.ok(r.tokens <= 40 && r.tokens === estimateTokens(r.block), `${r.tokens}`);
    // A lesser record has budget minus clamped reserve = 1 token of room: nothing fits.
    assert.deepEqual(ids(await run(lesser, { budget: 40 })), []);
  });

  it("a negative reserve is treated as 0, so the budget is still never exceeded", async () => {
    const big = Array.from({ length: 6 }, (_, i) => cand(`b${i}`, 0.5, { importance: 1, summary: "q".repeat(100) }));
    const r = await run(big, { budget: 100, reserve: -50 });
    assert.ok(r.tokens <= 100, `${r.tokens}`);
  });

  it("a reserve at or above the budget never makes the ceiling negative; importance 3 is unaffected", async () => {
    assert.deepEqual(ids(await run(rule, { budget: 100, reserve: 500 })), ["rule"]);
    assert.deepEqual(ids(await run(rule, { budget: 100, reserve: 100 })), ["rule"]);
  });

  it("no candidates: empty block, 0 tokens, no items", async () => {
    const r = await run([]);
    assert.deepEqual([r.block, r.tokens, r.items], ["", 0, []]);
  });
});
