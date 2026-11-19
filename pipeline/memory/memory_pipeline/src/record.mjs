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
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

/** 'YYYY-MM-DD' -> 20261111 (a number, so range filters work in every store). Impossible dates are rejected. */
export function tsOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) throw new Error(`bad date (want YYYY-MM-DD): ${date}`);
  // Round trip through Date.UTC, so 2026-13-45 and 2026-02-30 are refused instead of read as "everything".
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(`bad date (no such day): ${date}`);
  return Number(m[1] + m[2] + m[3]);
}

/** The reason a source_path is not an acceptable repo-relative path, or "" when its form is fine. checkSource looks at the disk. */
export function sourcePathProblem(sp) {
  if (typeof sp !== "string") return "source_path must be a string";
  const parts = sp.split("#");
  if (parts.length > 2) return `source_path has more than one '#': ${sp}`;
  const [file, anchor] = parts;
  if (parts.length === 2 && !anchor) return `source_path has an empty anchor: ${sp}`;
  if (!file) return "source_path has no file";
  if (file.includes("\\")) return `source_path must use forward slashes: ${sp}`;
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file)) return `source_path must be relative to the repo: ${sp}`;
  if (file.split("/").includes("..")) return `source_path must not contain '..': ${sp}`;
  if (file === ".git" || file.startsWith(".git/")) return `source_path must not point into .git: ${sp}`;
  if (file.includes("node_modules/")) return `source_path must not point into node_modules: ${sp}`;
  return "";
}

/** Returns a list of problems. Empty list means the record is valid. */
export function validateRecord(r) {
  const problems = [];
  if (!r || typeof r !== "object") return ["record is not an object"];
  for (const f of REQUIRED) {
    if (r[f] === undefined || r[f] === null || r[f] === "") problems.push(`missing ${f}`);
  }
  if (r.id !== undefined && r.id !== null && r.id !== "" && (typeof r.id !== "string" || !ID_PATTERN.test(r.id) || r.id.includes(".."))) {
    problems.push(`bad id (letters, digits and . _ : - only, at most 100, no '..'): ${r.id}`);
  }
  if (r.summary !== undefined && r.summary !== null && r.summary !== "" && typeof r.summary !== "string") problems.push("summary must be a string");
  if (r.source_path !== undefined && r.source_path !== null && r.source_path !== "") {
    const sp = sourcePathProblem(r.source_path);
    if (sp) problems.push(sp);
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

/** The store key: a record id is unique within a namespace, not across namespaces (finding F-4). */
export const keyOf = r => `${r.namespace}|${r.id}`;

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
  const root = path.resolve(repoRoot);
  const full = path.resolve(root, file);
  const rel = path.relative(root, full);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return `source_path leaves the repo: ${sourcePath}`;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `source file not found: ${file}`;
  if (anchor) {
    const heads = fs.readFileSync(full, "utf8").split(/\r?\n/)
      .filter(l => /^#{1,6}\s/.test(l)).map(l => slug(l.replace(/^#{1,6}\s+/, "")));
    if (!heads.includes(anchor)) return `anchor not found in ${file}: #${anchor}`;
  }
  return "";
}
