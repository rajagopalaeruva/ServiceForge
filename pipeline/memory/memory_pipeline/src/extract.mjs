// Write path, step 1: turn repo documents into candidate records (memory-architecture.md, section 6).
// Deterministic and read-only: it never edits a source file, and it never calls a model.
// Candidates then go through the Retain/Discard filter in retain.mjs, exactly like the hand-written seed.
//
// Covers four well-structured source kinds (see data/extract-sources.json):
//   decision-log  "## Decision: ..." sections of pipeline/decisions/feature-N-decisions.md
//   adr-index     the table in pipeline/decisions/adr/_index.md, plus each ADR's front matter
//   rule          the "## Required invariant" section of pipeline/rules/*.md
//   bug-dir       one episode record per pipeline/bugs/bug-N-*.md (the template layout, and the older BUG-001 layout)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { slug, tsOf } from "./record.mjs";
import { terms } from "./text.mjs";

// Bump when the extraction rules change. It is part of every source_hash, so the next sync re-checks every record.
export const EXTRACTOR_VERSION = 4;

const MAX_SUMMARY = 550;           // retain.mjs rejects summaries over 600
const DATES = /\b(\d{4}-\d{2}-\d{2})\b/g;
const NEGATION = /\b(not|never|no longer)\b|n['’]t\b/i;

const hash = s => crypto.createHash("sha1").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const read = (repoRoot, rel) => fs.readFileSync(path.resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

/** Source entry settings that change what a record holds. They go into source_hash with the extractor version (finding F-9). */
const configKey = (src, ctx) =>
  `v${EXTRACTOR_VERSION}|feature=${src.feature ?? ""}|defaultDate=${src.defaultDate ?? ""}|dir=${src.dir ?? ""}|namespace=${ctx.namespace}`;

/** The earliest real calendar date in the text, or null. Impossible dates such as 2026-13-45 are ignored. */
export function earliestDate(text) {
  const found = [];
  for (const m of text.matchAll(DATES)) {
    try { tsOf(m[1]); found.push(m[1]); } catch { /* not a real date */ }
  }
  return found.length ? found.sort()[0] : null;
}

/** True when the text says "superseded" at least once without a negation just before it ("not superseded", "no longer superseded"). */
export function saysSuperseded(text) {
  for (const m of text.matchAll(/\bsuperseded\b/gi)) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

export function stripMd(s) {
  return s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/** Splits a markdown file into its "## " sections. Text before the first one is ignored. */
export function splitSections(text) {
  const sections = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) { cur = { heading: line.slice(3).trim(), lines: [] }; sections.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return sections.map(s => ({ heading: s.heading, body: s.lines.join("\n").trim() }));
}

/** First paragraph that is prose (not a table, list, heading or code fence). */
function firstProse(body) {
  return body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(\||[-*] |\d+\. |```|#)/.test(p)) ?? null;
}

/** Cuts at the last full sentence within the limit. Returns null if no sentence boundary leaves a usable summary. */
export function shorten(s, max = MAX_SUMMARY) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end >= 60 ? cut.slice(0, end + 1) : null;
}

/** Slug of at most 60 characters, cut at a word boundary so ids never end mid-word. */
function shortSlug(title, max = 60) {
  const s = slug(title);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf("-");
  return at > 20 ? cut.slice(0, at) : cut;
}

function base(ctx, src) {
  return { namespace: ctx.namespace, supersedes: null, origin: "extract" };
}

function fromDecisionLog(src, ctx) {
  const out = [], skipped = [];
  for (const { heading, body } of splitSections(read(ctx.repoRoot, src.path))) {
    const where = `${src.path}#${slug(heading)}`;
    if (!/^Decision:/i.test(heading)) { skipped.push({ source: where, reason: "not a 'Decision:' section" }); continue; }
    const first = firstProse(body);
    const summary = first ? shorten(stripMd(first).replace(/^What was decided:\s*/i, "")) : null;
    if (!summary || summary.length < 25) { skipped.push({ source: where, reason: "no usable first paragraph" }); continue; }

    const lifecycle = body.split("\n").filter(l => /^\*\*Lifecycle/i.test(l.trim())).join(" ");
    const superseded = saysSuperseded(`${heading} ${first} ${lifecycle}`);
    const dated = earliestDate(body);
    const task = /\b(BUG-\d+|ADR-\d+)\b/.exec(`${heading} ${first}`) ?? /\b(BUG-\d+|ADR-\d+)\b/.exec(body);
    const title = heading.replace(/^Decision:\s*/i, "");

    out.push({
      ...base(ctx, src),
      id: `mem-x-f${src.feature}-${shortSlug(title)}`,
      feature: src.feature, type_tag: "decision", status: superseded ? "superseded" : "current",
      source_task: task ? task[1] : `Feature ${src.feature}`,
      source_path: where,
      timestamp: dated ?? src.defaultDate,
      importance: superseded ? 1 : 3,
      summary,
      keywords: [...terms(stripMd(title))],
      source_hash: hash(`${configKey(src, ctx)}\n${heading}\n${body}`),
      ...(dated ? {} : { note: `date assumed (${src.dateNote ?? "source gives none"}): ${src.defaultDate}` }),
    });
  }
  return { out, skipped };
}

/** ADR status word -> record status. null means the status is not one we retain (for example rejected). */
const statusOf = raw => /^accepted/i.test(raw) ? "current"
  : /^proposed/i.test(raw) ? "proposed"
  : /^(superseded|deprecated)/i.test(raw) ? "superseded" : null;

function fromAdrIndex(src, ctx) {
  const out = [], skipped = [];
  const dir = path.posix.dirname(src.path);
  for (const line of read(ctx.repoRoot, src.path).split("\n")) {
    const m = /^\|\s*\[(ADR-\d+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!m) continue;
    const [, adr, file, title, decision, statusRaw, featureRaw] = m;
    const rel = `${dir}/${file}`;
    if (!fs.existsSync(path.resolve(ctx.repoRoot, rel))) { skipped.push({ source: rel, reason: "ADR file not found" }); continue; }
    const status = statusOf(statusRaw);
    if (!status) { skipped.push({ source: rel, reason: `status "${statusRaw}" is not retained` }); continue; }

    const front = /^---\n([\s\S]*?)\n---/.exec(read(ctx.repoRoot, rel))?.[1] ?? "";
    // The index row and the ADR file must agree on the status. If they do not, the extractor does not guess.
    const frontStatusRaw = /^status:[ \t]*(\S[^\n]*)$/m.exec(front)?.[1]?.trim();
    if (frontStatusRaw && statusOf(frontStatusRaw) !== status) {
      skipped.push({ source: rel, reason: `status disagrees: index says "${statusRaw}", ADR file says "${frontStatusRaw}"; not guessing` });
      continue;
    }
    const date = /^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(front)?.[1];
    out.push({
      ...base(ctx, src),
      id: `mem-x-${adr.toLowerCase()}`,
      feature: /^all$/i.test(featureRaw) ? "all" : Number(featureRaw),
      type_tag: "decision", status, source_task: adr, source_path: rel,
      timestamp: date ?? src.defaultDate, importance: 2,
      summary: shorten(stripMd(`${title.replace(/\.$/, "")}. ${decision}`)),
      keywords: [...terms(stripMd(title))],
      source_hash: hash(`${configKey(src, ctx)}\n${line}\n${front}`),
      ...(date ? {} : { note: `date assumed: ${src.defaultDate}` }),
    });
  }
  return { out, skipped };
}

function fromRule(src, ctx) {
  const text = read(ctx.repoRoot, src.path);
  const title = /^# (.+)$/m.exec(text)?.[1] ?? path.basename(src.path);
  const sec = splitSections(text).find(s => /^Required invariant/i.test(s.heading));
  const first = sec ? firstProse(sec.body) : null;
  const summary = first ? shorten(stripMd(first)) : null;
  if (!summary || summary.length < 25) return { out: [], skipped: [{ source: src.path, reason: "no 'Required invariant' paragraph" }] };
  return {
    out: [{
      ...base(ctx, src),
      id: `mem-x-rule-${path.basename(src.path, ".md")}`,
      feature: "all", type_tag: "fact", status: "current",
      source_task: /\bBUG-\d+\b/.exec(text)?.[0] ?? path.basename(src.path),
      source_path: `${src.path}#${slug(sec.heading)}`,
      timestamp: src.defaultDate, importance: 3,
      summary,
      keywords: [...terms(stripMd(title))],
      source_hash: hash(`${configKey(src, ctx)}\n${sec.heading}\n${sec.body}`),
      note: `date assumed (${src.dateNote ?? "source gives none"}): ${src.defaultDate}`,
    }],
    skipped: [],
  };
}

const BUG_FILE = /^bug-(\d+)-.*\.md$/;

/** Rows of the `| **Field** | Value |` table, by field name. */
function metaTable(text) {
  const meta = {};
  for (const line of text.split("\n")) {
    const m = /^\|\s*\*\*(.+?)\*\*\s*\|(.*)\|\s*$/.exec(line);
    if (m) meta[m[1].trim()] = m[2].replace(/\\\|/g, "|").trim();
  }
  return meta;
}

/** Template layout: "1. Summary" and the "- **Root cause:**" bullet of "4. Root cause analysis". */
function templateReader(sections) {
  const sum = sections.find(s => /^1\.\s*Summary\s*$/i.test(s.heading));
  if (!sum) return null;
  const rca = sections.find(s => /^4\.\s*Root cause/i.test(s.heading));
  const bullet = rca ? /^[-*]\s+\*\*Root cause:\*\*[ \t]*(\S.*)$/m.exec(rca.body)?.[1] : null;
  const cause = bullet && !bullet.startsWith("<") ? stripMd(bullet) : null;
  return { sum, cause: cause && { label: "Root cause", text: cause }, causeBody: rca?.body ?? "" };
}

/** Older BUG-001 layout: "Expected and actual behavior", then the start-time sentence from the evidence bullets, else the fix paragraph. */
function oldReader(sections) {
  const sum = sections.find(s => /^Expected and actual behavio(u)?r\s*$/i.test(s.heading));
  if (!sum) return null;
  const repro = sections.find(s => /^Reproduction and evidence/i.test(s.heading));
  const fix = sections.find(s => /^Root cause and implemented fix/i.test(s.heading));
  const line = (repro?.body ?? "").split("\n").find(l => /^[-*] /.test(l) && /start[- ]?time equality/i.test(l));
  let cause = null;
  if (line) cause = { label: "Root cause", text: stripMd(line.replace(/^[-*]\s+/, "")) };
  if (!cause && fix) {
    const p = firstProse(fix.body);
    if (p) cause = { label: "Fix", text: stripMd(p) };
  }
  return { sum, cause, causeBody: `${repro?.body ?? ""}\n${fix?.body ?? ""}`, old: true };
}

function fromBugDir(src, ctx) {
  const out = [], skipped = [];
  const dirFull = path.resolve(ctx.repoRoot, src.dir);
  if (!fs.existsSync(dirFull)) return { out, skipped: [{ source: src.dir, reason: "bug directory not found" }] };
  const files = fs.readdirSync(dirFull).filter(f => BUG_FILE.test(f)).sort();
  for (const file of files) {
    const rel = `${src.dir}/${file}`;
    const text = read(ctx.repoRoot, rel);
    const num = BUG_FILE.exec(file)[1];
    const titleM = /^# BUG-(\d+)\s*(?:[-\u2013\u2014]\s*)?(.*)$/m.exec(text);
    if (!titleM || Number(titleM[1]) !== Number(num) || !titleM[2].trim()) { skipped.push({ source: rel, reason: "no '# BUG-N - title' line that matches the file name" }); continue; }
    const title = titleM[2].trim();
    const meta = metaTable(text);
    const state = stripMd(meta.Status ?? "");
    if (!state) { skipped.push({ source: rel, reason: "no Status cell" }); continue; }
    const sections = splitSections(text);
    const rd = templateReader(sections) ?? oldReader(sections);
    const first = rd ? firstProse(rd.sum.body) : null;
    const lead = first ? stripMd(first) : "";
    if (!rd || lead.length < 25) { skipped.push({ source: rel, reason: "no usable summary" }); continue; }

    const tail = `${rd.cause ? ` ${rd.cause.label}: ${rd.cause.text}` : ""} State: ${state}.`;
    const room = MAX_SUMMARY - tail.length;
    const head = room >= 25 ? shorten(lead, room) : null;
    if (!head || head.length < 25) { skipped.push({ source: rel, reason: "summary does not fit in 550 characters without cutting the root cause or state" }); continue; }

    const reported = meta["Reported by / date"];
    const dated = reported !== undefined ? firstDate(reported) : earliestDate(text);
    const sev = /\bS([1-4])\b/.exec(meta["Severity / reason"] ?? "")?.[1];
    const status = /^(Verified|Closed)/i.test(state) ? "current" : "proposed";
    const feat = /Feature (\d+)/.exec(meta["Affected feature"] ?? "")?.[1];
    out.push({
      ...base(ctx, src),
      id: `mem-x-bug-${num}`,
      feature: feat ? Number(feat) : "all",
      type_tag: "episode",
      status,
      bug_state: state,
      source_task: `BUG-${num}`,
      source_path: `${rel}#${slug(rd.sum.heading)}`,
      timestamp: dated ?? src.defaultDate,
      importance: status === "proposed" ? 1 : sev === "1" || sev === "2" ? 3 : sev === "3" ? 2 : sev === "4" ? 1 : 2,
      summary: `${head}${tail}`,
      keywords: [...terms(stripMd(title))],
      source_hash: hash(`${configKey(src, ctx)}\n${rel}\n${title}\n${state}\n${meta["Severity / reason"] ?? ""}\n${reported ?? ""}\n${meta["Affected feature"] ?? ""}\n${rd.sum.body}\n${rd.causeBody}`),
      ...(dated ? {} : { note: `date assumed (${src.dateNote ?? "source gives none"}): ${src.defaultDate}` }),
    });
  }
  return { out, skipped };
}

/** The first real calendar date in the text, in reading order, or null. */
function firstDate(text) {
  for (const m of text.matchAll(DATES)) { try { tsOf(m[1]); return m[1]; } catch { /* not a real date */ } }
  return null;
}

const KINDS = { "decision-log": fromDecisionLog, "adr-index": fromAdrIndex, rule: fromRule, "bug-dir": fromBugDir };

/** config = { namespace, sources: [{ kind, path (or dir, for bug-dir), feature?, defaultDate, dateNote? }] } */
export function extractAll(config, { repoRoot }) {
  const ctx = { namespace: config.namespace, repoRoot };
  const candidates = [], skipped = [];
  for (const src of config.sources) {
    const fn = KINDS[src.kind];
    if (!fn) throw new Error(`unknown source kind: ${src.kind}`);
    const r = fn(src, ctx);
    candidates.push(...r.out);
    skipped.push(...r.skipped);
  }
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.id)) throw new Error(`extractor produced a duplicate id: ${c.id}`);
    seen.add(c.id);
  }
  return { candidates, skipped };
}
