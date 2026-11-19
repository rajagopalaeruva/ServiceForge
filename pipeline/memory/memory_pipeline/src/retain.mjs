// Write path: the Retain/Discard filter (memory-architecture.md, section 6).
import { validateRecord, normalise, checkSource } from "./record.mjs";

// Checked against every line of the summary, not only the first.
const NOISE = [
  /^\s*\[(INFO|WARNING|WARN|ERROR|DEBUG)\]/i,         // Maven / log lines
  /^\s*(ERROR|WARN|WARNING|INFO|DEBUG)\s+[\w.$]+\s/,   // log level without brackets
  /^\s*BUILD (SUCCESS|FAILURE)/i,
  /^\s*Tests run:/i,
  /^\s*at [\w.$<>]+\(.*\)\s*$/,                        // stack frame
  /\b[\w.]+(Exception|Error):/,                        // Java exception line
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
  /\bAuthorization:\s*Bearer\b/i,
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/,   // e-mail address (personal data)
];
const HEDGE = /\b(i think|i guess|not sure|maybe|probably)\b/i;   // an unverified guess is not a fact
const looksLikeJson = t => /^\s*[{[]/.test(t) && t.includes('"');
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
  const lines = text.split(/\r?\n/);
  if (lines.some(l => NOISE.some(rx => rx.test(l))) || looksLikeJson(text)) reasons.push("looks like raw output or a log line");
  if (CHATTER.test(text)) reasons.push("chatter");
  if (SECRET.some(rx => rx.test(text))) reasons.push("looks like a secret or personal data");
  if (HEDGE.test(text)) reasons.push("hedged guess, not a verified fact");
  if (text.length < MIN_CHARS) reasons.push(`summary under ${MIN_CHARS} characters`);
  if (text.length > MAX_CHARS) reasons.push(`summary over ${MAX_CHARS} characters (write a summary, not a copy)`);

  const srcProblem = checkSource(candidate.source_path, repoRoot);
  if (srcProblem) reasons.push(srcProblem);

  // A superseded record (for example one whose source section was renamed) does not block its replacement.
  const dup = existing.find(r =>
    r.namespace === candidate.namespace && r.id !== candidate.id && r.status !== "superseded" && norm(r.summary) === norm(text));
  if (dup) reasons.push(`duplicate of ${dup.id}`);

  return { retain: reasons.length === 0, reasons };
}

/**
 * Runs candidates through the filter and writes the kept ones.
 * Re-running with the same candidates is safe: records are upserted by namespace + id.
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
