import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { extractAll, shorten, stripMd, saysSuperseded, earliestDate, EXTRACTOR_VERSION } from "../src/extract.mjs";
import { sync, plan, STALE_REASON, hasDrift } from "../src/sync.mjs";
import { ingest } from "../src/retain.mjs";
import { retrieve } from "../src/core.mjs";
import { JsonStore } from "../src/stores/json-store.mjs";
import { REPO_ROOT, EXTRACT_SOURCES_FILE, REPLAY_AS_OF, REPLAY_NAMESPACE, REPLAY_FEATURES, BUDGET_TOKENS } from "../src/config.mjs";
import { TASK_QUERY } from "./contract.mjs";

const config = JSON.parse(fs.readFileSync(EXTRACT_SOURCES_FILE, "utf8"));
// Every temporary folder is removed when the file's tests are done (finding F-17).
const made = [];
const tmpDir = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
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

  it("importance: current decisions are 3 (every feature), superseded 1; ADR and rule records are unchanged", () => {
    const decisions = result.candidates.filter(c => c.id.startsWith("mem-x-f") && c.type_tag === "decision");
    assert.ok(decisions.length > 0);
    for (const c of decisions) assert.equal(c.importance, c.status === "current" ? 3 : 1, c.id);
    assert.ok(decisions.some(c => c.feature !== 1 && c.status === "current"), "expected a current decision outside Feature 1");
    assert.equal(get("mem-x-rule-booking-conflicts").importance, 3);
    for (const c of result.candidates.filter(c => /^mem-x-adr-/.test(c.id))) assert.equal(c.importance, 2, c.id);
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
    const files = [...new Set(config.sources.filter(s => s.path).map(s => s.path))].map(p => path.join(REPO_ROOT, p));
    const listed = dir => fs.readdirSync(path.join(REPO_ROOT, dir)).map(f => path.join(REPO_ROOT, dir, f));
    const watched = [...files, ...listed("pipeline/decisions/adr"), ...listed("pipeline/bugs")];
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

  it("a deleted section: its record is kept but marked superseded, hidden by default, visible with history, and a second sync changes nothing", async () => {
    const { root, file, store } = await setup();
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    // Remove the CURRENT "buffered interval" decision, so the record really changes status.
    const start = text.indexOf("## Decision: buffered interval detection");
    const next = text.indexOf("\n## ", start + 5);
    assert.ok(start > 0, "test setup: section not found");
    fs.writeFileSync(file, text.slice(0, start) + (next === -1 ? "" : text.slice(next + 1)));
    const { candidates } = extractAll(cfg, { repoRoot: root });
    assert.ok(!candidates.some(c => c.id === bufferedId));

    const dry = await sync(store, candidates, { repoRoot: root, dryRun: true });
    assert.deepEqual(dry.removed, [bufferedId]);
    assert.equal((await store.all()).find(x => x.id === bufferedId).status, "current", "a dry run must not write");

    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.removed, [bufferedId]);
    const rec = (await store.all()).find(x => x.id === bufferedId);
    assert.ok(rec, "record was deleted");
    assert.equal(rec.status, "superseded");
    assert.equal(rec.stale_reason, "source section no longer found");
    assert.equal(rec.stale_reason, STALE_REASON);

    const q = { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: "buffered interval booking overlap 45 minutes" };
    assert.ok(!ids(await retrieve(store, q)).includes(bufferedId), "a stale record is still returned by default");
    assert.ok(ids(await retrieve(store, { ...q, includeHistory: true })).includes(bufferedId), "history does not show it");

    const again = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual([again.added, again.changed, again.removed, again.written], [[], [], [], []]);
    assert.equal(hasDrift(again), false);
    assert.equal(hasDrift(await sync(store, candidates, { repoRoot: root, dryRun: true })), false);
  });

  it("a section that was already superseded and then deleted is kept and gets the stale reason", async () => {
    const { root, file, store } = await setup();
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const start = text.indexOf("## Decision: overlap detection compares exact start times");
    const end = text.indexOf("## Decision: buffered interval detection");
    fs.writeFileSync(file, text.slice(0, start) + text.slice(end));
    const { candidates } = extractAll(cfg, { repoRoot: root });
    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.removed, [exactId]);
    const rec = (await store.all()).find(x => x.id === exactId);
    assert.ok(rec, "record was deleted");
    assert.deepEqual([rec.status, rec.stale_reason], ["superseded", STALE_REASON]);
  });

  it("a renamed heading: the old record is superseded and the new one is stored, not discarded as a duplicate", async () => {
    const { root, file, store } = await setup();
    const original = fs.readFileSync(file, "utf8");
    const renamed = original.replace("## Decision: buffered interval detection", "## Decision: buffered interval overlap detection");
    assert.notEqual(renamed, original, "test setup: heading not found");
    fs.writeFileSync(file, renamed);
    const newId = "mem-x-f1-buffered-interval-overlap-detection";
    const { candidates } = extractAll(cfg, { repoRoot: root });
    assert.ok(candidates.some(c => c.id === newId), "test setup: renamed section not extracted");

    const r = await sync(store, candidates, { repoRoot: root });
    assert.deepEqual(r.added, [newId]);
    assert.deepEqual(r.removed, [bufferedId]);
    assert.deepEqual(r.discarded, [], "the renamed record was discarded as a duplicate");
    const all = await store.all();
    assert.equal(all.find(x => x.id === bufferedId).status, "superseded");
    assert.equal(all.find(x => x.id === newId).status, "current");

    const q = { namespace: REPLAY_NAMESPACE, asOf: REPLAY_AS_OF, features: REPLAY_FEATURES, text: "buffered interval booking overlap 45 minutes" };
    const got = ids(await retrieve(store, q));
    assert.ok(got.includes(newId) && !got.includes(bufferedId), `got ${got}`);
    const again = await sync(store, candidates, { repoRoot: root });
    assert.equal(hasDrift(again), false);
  });

  it("a stale record whose section comes back is restored", async () => {
    const { root, file, store } = await setup();
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace("## Decision: buffered interval detection", "## Decision: something else entirely for now"));
    await sync(store, extractAll(cfg, { repoRoot: root }).candidates, { repoRoot: root });
    assert.equal((await store.all()).find(x => x.id === bufferedId).status, "superseded");
    fs.writeFileSync(file, original);
    const back = extractAll(cfg, { repoRoot: root }).candidates;
    const r = await sync(store, back, { repoRoot: root });
    assert.deepEqual(r.changed, [bufferedId]);
    const rec = (await store.all()).find(x => x.id === bufferedId);
    assert.equal(rec.status, "current");
    assert.equal(rec.stale_reason, undefined);
    assert.equal(hasDrift(await sync(store, back, { repoRoot: root })), false);
  });

  it("a same-id record in another namespace is neither compared with nor marked stale (F-4)", async () => {
    const { root, store } = await setup();
    const other = { ...(await store.all()).find(x => x.id === bufferedId), namespace: "other:main:dev" };
    await store.write(other);
    const { candidates } = extractAll(cfg, { repoRoot: root });
    const r = await sync(store, candidates, { repoRoot: root });
    assert.equal(hasDrift(r), false);
    assert.equal((await store.all()).filter(x => x.id === bufferedId).length, 2);
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

describe("extractor: status and date reading (F-3)", () => {
  it("saysSuperseded ignores a negated mention and still finds a real one", () => {
    for (const no of [
      "This rule is not superseded by anything", "never superseded", "It is no longer superseded", "it isn't superseded",
      "it isn’t superseded", "Decision: example not superseded",
    ]) assert.equal(saysSuperseded(no), false, no);
    for (const yes of [
      "**Lifecycle:** superseded by the buffered check", "Historical approach (superseded): the old way", "superseded",
      "This was not planned, but the rule was later superseded by ADR-004",
    ]) assert.equal(saysSuperseded(yes), true, yes);
    assert.equal(saysSuperseded("not superseded at first, then superseded by X"), true);
    assert.equal(saysSuperseded("a notation that is Superseded"), true);
  });

  it("earliestDate takes the earliest real date and skips impossible ones", () => {
    assert.equal(earliestDate("verified on 2026-11-11, review 2027-01-01, first seen 2026-10-02"), "2026-10-02");
    assert.equal(earliestDate("bad 2026-13-45 and good 2026-12-01"), "2026-12-01");
    assert.equal(earliestDate("only 2026-02-30 here"), null);
    assert.equal(earliestDate("no dates"), null);
  });

  const rel = "pipeline/decisions/feature-1-decisions.md";
  const one = body => {
    const root = tmpDir("memtest-repo-");
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `# Log\n\n${body}\n`);
    const r = extractAll({ namespace: REPLAY_NAMESPACE, sources: [{ kind: "decision-log", path: rel, feature: 1, defaultDate: "2026-11-11" }] }, { repoRoot: root });
    return r.candidates;
  };

  it("a section that says 'not superseded' stays current", () => {
    const [c] = one("## Decision: example not superseded\n\nThis rule is not superseded by anything and stays in force for every job.\n");
    assert.equal(c.status, "current");
    assert.equal(c.importance, 3);
  });

  it("a section that really is superseded is superseded", () => {
    const [c] = one("## Decision: old way\n\nThe old check compared start times only.\n\n**Lifecycle:** superseded by the interval check.\n");
    assert.equal(c.status, "superseded");
  });

  it("the record date is the earliest date in the section, not the first or a later review date", () => {
    const [c] = one("## Decision: dated\n\nVerified on 2026-11-11 and reviewed again 2026-11-14, next review 2027-01-01 for this rule.\n\nFirst seen 2026-11-05.\n");
    assert.equal(c.timestamp, "2026-11-05");
    assert.equal(c.note, undefined);
  });
});

describe("extractor: source_hash covers the source entry settings and the extractor version (F-9)", () => {
  const rel = "pipeline/decisions/feature-1-decisions.md";
  const root = () => {
    const r = tmpDir("memtest-repo-");
    copyInto(r, rel);
    return r;
  };
  const entry = { kind: "decision-log", path: rel, feature: 1, defaultDate: "2026-11-11" };
  const hashes = (e, ns = REPLAY_NAMESPACE, r) => Object.fromEntries(extractAll({ namespace: ns, sources: [e] }, { repoRoot: r }).candidates.map(c => [c.id, c.source_hash]));

  it("changing defaultDate, feature or namespace changes every hash of that source", () => {
    const r = root();
    const base = hashes(entry, REPLAY_NAMESPACE, r);
    for (const other of [hashes({ ...entry, defaultDate: "2026-11-12" }, REPLAY_NAMESPACE, r), hashes({ ...entry, feature: 2 }, REPLAY_NAMESPACE, r), hashes(entry, "other:main:dev", r)]) {
      const ids = Object.keys(base);
      assert.ok(ids.length >= 3);
      // a changed feature also changes the id prefix, so compare by position
      assert.deepEqual(Object.values(other).filter((h, i) => h === Object.values(base)[i]), []);
    }
  });

  it("the same settings give the same hashes, and the version constant exists and is above 1", () => {
    const r = root();
    assert.deepEqual(hashes(entry, REPLAY_NAMESPACE, r), hashes({ ...entry }, REPLAY_NAMESPACE, r));
    assert.ok(Number.isInteger(EXTRACTOR_VERSION) && EXTRACTOR_VERSION >= 2);
  });

  it("sync reports a changed defaultDate as changed and rewrites the assumed date", async () => {
    const r = root();
    const store = freshStore();
    const first = extractAll({ namespace: REPLAY_NAMESPACE, sources: [entry] }, { repoRoot: r });
    await sync(store, first.candidates, { repoRoot: r });
    const undated = first.candidates.find(c => c.note);
    assert.ok(undated, "test setup: no undated section");
    const second = extractAll({ namespace: REPLAY_NAMESPACE, sources: [{ ...entry, defaultDate: "2026-11-15" }] }, { repoRoot: r });
    const res = await sync(store, second.candidates, { repoRoot: r });
    assert.ok(res.changed.includes(undated.id), `changed: ${res.changed}`);
    assert.equal((await store.all()).find(x => x.id === undated.id).timestamp, "2026-11-15");
  });
});

describe("extractor: ADR status must agree between the index and the ADR file (F-9)", () => {
  const dir = "pipeline/decisions/adr";
  function adrRepo(indexStatus, fileStatus) {
    const root = tmpDir("memtest-repo-");
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "_index.md"),
      `# Index\n\n| ADR | Title | Decision | Status | Feature | Drivers |\n|---|---|---|---|---|---|\n` +
      `| [ADR-009](ADR-009-x.md) | Use one lock | One lock around stock changes. | ${indexStatus} | 2 | FR-1 |\n`);
    fs.writeFileSync(path.join(root, dir, "ADR-009-x.md"), `---\nstatus: ${fileStatus}\ndate: 2026-11-17\nfeature: 2\n---\n\n# ADR-009: Use one lock\n`);
    return root;
  }
  const src = { kind: "adr-index", path: `${dir}/_index.md`, defaultDate: "2026-11-17" };
  const run = root => extractAll({ namespace: REPLAY_NAMESPACE, sources: [src] }, { repoRoot: root });

  it("agreeing statuses give a record", () => {
    const r = run(adrRepo("accepted", "accepted"));
    assert.deepEqual(r.candidates.map(c => [c.id, c.status]), [["mem-x-adr-009", "current"]]);
    assert.deepEqual(r.skipped, []);
  });

  it("disagreeing statuses skip the record with a clear reason", () => {
    for (const [index, file] of [["accepted", "proposed"], ["accepted", "superseded"], ["proposed", "accepted"]]) {
      const r = run(adrRepo(index, file));
      assert.deepEqual(r.candidates, [], `${index} vs ${file}`);
      assert.equal(r.skipped.length, 1);
      assert.match(r.skipped[0].reason, /status disagrees: index says "\w+", ADR file says "\w+"; not guessing/);
    }
  });
});