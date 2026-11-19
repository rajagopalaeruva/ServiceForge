// Read path (memory-architecture.md, section 7). One implementation for every store.
import { passes, whyRejected } from "./filters.mjs";
import { estimateTokens } from "./tokens.mjs";
import { BUDGET_TOKENS, RESERVE_TOKENS, WEIGHTS } from "./config.mjs";

const round = n => Math.round(n * 1e6) / 1e6;
const firstSentence = s => s.split(/(?<=[.!?])\s+/)[0];

function line(rec, summary) {
  return `- [${rec.id}] ${summary} (source: ${rec.source_path}; ${rec.status}; ${rec.timestamp})`;
}

/**
 * store.query(filters, text, limit) -> [{ record, raw }]  (raw = the store's own relevance, higher is better)
 *
 * Steps: query the store, re-check the hard filters, scale relevance by the best
 * match, score, sort, then fill the token budget. Never exceeds `budget`.
 */
export async function retrieve(store, opts) {
  const {
    namespace, asOf, text,
    features = [1, "all"],
    includeHistory = false,
    budget = BUDGET_TOKENS,
    reserve = RESERVE_TOKENS,
    weights = WEIGHTS,
    limit = 10,
  } = opts;
  const filters = { namespace, asOf, features, includeHistory };

  const fromStore = await store.query(filters, text, limit);

  const rejected = [];
  const kept = [];
  for (const c of fromStore) {
    if (!passes(c.record, filters)) { rejected.push({ id: c.record.id, why: whyRejected(c.record, filters) }); continue; }
    if (!(c.raw > 0)) continue;
    kept.push(c);
  }

  const maxRaw = Math.max(0, ...kept.map(c => c.raw));
  const tsList = kept.map(c => c.record.ts);
  const minTs = Math.min(...tsList), maxTs = Math.max(...tsList);

  const scored = kept.map(c => {
    const relevance = maxRaw > 0 ? c.raw / maxRaw : 0;
    const recency = maxTs === minTs ? 1 : (c.record.ts - minTs) / (maxTs - minTs);
    const importance = c.record.importance / 3;
    const score = weights.relevance * relevance + weights.recency * recency + weights.importance * importance;
    return { record: c.record, relevance: round(relevance), recency: round(recency), importance: round(importance), score: round(score) };
  }).sort((a, b) => b.score - a.score || b.record.importance - a.record.importance || a.record.id.localeCompare(b.record.id));

  // Fill the budget in score order. Importance-3 records may use the reserve.
  const headerFor = n => `MEMORY ns=${namespace} as_of=${asOf} n=${String(n).padStart(2, "0")}`;
  const picked = [];
  const skipped = [];
  const render = items => [headerFor(items.length), ...items.map(i => i.text)].join("\n");

  for (const s of scored) {
    const ceiling = s.record.importance === 3 ? budget : budget - reserve;
    let text1 = line(s.record, s.record.summary);
    let shortened = false;
    if (estimateTokens(render([...picked, { text: text1 }])) > ceiling) {
      const short = firstSentence(s.record.summary);
      if (short !== s.record.summary) {
        text1 = line(s.record, short);
        shortened = true;
      }
    }
    if (estimateTokens(render([...picked, { text: text1 }])) <= ceiling) {
      picked.push({ ...s, text: text1, shortened });
    } else {
      skipped.push({ id: s.record.id, why: "does not fit the budget" });
    }
  }

  const block = render(picked);
  return {
    block,
    tokens: estimateTokens(block),
    budget,
    items: picked.map(p => ({ id: p.record.id, score: p.score, relevance: p.relevance, recency: p.recency, importance: p.importance, shortened: p.shortened })),
    skipped,
    rejected,
  };
}
