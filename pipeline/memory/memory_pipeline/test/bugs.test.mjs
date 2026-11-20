// Bug records -> episode records (source kind "bug-dir" in src/extract.mjs).
// Real repo checks, a synthetic temporary repo for change detection, and retrieval on extracted-only stores.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAll } from "../src/extract.mjs";
import { sync, plan, STALE_REASON } from "../src/sync.mjs";
import { ingest } from "../src/retain.mjs";
import { retrieve } from "../src/core.mjs";
import { JsonStore } from "../src/stores/json-store.mjs";
import { ChromaStore } from "../src/stores/chroma-store.mjs";
import { QdrantStore } from "../src/stores/qdrant-store.mjs";
import { REPO_ROOT, EXTRACT_SOURCES_FILE, REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES, BUDGET_TOKENS } from "../src/config.mjs";
import { TASK_QUERY } from "./contract.mjs";

const config = JSON.parse(fs.readFileSync(EXTRACT_SOURCES_FILE, "utf8"));
const bugEntry = config.sources.find(s => s.kind === "bug-dir");
const bugOnly = (entry = bugEntry) => ({ namespace: config.namespace, sources: [entry] });
const BUG_DIR = "pipeline/bugs";

const made = [];
const tmpDir = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const freshStore = () => new JsonStore(path.join(tmpDir("memtest-bug-"), "store.json"));
const ids = r => r.items.map(i => i.id);

/** A temporary repo holding a copy of pipeline/bugs (template included), at the same relative path. */
function bugRepo() {
  const root = tmpDir("memtest-bugrepo-");
  fs.mkdirSync(path.join(root, BUG_DIR), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO_ROOT, BUG_DIR))) fs.copyFileSync(path.join(REPO_ROOT, BUG_DIR, f), path.join(root, BUG_DIR, f));
  return root;
}
const bugFile = (root, name) => path.join(root, BUG_DIR, name);
const F2 = "bug-002-job-time-range-validation.md";

describe("bug extractor: real repo", () => {
  let result, bugs;
  before(() => {
    result = extractAll(config, { repoRoot: REPO_ROOT });
    bugs = result.candidates.filter(c => c.type_tag === "episode");
  });
  const get = id => bugs.find(c => c.id === id);

  it("the config has a bug-dir entry and exactly four bug candidates come out, one per bug file", () => {
    assert.ok(bugEntry, "no bug-dir entry in extract-sources.json");
    assert.equal(bugEntry.dir, BUG_DIR);
    assert.deepEqual(bugs.map(c => c.id), ["mem-x-bug-001", "mem-x-bug-002", "mem-x-bug-003", "mem-x-bug-004"]);
    for (const c of bugs) {
      assert.equal(c.origin, "extract");
      assert.equal(c.namespace, config.namespace);
      assert.equal(c.source_task, c.id.replace("mem-x-bug-", "BUG-"));
      assert.equal(c.feature, 1);
      assert.match(c.source_hash, /^[0-9a-f]{12}$/);
      assert.ok(c.keywords.length > 0);
    }
  });

  it("the template is not extracted", () => {
    assert.ok(!result.candidates.some(c => /_template/.test(c.source_path) || /bug-nnn/i.test(c.id)));
    assert.ok(!result.skipped.some(s => /_template/.test(s.source)), "the template should be ignored, not skipped");
  });

  it("status: Verified and Closed are current, every other state is proposed; the raw state is kept", () => {
    assert.deepEqual(bugs.map(c => [c.id, c.status]), [
      ["mem-x-bug-001", "current"], ["mem-x-bug-002", "proposed"], ["mem-x-bug-003", "current"], ["mem-x-bug-004", "proposed"]]);
    assert.equal(get("mem-x-bug-001").bug_state, "Verified");
    assert.equal(get("mem-x-bug-002").bug_state, "Fix Proposed (awaiting human decision)");
    assert.equal(get("mem-x-bug-003").bug_state, "Closed (2026-11-17)");
    assert.match(get("mem-x-bug-004").bug_state, /^Routed to BA \(requirement gap/);
    for (const c of bugs) assert.ok(!/\*\*|`|\]\(/.test(c.bug_state), `markdown left in ${c.bug_state}`);
  });

  it("dates: the Reported date, or for BUG-001 the earliest date in the file; none assumed", () => {
    assert.deepEqual(bugs.map(c => c.timestamp), ["2026-11-11", "2026-11-12", "2026-11-12", "2026-11-12"]);
    for (const c of bugs) assert.equal(c.note, undefined, `${c.id} has an assumed date`);
  });

  it("importance: open bugs (proposed) get 1; resolved bugs follow the Severity cell (S1/S2 -> 3, S3 -> 2, S4 -> 1, none -> 2)", () => {
    for (const c of bugs) {
      const text = fs.readFileSync(path.join(REPO_ROOT, c.source_path.split("#")[0]), "utf8");
      const sev = /\|\s*\*\*Severity[^|]*\|\s*S([1-4])\b/.exec(text)?.[1];
      const bySeverity = sev === undefined ? 2 : { 1: 3, 2: 3, 3: 2, 4: 1 }[sev];
      assert.equal(c.importance, c.status === "proposed" ? 1 : bySeverity, `${c.id} ${c.status} severity S${sev}`);
    }
    assert.deepEqual(bugs.map(c => [c.id, c.importance]), [
      ["mem-x-bug-001", 2], ["mem-x-bug-002", 1], ["mem-x-bug-003", 2], ["mem-x-bug-004", 1]]);
  });

  it("each summary holds its root-cause idea and a State part", () => {
    const cause = { "mem-x-bug-001": /start[- ]time/i, "mem-x-bug-002": /endTime/, "mem-x-bug-003": /exception handler/i, "mem-x-bug-004": /requirement/i };
    for (const c of bugs) {
      assert.match(c.summary, cause[c.id], `${c.id}: ${c.summary}`);
      assert.match(c.summary, /(Root cause|Fix): /);
      assert.ok(c.summary.endsWith(` State: ${c.bug_state}.`), `${c.id} does not end with its state: ${c.summary}`);
    }
    assert.match(get("mem-x-bug-002").summary, /Root cause: no check that endTime is after startTime/);
  });

  it("summaries are plain text without raw evidence and within the limit", () => {
    for (const c of bugs) {
      assert.ok(c.summary.length >= 25 && c.summary.length <= 550, `${c.id}: ${c.summary.length}`);
      assert.ok(!/[`]|\*\*|\]\(|^#|\n/.test(c.summary), `${c.id} has markdown: ${c.summary}`);
      assert.ok(!/[{}]|"\w+":|HTTP\/1|Invoke-WebRequest|mvn |Tests run/.test(c.summary), `${c.id} has raw evidence: ${c.summary}`);
    }
  });

  it("source_path points at the section the summary came from", () => {
    assert.deepEqual(bugs.map(c => c.source_path), [
      "pipeline/bugs/bug-001-booking-overlap.md#expected-and-actual-behavior",
      "pipeline/bugs/bug-002-job-time-range-validation.md#1-summary",
      "pipeline/bugs/bug-003-validation-error-contract.md#1-summary",
      "pipeline/bugs/bug-004-non-scheduled-jobs-block-calendar.md#1-summary"]);
  });

  it("all candidates pass ingest against the real repo with zero discarded", async () => {
    const res = await ingest(freshStore(), result.candidates, { repoRoot: REPO_ROOT });
    assert.deepEqual(res.discarded, []);
    assert.equal(res.written.length, result.candidates.length);
  });
});

describe("bug extractor: changes in a temporary repo", () => {
  async function setup() {
    const root = bugRepo();
    const store = freshStore();
    const first = extractAll(bugOnly(), { repoRoot: root });
    const r = await sync(store, first.candidates, { repoRoot: root });
    assert.deepEqual(r.discarded, []);
    return { root, store, first };
  }

  it("an edited Status cell is reported as changed and flips proposed to current", async () => {
    const { root, store } = await setup();
    const file = bugFile(root, F2);
    const text = fs.readFileSync(file, "utf8");
    const edited = text.replace("| **Status** | Fix Proposed (awaiting human decision) |", "| **Status** | Closed (2026-11-21) |");
    assert.notEqual(edited, text, "test setup: status cell not found");
    fs.writeFileSync(file, edited);
    const { candidates } = extractAll(bugOnly(), { repoRoot: root });
    const p = await plan(store, candidates);
    assert.deepEqual(p.changed.map(c => c.id), ["mem-x-bug-002"]);
    assert.deepEqual([p.added, p.removed], [[], []]);
    await sync(store, candidates, { repoRoot: root });
    const rec = (await store.all()).find(r => r.id === "mem-x-bug-002");
    assert.deepEqual([rec.status, rec.bug_state], ["current", "Closed (2026-11-21)"]);
    assert.match(rec.summary, /State: Closed \(2026-11-21\)\.$/);
  });

  it("an edited Status to another open state still changes the record and keeps it proposed", async () => {
    const { root, store } = await setup();
    const file = bugFile(root, F2);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("| **Status** | Fix Proposed (awaiting human decision) |", "| **Status** | Approved |"));
    const r = await sync(store, extractAll(bugOnly(), { repoRoot: root }).candidates, { repoRoot: root });
    assert.deepEqual(r.changed, ["mem-x-bug-002"]);
    const rec = (await store.all()).find(x => x.id === "mem-x-bug-002");
    assert.deepEqual([rec.status, rec.bug_state], ["proposed", "Approved"]);
  });

  it("a new bug-005 file is picked up and added", async () => {
    const { root, store } = await setup();
    const text = fs.readFileSync(bugFile(root, F2), "utf8").replace(/BUG-002/g, "BUG-005")
      .replace("A booking whose end time is earlier", "A copied booking whose end time is earlier");
    fs.writeFileSync(bugFile(root, "bug-005-new-one.md"), text);
    const r = await sync(store, extractAll(bugOnly(), { repoRoot: root }).candidates, { repoRoot: root });
    assert.deepEqual(r.added, ["mem-x-bug-005"]);
    assert.deepEqual([r.changed, r.removed, r.discarded], [[], [], []]);
    assert.equal((await store.all()).find(x => x.id === "mem-x-bug-005").source_path, "pipeline/bugs/bug-005-new-one.md#1-summary");
  });

  it("a removed bug file: its record is kept, superseded with the stale reason, and hidden by default", async () => {
    const { root, store } = await setup();
    fs.rmSync(bugFile(root, F2));
    const { candidates } = extractAll(bugOnly(), { repoRoot: root });
    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.removed, ["mem-x-bug-002"]);
    const rec = (await store.all()).find(x => x.id === "mem-x-bug-002");
    assert.ok(rec, "record was deleted");
    assert.deepEqual([rec.status, rec.stale_reason], ["superseded", STALE_REASON]);
    const q = { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: "job end time before start time accepted" };
    assert.ok(!ids(await retrieve(store, q)).includes("mem-x-bug-002"), "stale bug still returned by default");
    assert.ok(ids(await retrieve(store, { ...q, includeHistory: true })).includes("mem-x-bug-002"), "history does not show it");
  });

  it("a renamed bug file: the old source_path is gone, so the record is rewritten (same id) and not marked stale", async () => {
    const { root, store } = await setup();
    fs.renameSync(bugFile(root, F2), bugFile(root, "bug-002-renamed.md"));
    const r = await sync(store, extractAll(bugOnly(), { repoRoot: root }).candidates, { repoRoot: root });
    assert.deepEqual([r.changed, r.removed, r.discarded], [["mem-x-bug-002"], [], []]);
    assert.equal((await store.all()).find(x => x.id === "mem-x-bug-002").source_path, "pipeline/bugs/bug-002-renamed.md#1-summary");
  });

  it("a bug file with no usable summary is skipped with a reason, never guessed", () => {
    const root = bugRepo();
    fs.writeFileSync(bugFile(root, "bug-009-empty.md"),
      "# BUG-009 - Something\r\n\r\n| Field | Value |\r\n|---|---|\r\n| **Status** | New |\r\n\r\n## 1. Summary\r\n- only a list\r\n\r\n## 2. Other\r\nText.\r\n");
    fs.writeFileSync(bugFile(root, "bug-010-other-layout.md"),
      "# BUG-010 - Unknown layout\r\n\r\n| Field | Value |\r\n|---|---|\r\n| **Status** | New |\r\n\r\n## Notes\r\nA paragraph that is long enough but under no known heading.\r\n");
    const r = extractAll(bugOnly(), { repoRoot: root });
    assert.ok(!r.candidates.some(c => c.id === "mem-x-bug-009" || c.id === "mem-x-bug-010"));
    for (const f of ["bug-009-empty.md", "bug-010-other-layout.md"]) {
      const s = r.skipped.find(x => x.source === `${BUG_DIR}/${f}`);
      assert.ok(s, `${f} not reported as skipped`);
      assert.match(s.reason, /no usable summary/);
    }
    assert.equal(r.candidates.length, 4);
  });

  it("a summary too long to fit with its root cause and state is skipped with a reason", () => {
    const root = bugRepo();
    const long = "This sentence is long enough to be a real part of the summary text. ".repeat(3);
    const cause = "x".repeat(560);
    fs.writeFileSync(bugFile(root, "bug-011-long.md"),
      `# BUG-011 - Long\n\n| Field | Value |\n|---|---|\n| **Status** | New |\n\n## 1. Summary\n${long}\n\n## 4. Root cause analysis\n- **Root cause:** ${cause}\n`);
    const r = extractAll(bugOnly(), { repoRoot: root });
    assert.ok(!r.candidates.some(c => c.id === "mem-x-bug-011"));
    assert.match(r.skipped.find(x => /bug-011/.test(x.source)).reason, /does not fit/);
  });

  it("a long summary paragraph is cut at a sentence; the root cause and the state stay whole", () => {
    const root = bugRepo();
    const long = "This sentence is long enough to be a real part of the summary text. ".repeat(12).trim();
    fs.writeFileSync(bugFile(root, "bug-012-long.md"),
      `# BUG-012 - Long\n\n| Field | Value |\n|---|---|\n| **Status** | New |\n| **Reported by / date** | x - 2026-11-12 |\n\n## 1. Summary\n${long}\n\n## 4. Root cause analysis\n- **Root cause:** the whole cause text stays.\n`);
    const c = extractAll(bugOnly(), { repoRoot: root }).candidates.find(x => x.id === "mem-x-bug-012");
    assert.ok(c.summary.length <= 550);
    assert.ok(c.summary.endsWith("text. Root cause: the whole cause text stays. State: New."), c.summary);
  });

  it("the Reported date wins over an earlier date elsewhere in the file", () => {
    const root = bugRepo();
    fs.writeFileSync(bugFile(root, "bug-014-dated.md"),
      "# BUG-014 - Dated\n\n| Field | Value |\n|---|---|\n| **Status** | New |\n| **Reported by / date** | Bug agent - 2026-11-14 |\n\n" +
      "## 1. Summary\nA paragraph that is long enough to be a summary, about a job from 2026-11-10.\n");
    const c = extractAll(bugOnly(), { repoRoot: root }).candidates.find(x => x.id === "mem-x-bug-014");
    assert.equal(c.timestamp, "2026-11-14");
  });

  it("no date anywhere: defaultDate with a note", () => {
    const root = bugRepo();
    fs.writeFileSync(bugFile(root, "bug-013-undated.md"),
      "# BUG-013 - Undated\n\n| Field | Value |\n|---|---|\n| **Status** | New |\n| **Reported by / date** | Bug agent |\n\n## 1. Summary\nA paragraph that is long enough to be a summary.\n");
    const c = extractAll(bugOnly(), { repoRoot: root }).candidates.find(x => x.id === "mem-x-bug-013");
    assert.equal(c.timestamp, bugEntry.defaultDate);
    assert.match(c.note, /^date assumed/);
    assert.equal(c.feature, "all");
    assert.equal(c.importance, 1);   // open (New), so proposed
  });

  it("a config change (defaultDate) changes every bug hash, and sync reports them as changed", async () => {
    const { root, store, first } = await setup();
    const second = extractAll(bugOnly({ ...bugEntry, defaultDate: "2026-11-13" }), { repoRoot: root });
    for (const c of second.candidates) assert.notEqual(c.source_hash, first.candidates.find(x => x.id === c.id).source_hash, c.id);
    const r = await sync(store, second.candidates, { repoRoot: root });
    assert.equal(r.changed.length, 4);
  });

  it("an unchanged repo syncs to no change", async () => {
    const { root, store } = await setup();
    const r = await sync(store, extractAll(bugOnly(), { repoRoot: root }).candidates, { repoRoot: root });
    assert.deepEqual([r.added, r.changed, r.removed], [[], [], []]);
    assert.equal(r.unchanged, 4);
  });

  it("files that are not bug-N-*.md are ignored", () => {
    const root = bugRepo();
    const extra = fs.readFileSync(bugFile(root, F2), "utf8");
    for (const f of ["notes.md", "bug-abc-x.md", "BUG-006-upper.md", "bug-007-x.txt", "old-bug-008-x.md"]) fs.writeFileSync(bugFile(root, f), extra);
    const r = extractAll(bugOnly(), { repoRoot: root });
    assert.deepEqual(r.candidates.map(c => c.id), ["mem-x-bug-001", "mem-x-bug-002", "mem-x-bug-003", "mem-x-bug-004"]);
    assert.deepEqual(r.skipped, []);
  });
});

// Retrieval on a store holding extracted records only (the replay premise: as of 2026-11-12, features [1, "all"]).
const NEEDED = ["mem-x-f1-buffered-interval-detection", "mem-x-f1-standard-travel-buffer-per-job-is-45-minutes", "mem-x-rule-booking-conflicts"];
const BUG_QUERY = "what went wrong before with the booking overlap check";

function retrievalChecks(label, makeStore) {
  describe(`bug records in retrieval: ${label}, extracted records only`, () => {
    let store, cleanup;
    before(async () => {
      ({ store, cleanup } = await makeStore());
      const { candidates } = extractAll(config, { repoRoot: REPO_ROOT });
      const res = await ingest(store, candidates, { repoRoot: REPO_ROOT });
      assert.deepEqual(res.discarded, []);
    });
    after(async () => { if (cleanup) await cleanup(); });
    const replay = text => ({ namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text });

    it("the booking-overlap history question returns BUG-001", async () => {
      const r = await retrieve(store, replay(BUG_QUERY));
      assert.ok(ids(r).includes("mem-x-bug-001"), `got ${ids(r)}`);
      assert.ok(r.tokens <= BUDGET_TOKENS);
    });

    it("the Feature 2 task still returns the three needed facts within the budget", async () => {
      const r = await retrieve(store, replay(TASK_QUERY));
      for (const id of NEEDED) assert.ok(ids(r).includes(id), `${id} missing; got ${ids(r)}`);
      assert.ok(r.tokens <= BUDGET_TOKENS);
    });
  });
}

retrievalChecks("json", async () => ({ store: freshStore() }));

const unique = () => `memtest_bug_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let chromaUp = true;
try { await new ChromaStore({ collection: "probe" }).heartbeat(); } catch { chromaUp = false; }
if (chromaUp) retrievalChecks("chroma", async () => { const store = new ChromaStore({ collection: unique() }); return { store, cleanup: () => store.drop() }; });
else describe("bug records in retrieval: chroma", () => { it("SKIPPED: Chroma server not reachable on localhost:8000", { skip: true }, () => {}); });

let qdrantUp = true;
try { await new QdrantStore({ collection: "probe" }).heartbeat(); } catch { qdrantUp = false; }
if (qdrantUp) retrievalChecks("qdrant", async () => { const store = new QdrantStore({ collection: unique() }); return { store, cleanup: () => store.drop() }; });
else describe("bug records in retrieval: qdrant", () => { it("SKIPPED: Qdrant server not reachable on localhost:6333", { skip: true }, () => {}); });
