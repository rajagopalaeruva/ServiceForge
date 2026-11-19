// Write path, step 1: turn repo documents into candidate records (memory-architecture.md, section 6).
// Deterministic and read-only: it never edits a source file, and it never calls a model.
// Candidates then go through the Retain/Discard filter in retain.mjs, exactly like the hand-written seed.
//
// Covers three well-structured source kinds (see data/extract-sources.json):
//   decision-log  "## Decision: ..." sections of pipeline/decisions/feature-N-decisions.md
//   adr-index     the table in pipeline/decisions/adr/_index.md, plus each ADR's front matter
//   rule          the "## Required invariant" section of pipeline/rules/*.md
// Not covered: bug records (their layout differs between BUG-001 and BUG-002 to 004).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { slug, tsOf } from "./record.mjs";
import { terms } from "./text.mjs";

// Bump when the extraction rules change. It is part of every source_hash, so the next sync re-checks every record.
export const EXTRACTOR_VERSION = 2;

const MAX_SUMMARY = 550;           // retain.mjs rejects summaries over 600
const DATES = /\b(\d{4}-\d{2}-\d{2})\b/g;
const NEGATION = /\b(not|never|no longer)\b|n['’]t\b/i;

const hash = s => crypto.createHash("sha1").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const read = (repoRoot, rel) => fs.readFileSync(path.resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

/** Source entry settings that change what a record holds. They go into source_hash with the extractor version (finding F-9). */
const configKey = (src, ctx) =>
  `v${EXTRACTOR_VERSION}|feature=${src.feature ?? ""}|defaultDate=${src.defaultDate ?? ""}|namespace=${ctx.namespace}`;

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
      importance: superseded ? 1 : 2,
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

const KINDS = { "decision-log": fromDecisionLog, "adr-index": fromAdrIndex, rule: fromRule };

/** config = { namespace, sources: [{ kind, path, feature?, defaultDate, dateNote? }] } */
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
