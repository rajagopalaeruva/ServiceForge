import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { extractAll, shorten, stripMd } from "../src/extract.mjs";
import { sync, plan } from "../src/sync.mjs";
import { ingest } from "../src/retain.mjs";
import { retrieve } from "../src/core.mjs";
import { JsonStore } from "../src/stores/json-store.mjs";
import { REPO_ROOT, EXTRACT_SOURCES_FILE, REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES, BUDGET_TOKENS } from "../src/config.mjs";
import { TASK_QUERY } from "./contract.mjs";

const config = JSON.parse(fs.readFileSync(EXTRACT_SOURCES_FILE, "utf8"));
const tmpDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const freshStore = () => new JsonStore(path.join(tmpDir("memtest-ext-"), "store.json"));
const sha = f => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const ids = r => r.items.map(i => i.id);

function copyInto(root, rel) {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  return dest;
}

describe("extractor: real repo documents", () => {
  let result;
  before(() => { result = extractAll(config, { repoRoot: REPO_ROOT }); });
  const get = id => result.candidates.find(c => c.id === id);

  it("finds decision-log sections, all ADR rows and both rules", () => {
    for (const id of [
      "mem-x-f1-standard-travel-buffer-per-job-is-45-minutes",
      "mem-x-f1-overlap-detection-compares-exact-start-times-not-intervals",
      "mem-x-f1-buffered-interval-detection",
      "mem-x-adr-000", "mem-x-adr-001", "mem-x-adr-005",
      "mem-x-rule-booking-conflicts", "mem-x-rule-api-error-contract",
    ]) assert.ok(get(id), `missing ${id}`);
    assert.equal(result.candidates.filter(c => c.id.startsWith("mem-x-adr-")).length, 6);
  });

  it("skips sections that are not decisions, with a reason", () => {
    assert.ok(result.skipped.some(s => /follow-ups/.test(s.source) && /not a 'Decision:' section/.test(s.reason)));
  });

  it("reads status from the text: the exact-start rule is superseded, the others are current", () => {
    assert.equal(get("mem-x-f1-overlap-detection-compares-exact-start-times-not-intervals").status, "superseded");
    assert.equal(get("mem-x-f1-buffered-interval-detection").status, "current");
    assert.equal(get("mem-x-f1-standard-travel-buffer-per-job-is-45-minutes").status, "current");
  });

  it("takes dates from the source, and marks a date as assumed when the source gives none", () => {
    const dated = get("mem-x-f1-buffered-interval-detection");
    assert.equal(dated.timestamp, "2026-11-11");
    assert.equal(dated.note, undefined);
    const undated = get("mem-x-f1-standard-travel-buffer-per-job-is-45-minutes");
    assert.match(undated.note, /date assumed/);
    assert.equal(get("mem-x-adr-001").timestamp, "2026-11-17");     // from the ADR's front matter
    assert.equal(get("mem-x-adr-001").note, undefined);
  });

  it("maps features, importance and task ids", () => {
    assert.equal(get("mem-x-adr-000").feature, "all");
    assert.equal(get("mem-x-adr-001").feature, 2);
    assert.equal(get("mem-x-rule-booking-conflicts").importance, 3);
    assert.equal(get("mem-x-rule-booking-conflicts").feature, "all");
    assert.equal(get("mem-x-f1-buffered-interval-detection").source_task, "BUG-001");
    assert.equal(get("mem-x-f1-overlap-detection-compares-exact-start-times-not-intervals").importance, 1);
  });

  it("summaries are plain text, within the limit, and ids are well formed", () => {
    for (const c of result.candidates) {
      assert.ok(c.summary.length >= 25 && c.summary.length <= 600, `${c.id}: ${c.summary.length} chars`);
      assert.ok(!/[`]|\*\*|\]\(/.test(c.summary), `${c.id} still has markdown: ${c.summary}`);
      assert.ok(!/^What was decided:/i.test(c.summary), `${c.id} keeps the boilerplate label`);
      assert.ok(c.id.length <= 80 && !c.id.endsWith("-"), `bad id ${c.id}`);
      assert.ok(c.keywords.length > 0, `${c.id} has no keywords`);
      assert.equal(c.origin, "extract");
      assert.match(c.source_hash, /^[0-9a-f]{12}$/);
    }
    assert.equal(new Set(result.candidates.map(c => c.id)).size, result.candidates.length);
  });

  it("every candidate passes the Retain/Discard filter, including real source paths and anchors", async () => {
    const res = await ingest(freshStore(), result.candidates, { repoRoot: REPO_ROOT });
    assert.deepEqual(res.discarded, []);
    assert.equal(res.written.length, result.candidates.length);
  });

  it("is deterministic and never edits a source file", () => {
    const files = [...new Set(config.sources.map(s => s.path))].map(p => path.join(REPO_ROOT, p));
    const adrFiles = fs.readdirSync(path.join(REPO_ROOT, "pipeline/decisions/adr")).map(f => path.join(REPO_ROOT, "pipeline/decisions/adr", f));
    const watched = [...files, ...adrFiles];
    const before = watched.map(sha);
    const again = extractAll(config, { repoRoot: REPO_ROOT });
    assert.deepEqual(again, result);
    assert.deepEqual(watched.map(sha), before);
  });
});

describe("extractor: replay from extracted records only (no hand-written seed)", () => {
  let store;
  before(async () => {
    store = freshStore();
    const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
    await ingest(store, candidates, { repoRoot: REPO_ROOT });
  });
  const replay = (extra = {}) => ({ namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: TASK_QUERY, ...extra });

  it("the Feature 2 task retrieves the buffered interval, the 45-minute buffer and the booking-conflicts rule", async () => {
    const r = await retrieve(store, replay());
    for (const id of ["mem-x-f1-buffered-interval-detection", "mem-x-f1-standard-travel-buffer-per-job-is-45-minutes", "mem-x-rule-booking-conflicts"]) {
      assert.ok(ids(r).includes(id), `${id} missing; got ${ids(r)}`);
    }
    assert.ok(r.tokens <= BUDGET_TOKENS);
  });

  it("the superseded rule is excluded by default and available as history", async () => {
    const sup = "mem-x-f1-overlap-detection-compares-exact-start-times-not-intervals";
    const history = "original overlap check compared exact start time booking conflict";
    assert.ok(!ids(await retrieve(store, replay())).includes(sup));
    assert.ok(!ids(await retrieve(store, replay({ text: history }))).includes(sup));
    assert.ok(ids(await retrieve(store, replay({ text: history, includeHistory: true }))).includes(sup));
  });

  it("Feature 2 decisions, ADRs and records dated after as_of are not retrievable", async () => {
    const r = await retrieve(store, replay({ text: TASK_QUERY + " lock stock catalogue exception ADR api error contract record architecture decisions" }));
    for (const id of ids(r)) {
      assert.ok(!id.startsWith("mem-x-f2-") && !/^mem-x-adr-/.test(id) && id !== "mem-x-rule-api-error-contract", `leaked ${id}`);
    }
  });
});

describe("sync: idempotent, changes only what changed", () => {
  it("first sync writes everything, the second writes nothing", async () => {
    const store = freshStore();
    const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
    const first = await sync(store, candidates, { repoRoot: REPO_ROOT });
    assert.equal(first.added.length, candidates.length);
    assert.equal(first.written.length, candidates.length);
    assert.deepEqual(first.discarded, []);
    const second = await sync(store, candidates, { repoRoot: REPO_ROOT });
    assert.deepEqual([second.added, second.changed, second.written, second.removed], [[], [], [], []]);
    assert.equal(second.unchanged, candidates.length);
    assert.equal((await store.all()).length, candidates.length);
  });

  it("dry run reports but writes nothing", async () => {
    const store = freshStore();
    const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
    const r = await sync(store, candidates, { repoRoot: REPO_ROOT, dryRun: true });
    assert.equal(r.added.length, candidates.length);
    assert.deepEqual(r.written, []);
    assert.equal((await store.all()).length, 0);
  });
});

describe("sync: a changed or removed source section is detected (temporary copy of the repo files)", () => {
  const rel = "pipeline/decisions/feature-1-decisions.md";
  const rule = "pipeline/rules/booking-conflicts.md";
  const cfg = { namespace: REPLAY_NAMESPACE, sources: config.sources.filter(s => s.path === rel || s.path === rule) };
  const bufferedId = "mem-x-f1-buffered-interval-detection";
  const exactId = "mem-x-f1-overlap-detection-compares-exact-start-times-not-intervals";

  async function setup() {
    const root = tmpDir("memtest-repo-");
    const file = copyInto(root, rel);
    copyInto(root, rule);
    const store = freshStore();
    const first = extractAll(cfg, { repoRoot: root });
    await sync(store, first.candidates, { repoRoot: root });
    return { root, file, store };
  }

  it("an edited section is reported as changed and only that record is rewritten", async () => {
    const { root, file, store } = await setup();
    const original = fs.readFileSync(file, "utf8");
    const edited = original.replaceAll("with exactly 45 minutes between jobs", "with exactly 50 minutes between jobs");
    assert.notEqual(edited, original, "test setup: the text to edit was not found");
    fs.writeFileSync(file, edited);
    const { candidates } = extractAll(cfg, { repoRoot: root });
    const p = await plan(store, candidates);
    assert.deepEqual(p.changed.map(c => c.id), [bufferedId]);
    assert.deepEqual(p.added, []);
    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.written, [bufferedId]);
    const rec = (await store.all()).find(x => x.id === bufferedId);
    assert.match(rec.summary, /50 minutes/);
  });

  it("a deleted section is reported as removed and its record is kept, not deleted", async () => {
    const { root, file, store } = await setup();
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const start = text.indexOf("## Decision: overlap detection compares exact start times");
    const end = text.indexOf("## Decision: buffered interval detection");
    fs.writeFileSync(file, text.slice(0, start) + text.slice(end));
    const { candidates } = extractAll(cfg, { repoRoot: root });
    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.removed, [exactId]);
    assert.ok((await store.all()).some(x => x.id === exactId), "record was deleted");
  });

  it("a section with no prose paragraph is skipped with a reason, not written", () => {
    const root = tmpDir("memtest-repo-");
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest,
      "# Log\n\n## Decision: has prose\n\nThis decision has a real paragraph that is long enough to keep.\n\n" +
      "## Decision: only a list\n\n- one\n- two\n\n## Decision: short\n\nToo short.\n");
    const r = extractAll({ namespace: REPLAY_NAMESPACE, sources: [{ kind: "decision-log", path: rel, feature: 1, defaultDate: "2026-11-11" }] }, { repoRoot: root });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.skipped.length, 2);
    assert.ok(r.skipped.every(s => /no usable first paragraph/.test(s.reason)));
  });
});

describe("extractor helpers", () => {
  it("shorten cuts at a sentence boundary, or returns null when there is none", () => {
    const text = "First sentence is here and is quite long enough to count. ".repeat(20);
    const s = shorten(text, 200);
    assert.ok(s.length <= 200 && s.endsWith("."));
    assert.equal(shorten("x".repeat(300), 100), null);
    assert.equal(shorten("short text", 100), "short text");
  });
  it("stripMd removes links, bold and code", () => {
    assert.equal(stripMd("**Label:** see [BUG-001](../bugs/b.md) for `x + 1`."), "Label: see BUG-001 for x + 1.");
  });
});
