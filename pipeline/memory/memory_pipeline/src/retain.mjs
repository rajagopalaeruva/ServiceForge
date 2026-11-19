// Write path: the Retain/Discard filter (memory-architecture.md, section 6).
import { validateRecord, normalise, checkSource } from "./record.mjs";

const NOISE = [
  /^\s*\[(INFO|WARNING|WARN|ERROR|DEBUG)\]/i,         // Maven / log lines
  /^\s*BUILD (SUCCESS|FAILURE)/i,
  /^\s*Tests run:/i,
  /^\s*at [\w.$<>]+\(.*\)\s*$/,                        // stack frame
  /^\s*(npm|yarn) (WARN|ERR)/i,
  /^\s*\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,              // timestamped log line
  /^\s*(stdout|stderr)\s*:/i,
  /^\s*(PS [A-Z]:\\|\$ |> )/,                          // shell prompt echo
];
const CHATTER = /^\s*(ok(ay)?|sure|thanks|thank you|done|great|got it|let me|i will|i'll|working on|now i)\b/i;
const SECRET = [
  /(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
];
const MIN_CHARS = 25;
const MAX_CHARS = 600;

const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Decides whether one candidate is kept.
 * existing: array of records already stored (for duplicate detection).
 * Returns { retain: boolean, reasons: string[] }.
 */
export function evaluate(candidate, { existing = [], repoRoot }) {
  const reasons = [];
  reasons.push(...validateRecord(candidate));
  if (reasons.length) return { retain: false, reasons };

  const text = candidate.summary;
  if (NOISE.some(rx => rx.test(text))) reasons.push("looks like raw output or a log line");
  if (CHATTER.test(text)) reasons.push("chatter");
  if (SECRET.some(rx => rx.test(text))) reasons.push("looks like a secret");
  if (text.length < MIN_CHARS) reasons.push(`summary under ${MIN_CHARS} characters`);
  if (text.length > MAX_CHARS) reasons.push(`summary over ${MAX_CHARS} characters (write a summary, not a copy)`);

  const srcProblem = checkSource(candidate.source_path, repoRoot);
  if (srcProblem) reasons.push(srcProblem);

  const dup = existing.find(r =>
    r.namespace === candidate.namespace && r.id !== candidate.id && norm(r.summary) === norm(text));
  if (dup) reasons.push(`duplicate of ${dup.id}`);

  return { retain: reasons.length === 0, reasons };
}

/**
 * Runs candidates through the filter and writes the kept ones.
 * Re-running with the same candidates is safe: ids are upserted.
 */
export async function ingest(store, candidates, { repoRoot }) {
  const written = [];
  const discarded = [];
  for (const c of candidates) {
    const existing = await store.all();
    const verdict = evaluate(c, { existing, repoRoot });
    if (!verdict.retain) { discarded.push({ id: c?.id ?? "(no id)", reasons: verdict.reasons }); continue; }
    await store.write(normalise(c));
    written.push(c.id);
  }
  return { written, discarded };
}
