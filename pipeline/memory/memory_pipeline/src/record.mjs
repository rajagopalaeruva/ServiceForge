// Record format and provenance checks (memory-architecture.md, section 6).
import fs from "node:fs";
import path from "node:path";

export const TYPE_TAGS = ["decision", "fact", "dependency", "episode"];
export const STATUSES = ["current", "superseded", "proposed"];
export const FEATURES = [1, 2, "all"];
export const REQUIRED = [
  "id", "namespace", "feature", "type_tag", "status",
  "source_task", "source_path", "timestamp", "importance", "summary",
];

/** 'YYYY-MM-DD' -> 20261111 (a number, so range filters work in every store). */
export function tsOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) throw new Error(`bad date (want YYYY-MM-DD): ${date}`);
  return Number(m[1] + m[2] + m[3]);
}

/** Returns a list of problems. Empty list means the record is valid. */
export function validateRecord(r) {
  const problems = [];
  if (!r || typeof r !== "object") return ["record is not an object"];
  for (const f of REQUIRED) {
    if (r[f] === undefined || r[f] === null || r[f] === "") problems.push(`missing ${f}`);
  }
  if (r.type_tag && !TYPE_TAGS.includes(r.type_tag)) problems.push(`bad type_tag: ${r.type_tag}`);
  if (r.status && !STATUSES.includes(r.status)) problems.push(`bad status: ${r.status}`);
  if (r.feature !== undefined && !FEATURES.includes(r.feature)) problems.push(`bad feature: ${r.feature}`);
  if (r.importance !== undefined && ![1, 2, 3].includes(r.importance)) problems.push("importance must be 1, 2 or 3");
  if (r.timestamp) {
    try { tsOf(r.timestamp); } catch (e) { problems.push(e.message); }
  }
  if (r.keywords !== undefined && !Array.isArray(r.keywords)) problems.push("keywords must be an array");
  return problems;
}

/** Adds the derived numeric ts and a default keywords array. */
export function normalise(r) {
  return { keywords: [], supersedes: null, ...r, ts: tsOf(r.timestamp) };
}

export function slug(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-");
}

/**
 * Checks that source_path points at a real file in the repo and, when it has
 * a #anchor, that the file has a heading with that slug.
 * Returns an empty string when fine, otherwise the reason.
 */
export function checkSource(sourcePath, repoRoot) {
  const [file, anchor] = String(sourcePath).split("#");
  const full = path.resolve(repoRoot, file);
  if (!full.startsWith(path.resolve(repoRoot))) return `source_path leaves the repo: ${sourcePath}`;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `source file not found: ${file}`;
  if (anchor) {
    const heads = fs.readFileSync(full, "utf8").split(/\r?\n/)
      .filter(l => /^#{1,6}\s/.test(l)).map(l => slug(l.replace(/^#{1,6}\s+/, "")));
    if (!heads.includes(anchor)) return `anchor not found in ${file}: #${anchor}`;
  }
  return "";
}
