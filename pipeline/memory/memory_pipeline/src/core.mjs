// Read path (memory-architecture.md, section 7). One implementation for every store.
import { passes, whyRejected } from "./filters.mjs";
import { estimateTokens } from "./tokens.mjs";
import { BUDGET_TOKENS, RESERVE_TOKENS, WEIGHTS, SCALING } from "./config.mjs";

const round = n => Math.round(n * 1e6) / 1e6;
// A sentence ends at . ! or ? followed by whitespace and then an uppercase letter or a digit, so "e.g. the" does not end one.
const firstSentence = s => s.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)[0];

function line(rec, summary) {
  return `- [${rec.id}] ${summary} (source: ${rec.source_path}; ${rec.status}; ${rec.timestamp})`;
}

/**
 * store.query(filters, text, limit) -> [{ record, raw }]  (raw = the store's own relevance, higher is better)
 * store.minRelevance (optional, default 0): a candidate whose raw score is not above it is dropped (finding F-7).
 *
 * Steps: query the store, re-check the hard filters, drop candidates below the relevance floor, scale relevance
 * by the best match, score, sort, then fill the token budget. Never exceeds `budget`.
 * Recency is linear over the date range of the candidates that pass the filters and the store limit (design 7.3, section 9).
 */
export async function retrieve(store, opts) {
  const {
    namespace, asOf, text,
    features = [1, "all"],
    includeHistory = false,
    budget = BUDGET_TOKENS,
    reserve: reserveAsked = RESERVE_TOKENS,
    weights = WEIGHTS,
    scaling = SCALING,
    limit = 10,
    minRelevance = store.minRelevance ?? 0,
  } = opts;
  // The reserve is always below the budget, so some room stays for records that are not importance 3.
  const reserve = Math.max(0, Math.min(reserveAsked, budget - 1));
  const filters = { namespace, asOf, features, includeHistory };

  const fromStore = await store.query(filters, text, limit);

  const rejected = [];
  const kept = [];
  for (const c of fromStore) {
    if (!passes(c.record, filters)) { rejected.push({ id: c.record.id, why: whyRejected(c.record, filters) }); continue; }
    if (!(c.raw > minRelevance)) continue;
    kept.push(c);
  }

  const maxRaw = Math.max(0, ...kept.map(c => c.raw));
  const minRaw = Math.min(...kept.map(c => c.raw));
  const tsList = kept.map(c => c.record.ts);
  const minTs = Math.min(...tsList), maxTs = Math.max(...tsList);

  // Relevance scaling. "max": raw / best. "minmax": (raw - worst) / (best - worst); one candidate, or all equal, scores 1.
  const scaleRelevance = raw => {
    if (maxRaw <= 0) return 0;
    if (scaling === "minmax") return maxRaw === minRaw ? 1 : (raw - minRaw) / (maxRaw - minRaw);
    return raw / maxRaw;
  };

  const scored = kept.map(c => {
    const relevance = scaleRelevance(c.raw);
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

  // A header that does not fit the budget means nothing can be injected.
  const headerFits = estimateTokens(render([])) <= budget;

  for (const s of headerFits ? scored : []) {
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
  if (!headerFits) for (const s of scored) skipped.push({ id: s.record.id, why: "header alone exceeds the budget" });

  // Nothing relevant: inject nothing (no header either).
  const block = picked.length ? render(picked) : "";
  return {
    block,
    tokens: block ? estimateTokens(block) : 0,
    budget,
    items: picked.map(p => ({ id: p.record.id, score: p.score, relevance: p.relevance, recency: p.recency, importance: p.importance, shortened: p.shortened })),
    skipped,
    rejected,
  };
}
